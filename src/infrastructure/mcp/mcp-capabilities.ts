/**
 * Canonical MCP tools and resources for core-be.
 * Used by the MCP server and OpenAPI generation (Scalar /reference UI).
 */
import { z } from 'zod';

export const MCP_OPENAPI_RESOURCE_URI = 'core-be://openapi';
export const MCP_ROUTES_RESOURCE_URI = 'core-be://routes';

export const callApiInputSchema = z.object({
  method: z.enum(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']).describe('HTTP method'),
  path: z.string().describe('API path (must start with /api/v1/)'),
  body: z.record(z.string(), z.unknown()).optional().describe('Request body for POST/PATCH/PUT'),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe('Optional headers (e.g. Authorization, X-Organization-Id)'),
});

export type McpResourceDefinition = {
  name: string;
  uri: string;
  title: string;
  description: string;
  mimeType: string;
};

export type McpToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodTypeAny;
};

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

export const MCP_TOOLS: readonly McpToolDefinition[] = [
  {
    name: 'call_api',
    title: 'Call core-be API',
    description:
      'Call any core-be REST API endpoint. Path must start with /api/v1/. Pass Authorization and X-Organization-Id in headers for authenticated/tenant-scoped calls. Use core-be://openapi or core-be://routes to discover available endpoints.',
    inputSchema: callApiInputSchema,
  },
] as const;
