import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Structure of src/shared/locales/{locale}/openapi.json for multilingual docs */
export interface OpenApiLocaleStrings {
  info?: { title?: string; description?: string };
  servers?: { local?: string };
  tags?: Record<string, string>;
  components?: { bearerAuthDescription?: string };
  responses?: Record<string, string>;
}

export function getOpenApiLocale(): string {
  const fromEnvironment = process.env.OPENAPI_LOCALE;
  if (fromEnvironment) return fromEnvironment;
  const argument = process.argv.find((value) => value.startsWith('--locale='));
  if (argument) return argument.slice('--locale='.length);
  return 'en';
}

export function loadOpenApiStrings(locale: string): OpenApiLocaleStrings {
  const path = join(process.cwd(), 'src', 'shared', 'locales', locale, 'openapi.json');
  if (!existsSync(path)) {
    if (locale !== 'en') return loadOpenApiStrings('en');
    return {};
  }
  return JSON.parse(readFileSync(path, 'utf-8')) as OpenApiLocaleStrings;
}
