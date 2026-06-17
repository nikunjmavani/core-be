/**
 * Extracts `schema.summary`, `schema.description`, and `schema.tags` literals
 * from every Fastify route registration in `src/domains/**\/*.routes.ts` plus
 * the supplemental `/livez`, `/readyz`, and `/api/v1/mcp` registrations.
 *
 * Returned map is keyed by `${METHOD} ${OPENAPI_PATH}` (Fastify path params
 * `:name` are converted to OpenAPI `{name}`).
 *
 * Used by the OpenAPI document builder as the **single source of truth** for
 * operation summary / description / tags.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROUTE_PATH_PATTERN } from '@tooling/openapi/route-catalog/constants.js';
import { listDomainRouteFiles } from '@tooling/openapi/route-catalog/file-collectors.js';
import { findOptionsObjectRange, findSchemaPropertyRange } from './schema-locator.js';

export interface RouteSchemaMetadata {
  summary: string | null;
  description: string | null;
  tags: string[] | null;
}

const SUMMARY_LITERAL_PATTERN = /\bsummary\s*:\s*(['"`])([\s\S]*?)\1/;
const DESCRIPTION_LITERAL_PATTERN = /\bdescription\s*:\s*(['"`])([\s\S]*?)\1/;
const TAGS_ARRAY_PATTERN = /\btags\s*:\s*\[([\s\S]*?)\]/;
const STRING_LITERAL_PATTERN = /(['"`])([\s\S]*?)\1/g;

const DOMAIN_PREFIX_BY_FOLDER: Record<string, string> = {
  audit: '/api/v1/audit',
  auth: '/api/v1/auth',
  user: '/api/v1/users',
  tenancy: '/api/v1/tenancy',
  billing: '/api/v1/billing',
  notify: '/api/v1/notify',
  upload: '/api/v1/uploads',
};

const SUPPLEMENTAL_ROUTE_FILES: Array<{ absolutePath: string; prefix: string }> = [
  {
    absolutePath: join(process.cwd(), 'src', 'shared', 'middlewares', 'health.middleware.ts'),
    prefix: '',
  },
  {
    absolutePath: join(process.cwd(), 'src', 'infrastructure', 'mcp', 'mcp-server.ts'),
    prefix: '',
  },
];

const ROUTE_METHOD_PATTERN_BROAD =
  /\b(?:app|application|zodApplication|stripeZodApplication)\.(get|post|patch|put|delete)\b/g;

function pathToOpenapi(fastifyPath: string): string {
  return fastifyPath.replace(/:([A-Za-z_$][\w$]*)/g, '{$1}');
}

function buildLookupKey(method: string, fastifyFullPath: string): string {
  return `${method} ${pathToOpenapi(fastifyFullPath)}`;
}

function inferDomainPrefixForFile(routeFileAbsolutePath: string): string | null {
  const segments = routeFileAbsolutePath.split('/');
  const domainsIndex = segments.lastIndexOf('domains');
  if (domainsIndex === -1) return null;
  const domainFolder = segments[domainsIndex + 1] ?? '';
  return DOMAIN_PREFIX_BY_FOLDER[domainFolder] ?? null;
}

function extractTagsFromArrayBody(arrayBody: string): string[] {
  const tags: string[] = [];
  for (const match of arrayBody.matchAll(STRING_LITERAL_PATTERN)) {
    const literal = match[2] ?? '';
    if (literal.length > 0) tags.push(literal);
  }
  return tags;
}

function extractMetadataFromOptionsBody(optionsBody: string): RouteSchemaMetadata {
  const schemaRange = findSchemaPropertyRange(optionsBody);
  if (!schemaRange) {
    return { summary: null, description: null, tags: null };
  }
  const schemaBody = optionsBody.slice(schemaRange.bodyStart, schemaRange.bodyEnd);
  const summaryMatch = SUMMARY_LITERAL_PATTERN.exec(schemaBody);
  const descriptionMatch = DESCRIPTION_LITERAL_PATTERN.exec(schemaBody);
  const tagsMatch = TAGS_ARRAY_PATTERN.exec(schemaBody);
  const tags = tagsMatch ? extractTagsFromArrayBody(tagsMatch[1] ?? '') : null;
  return {
    summary: summaryMatch?.[2] ?? null,
    description: descriptionMatch?.[2] ?? null,
    tags: tags && tags.length > 0 ? tags : null,
  };
}

/** A single route registration paired with its (possibly incomplete) extracted schema metadata. */
export interface RouteSchemaEntry {
  method: string;
  fullPath: string;
  /** `${METHOD} ${OPENAPI_PATH}` lookup key (Fastify `:param` → OpenAPI `{param}`). */
  lookupKey: string;
  metadata: RouteSchemaMetadata;
}

