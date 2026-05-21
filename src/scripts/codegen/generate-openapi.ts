import '@/shared/config/load-env-files.js';

/**
 * Generates OpenAPI 3.0 spec from route definitions + Zod DTO schemas.
 *
 * Run: pnpm docs:generate
 *      OPENAPI_LOCALE=es pnpm docs:generate
 *      pnpm docs:generate:multilang  (generates for all locales)
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOpenApiDocument, countRoutes } from '@tooling/openapi/emitters/openapi-document.js';
import { getOpenApiLocale, loadOpenApiStrings } from '@tooling/openapi/extractors/locale-loader.js';

function main(): void {
  const locale = getOpenApiLocale();
  const localeStrings = loadOpenApiStrings(locale);
  const openapi = buildOpenApiDocument(localeStrings);

  const docsDirectory = join(process.cwd(), 'docs', 'openapi');
  if (!existsSync(docsDirectory)) {
    mkdirSync(docsDirectory, { recursive: true });
  }

  const localePath = join(docsDirectory, `openapi.${locale}.json`);
  writeFileSync(localePath, JSON.stringify(openapi, null, 2), 'utf-8');
  console.log(
    `Generated ${localePath} (v${openapi.info.version}, ${countRoutes(openapi)} routes, locale=${locale})`,
  );

  if (locale === 'en') {
    const defaultPath = join(docsDirectory, 'openapi.json');
    writeFileSync(defaultPath, JSON.stringify(openapi, null, 2), 'utf-8');
    console.log(`Generated ${defaultPath} (default)`);
  }
}

main();
