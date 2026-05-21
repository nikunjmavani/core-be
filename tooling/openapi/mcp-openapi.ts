/**
 * MCP tools/resources metadata embedded in generated OpenAPI for /reference and MCP clients.
 */
import { type ZodTypeAny, toJSONSchema } from 'zod';
import {
  MCP_RESOURCES,
  MCP_TOOLS,
  callApiInputSchema,
} from '@/infrastructure/mcp/mcp-capabilities.js';

function zodToOpenApiSchema(zodSchema: ZodTypeAny): Record<string, unknown> {
  const jsonSchema = toJSONSchema(zodSchema, {
    target: 'openapi-3.0',
    reused: 'inline',
    cycles: 'throw',
  }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}

export type McpOpenApiExtension = {
  tools: Array<{
    name: string;
    title: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
  resources: Array<{
    name: string;
    uri: string;
    title: string;
    description: string;
    mimeType: string;
  }>;
};

export function buildMcpOpenApiExtension(): McpOpenApiExtension {
  return {
    tools: MCP_TOOLS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: zodToOpenApiSchema(tool.inputSchema),
    })),
    resources: MCP_RESOURCES.map((resource) => ({
      name: resource.name,
      uri: resource.uri,
      title: resource.title,
      description: resource.description,
      mimeType: resource.mimeType,
    })),
  };
}

export function buildMcpCapabilitiesMarkdown(): string {
  const toolRows = MCP_TOOLS.map(
    (tool) => `| \`${tool.name}\` | ${tool.title} | ${tool.description} |`,
  ).join('\n');
  const resourceRows = MCP_RESOURCES.map(
    (resource) =>
      `| \`${resource.uri}\` | \`${resource.mimeType}\` | ${resource.description} |`,
  ).join('\n');

  return [
    '### MCP tools',
    '',
    'Returned by JSON-RPC `tools/list` on this endpoint:',
    '',
    '| Name | Title | Description |',
    '| ---- | ----- | ----------- |',
    toolRows,
    '',
    '### MCP resources',
    '',
    'Returned by JSON-RPC `resources/list`; read with `resources/read`:',
    '',
    '| URI | MIME type | Description |',
    '| --- | --------- | ----------- |',
    resourceRows,
    '',
    '`call_api` input schema is also available under `components.schemas.CallApiToolInput`.',
  ].join('\n');
}

export const MCP_STREAMABLE_HTTP_POST_REQUEST_BODY = {
  required: false,
  description:
    'MCP streamable HTTP JSON-RPC 2.0 body (e.g. `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`). See the [MCP specification](https://modelcontextprotocol.io/).',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        description: 'JSON-RPC 2.0 request object',
        additionalProperties: true,
      },
      example: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      },
    },
  },
};

export function getMcpComponentSchemas(): Record<string, Record<string, unknown>> {
  return {
    CallApiToolInput: zodToOpenApiSchema(callApiInputSchema),
  };
}

export const MCP_OPENAPI_PATH = '/api/v1/mcp';

export function isMcpOpenApiPath(openapiPath: string): boolean {
  return openapiPath === MCP_OPENAPI_PATH;
}
