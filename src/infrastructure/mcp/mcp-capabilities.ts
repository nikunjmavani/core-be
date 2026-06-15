/**
 * Canonical MCP tools and resources for the API.
 * Used by the MCP server and OpenAPI generation (Scalar /reference UI).
 */
import { z } from 'zod';
import {
  MCP_OPENAPI_RESOURCE_URI,
  MCP_ROUTES_RESOURCE_URI,
  PROJECT_DISPLAY_NAME,
  PROJECT_SLUG,
} from '@/shared/constants/project-identity.constants.js';

export { MCP_OPENAPI_RESOURCE_URI, MCP_ROUTES_RESOURCE_URI };

/** MCP resource URI for the hand-written client integration / auth-flow guide ({@link MCP_CLIENT_GUIDE}). */
export const MCP_CLIENT_GUIDE_RESOURCE_URI = `${PROJECT_SLUG}://client-guide`;

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
    .describe(
      'Optional headers (e.g. Authorization: Bearer <token>). The active organization comes ' +
        `from the token's signed org claim — not a header. Read ${MCP_CLIENT_GUIDE_RESOURCE_URI} for the auth flow.`,
    ),
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
    name: `${PROJECT_SLUG}-openapi`,
    uri: MCP_OPENAPI_RESOURCE_URI,
    title: `${PROJECT_DISPLAY_NAME} OpenAPI spec`,
    description:
      'OpenAPI 3.0 spec (paths, schemas, request/response). Use this to discover and validate API calls. Generate with pnpm docs:generate.',
    mimeType: 'application/json',
  },
  {
    name: `${PROJECT_SLUG}-routes`,
    uri: MCP_ROUTES_RESOURCE_URI,
    title: `${PROJECT_DISPLAY_NAME} API routes`,
    description: `List of all API routes (method, path, access). Use with ${MCP_OPENAPI_RESOURCE_URI} to discover endpoints before calling call_api.`,
    mimeType: 'text/plain',
  },
  {
    name: `${PROJECT_SLUG}-client-guide`,
    uri: MCP_CLIENT_GUIDE_RESOURCE_URI,
    title: `${PROJECT_DISPLAY_NAME} client integration guide`,
    description:
      'How a frontend/client should authenticate (login, refresh, MFA), carry the active organization (the signed org JWT claim — not a path or header), switch organizations, and call the flat org-scoped routes. Read this first when wiring up auth or any org-scoped call.',
    mimeType: 'text/markdown',
  },
] as const;

/** Canonical tool catalog exposed via MCP (currently just the `call_api` proxy). */
export const MCP_TOOLS: readonly McpToolDefinition[] = [
  {
    name: 'call_api',
    title: `Call ${PROJECT_DISPLAY_NAME} API`,
    description: `Call any ${PROJECT_DISPLAY_NAME} REST API endpoint. Path must start with /api/v1/. Pass Authorization: Bearer <token> for authenticated calls; the active organization comes from the token's signed org claim (switch via POST /api/v1/auth/switch-to-organization or /auth/switch-to-personal), NOT a header. Read ${MCP_CLIENT_GUIDE_RESOURCE_URI} for the auth flow, and ${MCP_OPENAPI_RESOURCE_URI} / ${MCP_ROUTES_RESOURCE_URI} to discover endpoints.`,
    inputSchema: callApiInputSchema,
  },
] as const;
