/**
 * MCP (Model Context Protocol) server that exposes core-be APIs as tools and resources.
 * When the backend is running, frontends (or AI agents) can connect to the MCP endpoint
 * to discover and call APIs without separate API documentation.
 *
 * - Resource `core-be://openapi`: OpenAPI 3.0 spec (paths, schemas, request/response)
 * - Resource `core-be://routes`: route catalog (method, path, access)
 * - Tool `call_api`: call any API endpoint (method, path, optional body/headers); forwards auth via headers
 *
 * The @modelcontextprotocol/sdk package is an optional dependency; load it via loadMcpSdk() only when MCP is enabled.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Response as LightMyRequestResponse } from 'light-my-request';
import { z } from 'zod';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { GLOBAL_ROLES } from '@/shared/constants/index.js';
import { requireRole } from '@/shared/utils/auth/authorization.util.js';

const ROUTES_RESOURCE_URI = 'core-be://routes';
const ROUTES_CATALOG_PATH = join(process.cwd(), 'docs', 'routes.txt');
const OPENAPI_RESOURCE_URI = 'core-be://openapi';
const OPENAPI_SPEC_PATH = join(process.cwd(), 'docs', 'openapi', 'openapi.json');

type McpSdk = {
  McpServer: typeof McpServer;
  StreamableHTTPServerTransport: typeof StreamableHTTPServerTransport;
};

let cachedMcpSdk: McpSdk | null = null;

/** Loads the optional MCP SDK (cached after first successful load). */
export async function loadMcpSdk(): Promise<McpSdk> {
  if (cachedMcpSdk !== null) {
    return cachedMcpSdk;
  }
  const [mcpModule, streamableHttpModule] = await Promise.all([
    import('@modelcontextprotocol/sdk/server/mcp.js'),
    import('@modelcontextprotocol/sdk/server/streamableHttp.js'),
  ]);
  cachedMcpSdk = {
    McpServer: mcpModule.McpServer,
    StreamableHTTPServerTransport: streamableHttpModule.StreamableHTTPServerTransport,
  };
  return cachedMcpSdk;
}

function loadRoutesCatalog(): string {
  try {
    return readFileSync(ROUTES_CATALOG_PATH, 'utf-8');
  } catch {
    return 'Route catalog not available. Run pnpm routes:catalog to generate docs/routes.txt.';
  }
}

function loadOpenApiSpec(): string {
  try {
    return readFileSync(OPENAPI_SPEC_PATH, 'utf-8');
  } catch {
    return JSON.stringify({
      error:
        'OpenAPI spec not available. Run pnpm docs:generate to produce docs/openapi/openapi.json.',
    });
  }
}

