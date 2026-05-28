import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import type { FastifyInstance } from 'fastify';

type OpenApiSpec = {
  paths: Record<
    string,
    Record<
      string,
      {
        responses?: Record<
          string,
          { content?: { 'application/json'?: { schema?: { required?: string[] } } } }
        >;
      }
    >
  >;
};

function loadOpenApiSpec(): OpenApiSpec {
  const specPath = join(process.cwd(), 'docs', 'openapi', 'openapi.json');
  if (!existsSync(specPath)) {
    execSync('pnpm docs:generate', { stdio: 'pipe' });
  }
  return JSON.parse(readFileSync(specPath, 'utf-8')) as OpenApiSpec;
}

function requiredFieldsForPath(
  spec: OpenApiSpec,
  path: string,
  method: string,
  status: string,
): string[] {
  const operation = spec.paths[path]?.[method.toLowerCase()];
  return operation?.responses?.[status]?.content?.['application/json']?.schema?.required ?? [];
}

describe('Integration: OpenAPI response validation', () => {
  let app: FastifyInstance;
  let spec: OpenApiSpec;

  beforeAll(async () => {
    spec = loadOpenApiSpec();
    const { app: testApplication } = await createTestApp();
    app = testApplication;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health response includes OpenAPI-required fields', async () => {
    const response = await injectUnauthenticated(app, { method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);

    const required = requiredFieldsForPath(spec, '/health', 'get', '200');
    for (const field of required) {
      expect(response.json()).toHaveProperty(field);
    }
  });

  it('GET /api/v1/users/me response shape matches authenticated profile contract', async () => {
    const user = await createTestUser();
    const token = await generateTestToken({ userId: user.public_id });

    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath('/users/me'),
      token,
    });

    expect(response.statusCode).toBe(200);
    expect((response.json() as { data: Record<string, unknown> }).data).toMatchObject({
      id: user.public_id,
      email: user.email,
    });
    expect((response.json() as { meta?: Record<string, unknown> }).meta).toHaveProperty(
      'request_id',
    );
  });
});