function scanRouteSchemaEntries({
  absolutePath,
  prefix,
}: {
  absolutePath: string;
  prefix: string;
}): RouteSchemaEntry[] {
  const entries: RouteSchemaEntry[] = [];
  let sourceText: string;
  try {
    sourceText = readFileSync(absolutePath, 'utf-8');
  } catch {
    return entries;
  }

  for (const methodMatch of sourceText.matchAll(ROUTE_METHOD_PATTERN_BROAD)) {
    const method = methodMatch[1]?.toUpperCase();
    if (!method) continue;
    const matchIndex = methodMatch.index ?? 0;
    const afterMethod = sourceText.slice(matchIndex);
    const pathMatch = ROUTE_PATH_PATTERN.exec(afterMethod);
    const routePath = pathMatch?.[1];
    if (!routePath) continue;
    const normalizedPath =
      routePath === '/' ? '' : routePath.startsWith('/') ? routePath : `/${routePath}`;
    const fullPath = `${prefix}${normalizedPath}`.replace(/\/+/g, '/');

    const optionsRange = findOptionsObjectRange(sourceText, matchIndex);
    if (!optionsRange) continue;
    const optionsBody = sourceText.slice(optionsRange.bodyStart, optionsRange.bodyEnd);
    const metadata = extractMetadataFromOptionsBody(optionsBody);
    entries.push({ method, fullPath, lookupKey: buildLookupKey(method, fullPath), metadata });
  }

  return entries;
}

function collectAllEntries(): RouteSchemaEntry[] {
  const entries: RouteSchemaEntry[] = [];
  for (const routeFileAbsolutePath of listDomainRouteFiles()) {
    const domainPrefix = inferDomainPrefixForFile(routeFileAbsolutePath);
    if (!domainPrefix) continue;
    entries.push(
      ...scanRouteSchemaEntries({ absolutePath: routeFileAbsolutePath, prefix: domainPrefix }),
    );
  }
  for (const supplementalFile of SUPPLEMENTAL_ROUTE_FILES) {
    entries.push(...scanRouteSchemaEntries(supplementalFile));
  }
  return entries;
}

/**
 * Every route registration with its (possibly incomplete) schema metadata —
 * including routes that declare no `summary`/`description`/`tags` at all.
 *
 * @remarks Used by the `validate:route-schema-docs` gate to flag undocumented
 * routes; {@link collectRouteSchemaMetadata} filters empty entries out, so it
 * cannot surface a route that is missing every field.
 */
export function collectAllRouteSchemaEntries(): RouteSchemaEntry[] {
  return collectAllEntries();
}

/** Map of `${METHOD} ${OPENAPI_PATH}` → schema metadata for routes that declare at least one of summary/description/tags. */
export function collectRouteSchemaMetadata(): Map<string, RouteSchemaMetadata> {
  const metadataByLookupKey = new Map<string, RouteSchemaMetadata>();
  for (const entry of collectAllEntries()) {
    if (entry.metadata.summary || entry.metadata.description || entry.metadata.tags) {
      metadataByLookupKey.set(entry.lookupKey, entry.metadata);
    }
  }
  return metadataByLookupKey;
}
