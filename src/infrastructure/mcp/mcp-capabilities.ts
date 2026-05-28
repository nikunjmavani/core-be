/**
 * Canonical MCP tools and resources for core-be.
 * Used by the MCP server and OpenAPI generation (Scalar /reference UI).
 */
import { z } from 'zod';

/** MCP resource URI for the generated OpenAPI 3.0 spec (`docs/openapi/openapi.json`). */
export const MCP_OPENAPI_RESOURCE_URI = 'core-be://openapi';
/** MCP resource URI for the human-readable route catalog (`docs/routes.txt`). */
export const MCP_ROUTES_RESOURCE_URI = 'core-be://routes';

/**
 * Zod input schema for the `call_api` MCP tool. Forwards HTTP method, path (must start
 * with `/api/v1/`), JSON body, and optional auth headers — clients use this to invoke
 * any backend endpoint through the MCP transport.
 */
export const callApiInputSchema = z.object({
  method: z.enum(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']).describe('HTTP method'),
  path: z.string().describe('API path (must start with /api/v1/)'),
  body: z.record(z.string(), z.unknown()).optional().describe('Request body for POST/PATCH/PUT'),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe('Optional headers (e.g. Authorization, X-Organization-Id)'),
});

/** Static descriptor for an MCP resource — used to register resources on the server and to render the OpenAPI page. */
export type McpResourceDefinition = {
  name: string;
  uri: string;
  title: string;
  description: string;
  mimeType: string;
};

/** Static descriptor for an MCP tool, including the Zod schema validating tool input arguments. */
export type McpToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodTypeAny;
};

/** Canonical resource catalog exposed via MCP (OpenAPI spec + route catalog). */
export const MCP_RESOURCES: readonly McpResourceDefinition[] = [
  {
    name: 'core-be-openapi',
    uri: MCP_OPENAPI_RESOURCE_URI,
    title: 'core-be OpenAPI spec',
    description:
      'OpenAPI 3.0 spec (paths, schemas, request/response). Use this to discover and validate API calls. Generate with pnpm docs:generate.',
    mimeType: 'application/json',
  },
  {
    name: 'core-be-routes',
    uri: MCP_ROUTES_RESOURCE_URI,
    title: 'core-be API routes',
    description:
      'List of all API routes (method, path, access). Use with core-be://openapi to discover endpoints before calling call_api.',
    mimeType: 'text/plain',
  },
] as const;

/** Canonical tool catalog exposed via MCP (currently just the `call_api` proxy). */
export const MCP_TOOLS: readonly McpToolDefinition[] = [
  {
    name: 'call_api',
    title: 'Call core-be API',
    description:
      'Call any core-be REST API endpoint. Path must start with /api/v1/. Pass Authorization and X-Organization-Id in headers for authenticated/tenant-scoped calls. Use core-be://openapi or core-be://routes to discover available endpoints.',
    inputSchema: callApiInputSchema,
  },
] as const;
