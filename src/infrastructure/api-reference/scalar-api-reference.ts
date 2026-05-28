/**
 * Scalar API Reference UI at GET /reference (when ENABLE_API_REFERENCE=true).
 * Serves the OpenAPI document from OPENAPI_SPEC_PATH (default docs/openapi/openapi.json).
 */

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import scalarApiReference from '@scalar/fastify-api-reference';
import type { FastifyInstance } from 'fastify';
import { getEnv } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

const API_REFERENCE_ROUTE_PREFIX = '/reference';

function resolveOpenApiSpecPath(openApiSpecPath: string): string {
  return isAbsolute(openApiSpecPath) ? openApiSpecPath : join(process.cwd(), openApiSpecPath);
}

function loadOpenApiSpecContent(openApiSpecPath: string): string {
  const absolutePath = resolveOpenApiSpecPath(openApiSpecPath);
  if (!existsSync(absolutePath)) {
    throw new Error(
      `OpenAPI spec not found at ${absolutePath}. Run pnpm docs:generate to produce docs/openapi/openapi.json.`,
    );
  }
  return readFileSync(absolutePath, 'utf-8');
}

/**
 * Mounts the Scalar API Reference UI at `GET /reference` when `ENABLE_API_REFERENCE=true`.
 * The OpenAPI document is read lazily on each request from `OPENAPI_SPEC_PATH`
 * (default `docs/openapi/openapi.json`). When `ENABLE_MCP_SERVER` is also on, an HTML
 * comment pointing at the MCP endpoint is appended to the rendered page for discoverability.
 * No-op when the flag is off.
 */
export async function registerScalarApiReference(application: FastifyInstance): Promise<void> {
  const environment = getEnv();
  if (!environment.ENABLE_API_REFERENCE) {
    return;
  }

  const openApiSpecPath = environment.OPENAPI_SPEC_PATH ?? 'docs/openapi/openapi.json';

  await application.register(scalarApiReference, {
    routePrefix: API_REFERENCE_ROUTE_PREFIX,
    logLevel: 'silent',
    configuration: {
      content: () => loadOpenApiSpecContent(openApiSpecPath),
    },
  });

  application.addHook('onSend', async (request, reply, payload) => {
    if (
      environment.ENABLE_MCP_SERVER &&
      request.url === `${API_REFERENCE_ROUTE_PREFIX}/` &&
      String(reply.getHeader('content-type') ?? '').includes('text/html') &&
      typeof payload === 'string'
    ) {
      return `${payload}\n<!-- MCP endpoint: /api/v1/mcp -->`;
    }
    return payload;
  });

  logger.info(
    { routePrefix: API_REFERENCE_ROUTE_PREFIX, openApiSpecPath },
    'Scalar API reference registered',
  );
}
