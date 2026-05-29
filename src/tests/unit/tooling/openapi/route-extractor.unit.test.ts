import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  collectRoutes,
  extractRoutesFromFile,
  findRouteFiles,
} from '../../../../../tooling/openapi/extractors/route-extractor.js';

describe('route-extractor', () => {
  it('extractRoutesFromFile parses Fastify route registrations', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openapi-routes-'));
    const filePath = join(directory, 'demo.routes.ts');
    writeFileSync(
      filePath,
      `
      app.get('/', handler);
      app.post('/items', handler);
      zodApplication.patch('/items/:id', handler);
    `,
    );

    const routes = extractRoutesFromFile(filePath, '/api/v1/demo');
    const keys = routes.map((route) => `${route.method} ${route.path}`);

    expect(keys).toContain('GET /api/v1/demo');
    expect(keys).toContain('POST /api/v1/demo/items');
    expect(keys).toContain('PATCH /api/v1/demo/items/:id');
  });

  it('collectRoutes includes health, MCP, and domain routes', () => {
    const routes = collectRoutes();
    const keys = routes.map((route) => `${route.method} ${route.path}`);

    expect(keys).toContain('GET /livez');
    expect(keys).toContain('GET /readyz');
    expect(keys).toContain('GET /api/v1/mcp');
    expect(keys).toContain('POST /api/v1/mcp');
    expect(keys.some((key) => key.startsWith('GET /api/v1/auth'))).toBe(true);
    expect(keys.length).toBeGreaterThan(50);
  });

  it('findRouteFiles discovers nested *.routes.ts files', () => {
    const files = findRouteFiles(`${process.cwd()}/src/domains/auth`);
    expect(files.some((file) => file.endsWith('auth.routes.ts'))).toBe(true);
  });
});
