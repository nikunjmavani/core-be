import '@/shared/config/load-env-files.js';

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildOpenApiDocument } from '@tooling/openapi/emitters/openapi-document.js';
import { getOpenApiLocale, loadOpenApiStrings } from '@tooling/openapi/extractors/locale-loader.js';

/**
 * Vitest globalSetup for the `global` project: generate the OpenAPI spec when it is absent.
 *
 * @remarks
 * The `openapi-*.global.test.ts` suites `readFileSync('docs/openapi/openapi.json')` at module
 * load. That spec is gitignored (generated, not committed), so a fresh clone fails those suites
 * with `ENOENT` until `pnpm docs:generate` is run by hand. This setup removes that manual step.
 *
 * Algorithm: skip immediately when the spec already exists (no regeneration cost on warm repos);
 * otherwise build it with the same emitter the CLI uses and write `openapi.json`.
 * Side effects: writes `docs/openapi/openapi.json` only when missing.
 * Notes: `buildOpenApiDocument` is a static build from route + Zod definitions, so this stays
 * DB-free and safe for the parallel fast lane.
 */
export default function ensureOpenApiSpecForGlobalSuite(): void {
  const docsDirectory = join(process.cwd(), 'docs', 'openapi');
  const defaultSpecPath = join(docsDirectory, 'openapi.json');
  if (existsSync(defaultSpecPath)) return;

  const openApiDocument = buildOpenApiDocument(loadOpenApiStrings(getOpenApiLocale()));
  if (!existsSync(docsDirectory)) {
    mkdirSync(docsDirectory, { recursive: true });
  }
  writeFileSync(defaultSpecPath, JSON.stringify(openApiDocument, null, 2), 'utf-8');
}
