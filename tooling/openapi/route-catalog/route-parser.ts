import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { classifyAccess, extractRouteSnippet } from './access-classifier.js';
import {
  DOMAINS_ROOT,
  METHOD_ORDER,
  ROUTE_METHOD_PATTERN,
  ROUTE_PATH_PATTERN,
  ROUTES_TS_PATH,
  SUPPLEMENTAL_ROUTES,
} from './constants.js';
import { listDomainRouteFiles } from './file-collectors.js';
import { loadDomainPrefixMap, loadPermissionConstantMap } from './prefix-map.js';
import type { ParsedRoute, RegistryAccess, RouteAccess } from './types.js';

export function inferSubDomain(relativePath: string): string | undefined {
  const parts = relativePath.split('/');
  if (parts.length >= 3) {
    return parts[1];
  }
  return undefined;
}

export function inferSubDomainLabel(subDomain: string | undefined): string | undefined {
  if (!subDomain) return undefined;
  return subDomain
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function inferDomainSlug(domainFolder: string, fullPath: string): string {
  if (fullPath.startsWith('/health')) return 'health';
  if (fullPath.startsWith('/api/v1/mcp')) return 'mcp';
  const apiSegment = fullPath.split('/')[3];
  if (apiSegment === 'users') return 'user';
  if (apiSegment === 'uploads') return 'upload';
  return domainFolder;
}

export function toRegistryAccess(access: RouteAccess): RegistryAccess {
  if (access === 'PUBLIC') return 'public';
  if (access === 'AUTH') return 'authenticated';
  if (access.startsWith('ROLE:')) return 'global-role';
  return 'org-permission';
}

function parseRouteFile(
  filePath: string,
  permissionMap: Map<string, string>,
  prefixByDomainFolder: Map<string, string>,
): ParsedRoute[] {
  const relativePath = relative(DOMAINS_ROOT, filePath).replace(/\\/g, '/');
  const domainFolder = relativePath.split('/')[0];
  if (!domainFolder) return [];

  const prefix = prefixByDomainFolder.get(domainFolder);
  if (!prefix) return [];

  const content = readFileSync(filePath, 'utf-8');
  const routes: ParsedRoute[] = [];
  const subDomain = inferSubDomain(relativePath);
  const subDomainLabel = inferSubDomainLabel(subDomain);

  for (const methodMatch of content.matchAll(ROUTE_METHOD_PATTERN)) {
    const method = methodMatch[1]?.toUpperCase();
    if (!method) continue;

    const matchIndex = methodMatch.index ?? 0;
    const afterMethod = content.slice(matchIndex, matchIndex + 400);
    const pathMatch = ROUTE_PATH_PATTERN.exec(afterMethod);
    const routePath = pathMatch?.[1];
    if (!routePath) continue;

    const snippet = extractRouteSnippet(content, matchIndex);
    const access = classifyAccess(snippet, permissionMap);
    const normalizedPath =
      routePath === '/' ? '' : routePath.startsWith('/') ? routePath : `/${routePath}`;
    const fullPath = `${prefix}${normalizedPath}`.replace(/\/+/g, '/');

    routes.push(
      omitUndefined({
        method,
        fullPath,
        access,
        domainKey: prefix,
        domain: inferDomainSlug(domainFolder, fullPath),
        subDomain,
        subDomainLabel,
      }),
    );
  }

  return routes;
}

export function sortParsedRoutes(routes: ParsedRoute[]): ParsedRoute[] {
  return [...routes].sort((left, right) => {
    if (left.domain !== right.domain) return left.domain.localeCompare(right.domain);
    if ((left.subDomain ?? '') !== (right.subDomain ?? '')) {
      return (left.subDomain ?? '').localeCompare(right.subDomain ?? '');
    }
    if (left.fullPath !== right.fullPath) return left.fullPath.localeCompare(right.fullPath);
    return (
      METHOD_ORDER.indexOf(left.method as (typeof METHOD_ORDER)[number]) -
      METHOD_ORDER.indexOf(right.method as (typeof METHOD_ORDER)[number])
    );
  });
}

export function collectAllParsedRoutes(): ParsedRoute[] {
  const permissionMap = loadPermissionConstantMap();
  const routesTsContent = readFileSync(ROUTES_TS_PATH, 'utf-8');
  const prefixByDomainFolder = loadDomainPrefixMap(routesTsContent);

  const allRoutes: ParsedRoute[] = [...SUPPLEMENTAL_ROUTES];
  for (const filePath of listDomainRouteFiles()) {
    allRoutes.push(...parseRouteFile(filePath, permissionMap, prefixByDomainFolder));
  }

  return sortParsedRoutes(allRoutes);
}
