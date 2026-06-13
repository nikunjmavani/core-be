import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import Fastify from 'fastify';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectUnauthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { resetEnvCacheForTests } from '@/shared/config/env.config.js';
import { registerScalarApiReference } from '@/infrastructure/api-reference/scalar-api-reference.js';
import type { FastifyInstance } from 'fastify';

const OPENAPI_SPEC_PATH = join(process.cwd(), 'docs', 'openapi', 'openapi.json');

function ensureOpenApiSpecExists(): void {
  if (!existsSync(OPENAPI_SPEC_PATH)) {
    execSync('pnpm docs:generate', { stdio: 'pipe' });
  }
}

describe('Integration: Scalar API reference', () => {
  describe('when ENABLE_API_REFERENCE=true and ENABLE_MCP_SERVER=true', { timeout: 30_000 }, () => {
    let app: FastifyInstance;
    const previousEnableApiReference = process.env.ENABLE_API_REFERENCE;
    const previousEnableMcpServer = process.env.ENABLE_MCP_SERVER;
    const previousOpenApiSpecPath = process.env.OPENAPI_SPEC_PATH;

    beforeAll(async () => {
      ensureOpenApiSpecExists();
      process.env.ENABLE_API_REFERENCE = 'true';
      process.env.ENABLE_MCP_SERVER = 'true';
      process.env.OPENAPI_SPEC_PATH = 'docs/openapi/openapi.json';
      resetEnvCacheForTests();
      const { app: testApplication } = await createTestApp();
      app = testApplication;
    }, 30_000);

    afterAll(async () => {
      await app.close();
      if (previousEnableApiReference === undefined) {
        delete process.env.ENABLE_API_REFERENCE;
      } else {
        process.env.ENABLE_API_REFERENCE = previousEnableApiReference;
      }
      if (previousEnableMcpServer === undefined) {
        delete process.env.ENABLE_MCP_SERVER;
      } else {
        process.env.ENABLE_MCP_SERVER = previousEnableMcpServer;
      }
      if (previousOpenApiSpecPath === undefined) {
        delete process.env.OPENAPI_SPEC_PATH;
      } else {
        process.env.OPENAPI_SPEC_PATH = previousOpenApiSpecPath;
      }
      resetEnvCacheForTests();
    });

    it('GET /reference/ returns HTML API reference with Scalar MCP configuration', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: '/reference/',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/text\/html/);
      expect(response.body).toContain('scalar');
      expect(response.body).toContain('/api/v1/mcp');
    });

    it('GET /reference/openapi.json returns OpenAPI JSON', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: '/reference/openapi.json',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.body).toContain('"info"');
      expect(response.body).toContain('"paths"');
    });

    it('GET /reference/openapi.json documents MCP tools and resources', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: '/reference/openapi.json',
      });

      const parsed = JSON.parse(response.body) as {
        data?: {
          paths: Record<string, unknown>;
          'x-mcp'?: { tools: Array<{ name: string }>; resources: Array<{ uri: string }> };
        };
      };
      const specification = parsed.data;
      expect(specification).toBeDefined();

      expect(specification?.paths['/api/v1/mcp']).toBeDefined();
      expect(specification?.['x-mcp']?.tools.map((tool) => tool.name)).toEqual(['call_api']);
      expect(specification?.['x-mcp']?.resources.map((resource) => resource.uri).sort()).toEqual([
        'core-be://client-guide',
        'core-be://openapi',
        'core-be://routes',
      ]);
    });
  });

  describe('when ENABLE_API_REFERENCE=false', { timeout: 30_000 }, () => {
    let app: FastifyInstance;
    const previousEnableApiReference = process.env.ENABLE_API_REFERENCE;

    beforeAll(async () => {
      process.env.ENABLE_API_REFERENCE = 'false';
      resetEnvCacheForTests();
      app = Fastify({ logger: false });
      await registerScalarApiReference(app);
      await app.ready();
    }, 30_000);

    afterAll(async () => {
      await app.close();
      if (previousEnableApiReference === undefined) {
        delete process.env.ENABLE_API_REFERENCE;
      } else {
        process.env.ENABLE_API_REFERENCE = previousEnableApiReference;
      }
      resetEnvCacheForTests();
    });

    it('GET /reference/ returns 404 when API reference is disabled', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: '/reference/',
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