const callApiInputSchema = z.object({
  method: z.enum(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']).describe('HTTP method'),
  path: z.string().describe('API path (must start with /api/v1/)'),
  body: z.record(z.string(), z.unknown()).optional().describe('Request body for POST/PATCH/PUT'),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe('Optional headers (e.g. Authorization, X-Organization-Id)'),
});

/**
 * Construction parameters for {@link createMcpServer}. `inject` is the in-process HTTP
 * back-channel (Fastify `app.inject`) the `call_api` tool uses to invoke real route
 * handlers without an external network hop.
 */
export type CreateMcpServerOptions = {
  name: string;
  version: string;
  inject: (options: {
    method: string;
    url: string;
    payload?: unknown;
    headers?: Record<string, string>;
  }) => Promise<{ statusCode: number; payload: unknown; headers: Record<string, string> }>;
};

/** Concrete instance type of the lazily-loaded `@modelcontextprotocol/sdk` `McpServer`. */
export type McpServerInstance = InstanceType<McpSdk['McpServer']>;
/** Concrete instance type of the lazily-loaded `StreamableHTTPServerTransport`. */
export type McpTransportInstance = InstanceType<McpSdk['StreamableHTTPServerTransport']>;

/**
 * Creates and configures the MCP server with a routes resource and call_api tool.
 * Does not connect to a transport; caller must call server.connect(transport).
 */
export function createMcpServer(options: CreateMcpServerOptions, sdk: McpSdk): McpServerInstance {
  const { name, version, inject } = options;
  const { McpServer } = sdk;
  const routesCatalog = loadRoutesCatalog();
  const openApiSpec = loadOpenApiSpec();

  const server = new McpServer(
    { name, version },
    {
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false },
      },
    },
  );

  server.registerResource(
    'core-be-openapi',
    OPENAPI_RESOURCE_URI,
    {
      title: 'core-be OpenAPI spec',
      description:
        'OpenAPI 3.0 spec (paths, schemas, request/response). Use this to discover and validate API calls. Generate with pnpm docs:generate.',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        {
          uri: OPENAPI_RESOURCE_URI,
          mimeType: 'application/json',
          text: openApiSpec,
        },
      ],
    }),
  );

  server.registerResource(
    'core-be-routes',
    ROUTES_RESOURCE_URI,
    {
      title: 'core-be API routes',
      description:
        'List of all API routes (method, path, access). Use with core-be://openapi to discover endpoints before calling call_api.',
      mimeType: 'text/plain',
    },
    async () => ({
      contents: [
        {
          uri: ROUTES_RESOURCE_URI,
          mimeType: 'text/plain',
          text: routesCatalog,
        },
      ],
    }),
  );

  server.registerTool(
    'call_api',
    {
      title: 'Call core-be API',
      description:
        'Call any core-be REST API endpoint. Path must start with /api/v1/. Pass Authorization and X-Organization-Id in headers for authenticated/tenant-scoped calls. Use core-be://openapi or core-be://routes to discover available endpoints.',
      inputSchema: callApiInputSchema,
    },
    async (args) => {
      const parsed = callApiInputSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
          isError: true,
        };
      }
      const data = parsed.data;
      if (
        !(
          data.path.startsWith('/api/v1/') ||
          data.path.startsWith('/livez') ||
          data.path.startsWith('/readyz')
        )
      ) {
        return {
          content: [{ type: 'text', text: 'Path must start with /api/v1/, /livez, or /readyz' }],
          isError: true,
        };
      }
      try {
        const result = await inject({
          method: data.method,
          url: data.path,
          payload: data.body,
          headers: data.headers ?? {},
        });
        const responseBody =
          typeof result.payload === 'object' && result.payload !== null
            ? JSON.stringify(result.payload)
            : String(result.payload);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                statusCode: result.statusCode,
                headers: result.headers,
                body: responseBody,
              }),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `API call failed: ${message}` }], isError: true };
      }
    },
  );

  return server;
}

/**
 * Pair of MCP server + transport that must be created together: stateless mode requires
 * a fresh transport per request, so callers cannot reuse them across requests.
 */
export type McpTransportAndServer = {
  transport: McpTransportInstance;
  server: McpServerInstance;
};

/**
 * Creates the MCP server and Streamable HTTP transport (stateless, JSON response).
 * Caller must register the transport's handleRequest with Fastify and then connect the server to the transport.
 */
export function createMcpTransportAndServer(
  options: CreateMcpServerOptions,
  sdk: McpSdk,
): McpTransportAndServer {
  const server = createMcpServer(options, sdk);
  const transport = new sdk.StreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  return { transport, server };
}

type McpRouteOptions = {
  name: string;
  version: string;
};

/**
 * Registers MCP HTTP handlers on the given Fastify scope.
 * When ENABLE_MCP_SERVER is true, GET and POST /api/v1/mcp handle MCP requests:
 * - POST: JSON-RPC (initialize, tools/list, call_api, etc.).
 * - GET: SSE stream for client connection flow (returns an event-stream; may stay idle in JSON response mode).
 *
 * Stateless mode (sessionIdGenerator: undefined) requires a new transport per request;
 * the SDK rejects reuse. So we create a new transport and server per request.
 */
