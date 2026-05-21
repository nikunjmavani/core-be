/**
 * OpenAPI documents MCP HTTP routes and embedded tools/resources for /reference.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const OPENAPI_PATH = join(process.cwd(), 'docs', 'openapi', 'openapi.json');

type McpOpenApiExtension = {
  tools: Array<{ name: string }>;
  resources: Array<{ uri: string }>;
};

describe('OpenAPI MCP', () => {
  const spec = JSON.parse(readFileSync(OPENAPI_PATH, 'utf-8')) as {
    paths: Record<string, Record<string, { description?: string; requestBody?: unknown }>>;
    'x-mcp'?: McpOpenApiExtension;
    components?: { schemas?: Record<string, unknown> };
  };

  it('includes GET and POST /api/v1/mcp operations', () => {
    const mcpPath = spec.paths['/api/v1/mcp'];
    expect(mcpPath?.get).toBeDefined();
    expect(mcpPath?.post).toBeDefined();
  });

  it('embeds x-mcp tools and resources for docs UI and MCP clients', () => {
    expect(spec['x-mcp']).toBeDefined();
    expect(spec['x-mcp']?.tools.map((tool) => tool.name)).toEqual(['call_api']);
    expect(spec['x-mcp']?.resources.map((resource) => resource.uri).sort()).toEqual([
      'core-be://openapi',
      'core-be://routes',
    ]);
  });

  it('documents MCP capabilities in operation descriptions', () => {
    const postDescription = spec.paths['/api/v1/mcp']?.post?.description ?? '';
    expect(postDescription).toContain('### MCP tools');
    expect(postDescription).toContain('call_api');
    expect(postDescription).toContain('core-be://openapi');
  });

  it('documents call_api input under components.schemas', () => {
    expect(spec.components?.schemas?.CallApiToolInput).toMatchObject({
      type: 'object',
      properties: expect.objectContaining({
        method: expect.anything(),
        path: expect.anything(),
      }),
    });
  });

  it('POST /api/v1/mcp uses MCP JSON-RPC request body, not domain DTO schema', () => {
    const requestBody = spec.paths['/api/v1/mcp']?.post?.requestBody as
      | { content?: { 'application/json'?: { example?: { method?: string } } } }
      | undefined;
    const example = requestBody?.content?.['application/json']?.example as
      | { jsonrpc?: string; method?: string }
      | undefined;
    expect(example?.jsonrpc).toBe('2.0');
    expect(example?.method).toBe('tools/list');
  });
});
