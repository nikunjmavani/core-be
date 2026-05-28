/**
 * Pulls Fastify route entries grouped by source `*.routes.ts` file.
 *
 * Description source: `summary` / `description` literal on the Fastify route
 * schema (Zod schema-level). Routes that have not migrated onto a Zod schema
 * yet emit `MISSING_DESCRIPTION` tokens through the renderer.
 *
 * Discovery walks every `src/domains/**\/*.routes.ts` directly so each route
 * is keyed back to its actual source file (avoids brittle path-guessing when
 * a sub-domain folder name and its routes filename differ — e.g. folder
 * `member-roles/` with file `member-role.routes.ts`).
 */
import { readFileSync } from 'node:fs';
import { dirname, relative, sep } from 'node:path';
import {
  classifyAccess,
  extractRouteSnippet,
} from '@tooling/openapi/route-catalog/access-classifier.js';
import {
  ROUTE_METHOD_PATTERN,
  ROUTE_PATH_PATTERN,
} from '@tooling/openapi/route-catalog/constants.js';
import { listDomainRouteFiles } from '@tooling/openapi/route-catalog/file-collectors.js';
import {
  loadDomainPrefixMap,
  loadPermissionConstantMap,
} from '@tooling/openapi/route-catalog/prefix-map.js';
import { REPO_ROOT } from './constants.js';
import type { RouteEntry } from './types.js';

interface RoutesByFolder {
  routesByFolderRelativePath: Map<string, RouteEntry[]>;
  totalRoutes: number;
}

interface RouteSourceMatch {
  method: string;
  fullPath: string;
  schemaSummary: string | null;
  schemaDescription: string | null;
  routeStartIndex: number;
}

const SCHEMA_BLOCK_PATTERN = /schema\s*:\s*\{([\s\S]*?)\}\s*,/;
const SUMMARY_LITERAL_PATTERN = /summary\s*:\s*(['"`])([\s\S]*?)\1/;
const DESCRIPTION_LITERAL_PATTERN = /description\s*:\s*(['"`])([\s\S]*?)\1/;

const SUPPLEMENTAL_ENTRIES_BY_FOLDER: Array<{
  folderRelativePath: string;
  entry: RouteEntry;
}> = [
  {
    folderRelativePath: 'src/shared/middlewares',
    entry: {
      method: 'GET',
      fullPath: '/health',
      access: 'PUBLIC',
      summary: null,
      description: null,
      source: 'unknown',
    },
  },
];

function extractRoutesFromFile(
  routeFileAbsolutePath: string,
  domainPrefix: string,
  permissionMap: Map<string, string>,
): RouteEntry[] {
  const sourceText = readFileSync(routeFileAbsolutePath, 'utf-8');
  const matches: RouteSourceMatch[] = [];

  for (const methodMatch of sourceText.matchAll(ROUTE_METHOD_PATTERN)) {
    const method = methodMatch[1]?.toUpperCase();
    if (!method) continue;
    const matchIndex = methodMatch.index ?? 0;
    const afterMethod = sourceText.slice(matchIndex, matchIndex + 600);
    const pathMatch = ROUTE_PATH_PATTERN.exec(afterMethod);
    const routePath = pathMatch?.[1];
    if (!routePath) continue;

    const normalizedPath =
      routePath === '/' ? '' : routePath.startsWith('/') ? routePath : `/${routePath}`;
    const fullPath = `${domainPrefix}${normalizedPath}`.replace(/\/+/g, '/');

    const schemaMatch = SCHEMA_BLOCK_PATTERN.exec(afterMethod);
    let schemaSummary: string | null = null;
    let schemaDescription: string | null = null;
    if (schemaMatch) {
      const schemaBody = schemaMatch[1] ?? '';
      const summaryLiteralMatch = SUMMARY_LITERAL_PATTERN.exec(schemaBody);
      const descriptionLiteralMatch = DESCRIPTION_LITERAL_PATTERN.exec(schemaBody);
      schemaSummary = summaryLiteralMatch?.[2] ?? null;
      schemaDescription = descriptionLiteralMatch?.[2] ?? null;
    }

    matches.push({
      method,
      fullPath,
      schemaSummary,
      schemaDescription,
      routeStartIndex: matchIndex,
    });
  }

  return matches.map((match) => buildRouteEntry(match, sourceText, permissionMap));
}

function buildRouteEntry(
  match: RouteSourceMatch,
  sourceText: string,
  permissionMap: Map<string, string>,
): RouteEntry {
  const snippet = extractRouteSnippet(sourceText, match.routeStartIndex);
  const access = classifyAccess(snippet, permissionMap);

  const summary = match.schemaSummary;
  const description = match.schemaDescription;
  const source: RouteEntry['source'] = summary || description ? 'zod-schema' : 'unknown';

  return {
    method: match.method,
    fullPath: match.fullPath,
    access,
    summary,
    description,
    source,
  };
}

function findDomainPrefixForFile(
  routeFileAbsolutePath: string,
  prefixByDomainFolder: Map<string, string>,
): string | null {
  const segments = routeFileAbsolutePath.split(sep);
  const domainsIndex = segments.lastIndexOf('domains');
  if (domainsIndex === -1) return null;
  const domainFolder = segments[domainsIndex + 1];
  if (!domainFolder) return null;
  return prefixByDomainFolder.get(domainFolder) ?? null;
}

export function collectRoutesByFolder(): RoutesByFolder {
  const permissionMap = loadPermissionConstantMap();
  const routesTsContent = readFileSync(`${REPO_ROOT}/src/routes.ts`, 'utf-8');
  const prefixByDomainFolder = loadDomainPrefixMap(routesTsContent);
  const routeFiles = listDomainRouteFiles();

  const routesByFolderRelativePath = new Map<string, RouteEntry[]>();
  let totalRoutes = 0;

  for (const routeFileAbsolutePath of routeFiles) {
    const domainPrefix = findDomainPrefixForFile(routeFileAbsolutePath, prefixByDomainFolder);
    if (!domainPrefix) continue;
    const routes = extractRoutesFromFile(routeFileAbsolutePath, domainPrefix, permissionMap);
    if (routes.length === 0) continue;

    const folderRelativePath = relative(REPO_ROOT, dirname(routeFileAbsolutePath))
      .split(sep)
      .join('/');
    const list = routesByFolderRelativePath.get(folderRelativePath) ?? [];
    list.push(...routes);
    routesByFolderRelativePath.set(folderRelativePath, list);
    totalRoutes += routes.length;
  }

  for (const supplemental of SUPPLEMENTAL_ENTRIES_BY_FOLDER) {
    const list = routesByFolderRelativePath.get(supplemental.folderRelativePath) ?? [];
    list.push(supplemental.entry);
    routesByFolderRelativePath.set(supplemental.folderRelativePath, list);
    totalRoutes += 1;
  }

  for (const list of routesByFolderRelativePath.values()) {
    list.sort((left, right) => {
      if (left.fullPath !== right.fullPath) return left.fullPath.localeCompare(right.fullPath);
      return left.method.localeCompare(right.method);
    });
  }

  return { routesByFolderRelativePath, totalRoutes };
}