export async function registerMcpRouteHandlers(
  app: FastifyInstance,
  options: McpRouteOptions,
): Promise<void> {
  const sdk = await loadMcpSdk();

  const inject = async (opts: {
    method: string;
    url: string;
    payload?: unknown;
    headers?: Record<string, string>;
  }) => {
    const injectOptions: InjectOptions = {
      method: opts.method as 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
      url: opts.url,
      headers: opts.headers ?? {},
    };
    if (opts.payload !== undefined) {
      injectOptions.payload = opts.payload as NonNullable<InjectOptions['payload']>;
    }
    const response = (await app.inject(injectOptions)) as LightMyRequestResponse;
    let payload: unknown;
    try {
      payload = response.json();
    } catch {
      payload = response.body;
    }
    const headersRecord: Record<string, string> = {};
    for (const [key, value] of Object.entries(response.headers)) {
      if (typeof value === 'string') {
        // eslint-disable-next-line security/detect-object-injection -- key from Object.entries iteration over server-built headers.
        headersRecord[key] = value;
      } else if (Array.isArray(value) && value[0]) {
        // eslint-disable-next-line security/detect-object-injection -- key from Object.entries iteration over server-built headers.
        headersRecord[key] = String(value[0]);
      }
    }
    return {
      statusCode: response.statusCode,
      payload,
      headers: headersRecord,
    };
  };

  async function handleMcpRequest(
    nodeRequest: IncomingMessage,
    nodeResponse: ServerResponse,
    parsedBody: unknown,
  ): Promise<void> {
    const { transport, server } = createMcpTransportAndServer(
      {
        ...options,
        inject,
      },
      sdk,
    );
    await server.connect(transport as Parameters<McpServerInstance['connect']>[0]);
    await transport.handleRequest(nodeRequest, nodeResponse, parsedBody);
  }

  app.get(
    '/api/v1/mcp',
    {
      schema: {
        summary: 'MCP streamable HTTP (GET)',
        description:
          'Model Context Protocol endpoint when `ENABLE_MCP_SERVER=true`. Exposes resources `core-be://openapi` and `core-be://routes`, plus the `call_api` tool for in-process API invocation. Requires JWT with global `admin` or `super_admin` role. See docs/integrations/cursor-backend-mcp.md.',
        tags: ['MCP'],
      },
    },
    async (request, reply) => {
      reply.hijack();
      await handleMcpRequest(request.raw, reply.raw, undefined);
    },
  );

  app.post(
    '/api/v1/mcp',
    {
      schema: {
        summary: 'MCP streamable HTTP (POST)',
        description:
          'Primary MCP transport for Cursor and other MCP clients. Same auth and capabilities as GET. Request and response bodies follow the MCP streamable HTTP specification.',
        tags: ['MCP'],
      },
    },
    async (request, reply) => {
      reply.hijack();
      await handleMcpRequest(request.raw, reply.raw, request.body as unknown);
    },
  );

  // Alias without /api/v1 so clients using base URL with path /mcp do not get 404
  app.get('/mcp', async (request, reply) => {
    reply.hijack();
    await handleMcpRequest(request.raw, reply.raw, undefined);
  });

  app.post('/mcp', async (request, reply) => {
    reply.hijack();
    await handleMcpRequest(request.raw, reply.raw, request.body as unknown);
  });
}

/**
 * Registers the MCP endpoint with JWT authentication and admin role required.
 * MCP can proxy arbitrary API calls — must not be exposed without authentication.
 */
export async function registerMcpRoute(
  app: FastifyInstance,
  options: { name: string; version: string },
): Promise<void> {
  if (!app.authenticate) {
    throw new Error('MCP routes require Fastify authenticate decorator');
  }

  const adminPreHandlers = [
    app.authenticate,
    requireRole(GLOBAL_ROLES.SUPER_ADMIN, GLOBAL_ROLES.ADMIN),
  ] as const;

  await app.register(
    async (scope) => {
      scope.addHook('preHandler', async (request, reply) => {
        for (const handler of adminPreHandlers) {
          await handler.call(scope, request, reply);
        }
      });
      await registerMcpRouteHandlers(scope, options);
    },
    { prefix: '' },
  );
}
