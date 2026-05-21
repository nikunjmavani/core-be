import { describe, expect, it } from 'vitest';
import {
  MCP_OPENAPI_PATH,
  buildMcpCapabilitiesMarkdown,
  buildMcpOpenApiExtension,
  isMcpOpenApiPath,
} from '@tooling/openapi/mcp-openapi.js';

describe('mcp-openapi', () => {
  it('buildMcpOpenApiExtension lists call_api tool and both resources', () => {
    const extension = buildMcpOpenApiExtension();

    expect(extension.tools.map((tool) => tool.name)).toEqual(['call_api']);
    expect(extension.resources.map((resource) => resource.uri).sort()).toEqual([
      'core-be://openapi',
      'core-be://routes',
    ]);
    expect(extension.tools[0]?.inputSchema).toMatchObject({
      type: 'object',
      properties: expect.objectContaining({
        method: expect.objectContaining({ type: 'string' }),
        path: expect.objectContaining({ type: 'string' }),
      }),
    });
  });

  it('buildMcpCapabilitiesMarkdown documents tools and resources tables', () => {
    const markdown = buildMcpCapabilitiesMarkdown();

    expect(markdown).toContain('### MCP tools');
    expect(markdown).toContain('`call_api`');
    expect(markdown).toContain('### MCP resources');
    expect(markdown).toContain('core-be://openapi');
    expect(markdown).toContain('core-be://routes');
  });

  it('isMcpOpenApiPath matches only /api/v1/mcp', () => {
    expect(isMcpOpenApiPath(MCP_OPENAPI_PATH)).toBe(true);
    expect(isMcpOpenApiPath('/mcp')).toBe(false);
  });
});
