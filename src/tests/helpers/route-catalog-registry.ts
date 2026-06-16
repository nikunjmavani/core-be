import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type RouteCatalogAccess =
  | 'public'
  | 'authenticated'
  | 'global-role'
  | 'org-permission'
  | 'bearer-token';

export type RouteEntry = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  domain: string;
  subDomain?: string;
  access: RouteCatalogAccess;
  description: string;
};

const ROUTE_CATALOG_PATH = join(process.cwd(), 'docs', 'routes.txt');

const DOMAIN_HEADER_PATTERN = /^\s+DOMAIN:\s+\S+\s+\(([^)]+)\)/;
const METHOD_PREFIX_PATTERN = /^\s+(GET|POST|PATCH|PUT|DELETE)\s*/;

function parseRouteCatalogLine(line: string): {
  method: RouteEntry['method'];
  path: string;
  accessToken: string;
} | null {
  const methodMatch = METHOD_PREFIX_PATTERN.exec(line);
  if (!methodMatch?.[1]) return null;

  const method = methodMatch[1] as RouteEntry['method'];
  const remainder = line.slice(methodMatch[0].length);

  // ACCESS is always the last column; the new status/idem/org columns sit between
  // path and access, so the path is the leading `/…` token rather than "everything
  // before access".
  const accessMatch =
    /\s+(PUBLIC|AUTH|ROLE:.+|PERM:.+|TOKEN:.+)\s*$/.exec(remainder) ??
    /(PERM:.+|ROLE:.+|TOKEN:.+)\s*$/.exec(remainder);
  if (!accessMatch?.[1]) return null;

  const pathMatch = /(\/\S*)/.exec(remainder);
  if (!pathMatch?.[1]) return null;

  return { method, path: pathMatch[1], accessToken: accessMatch[1] };
}

function domainSlugFromPrefix(prefix: string): string {
  if (prefix === '/livez') return 'health';
  const segments = prefix.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? 'unknown';
}

function catalogAccessToRegistry(accessToken: string): RouteCatalogAccess {
  if (accessToken === 'PUBLIC') return 'public';
  if (accessToken === 'AUTH') return 'authenticated';
  if (accessToken.startsWith('ROLE')) return 'global-role';
  if (accessToken.startsWith('TOKEN')) return 'bearer-token';
  return 'org-permission';
}

/**
 * Parses docs/routes.txt (pnpm routes:catalog) into typed route entries for tests.
 */
export function loadRouteRegistryFromCatalog(
  catalogPath: string = ROUTE_CATALOG_PATH,
): RouteEntry[] {
  const content = readFileSync(catalogPath, 'utf-8');
  const routes: RouteEntry[] = [];
  let currentDomain = 'unknown';

  for (const line of content.split('\n')) {
    if (line.startsWith('  SUMMARY')) break;

    const domainMatch = DOMAIN_HEADER_PATTERN.exec(line);
    if (domainMatch?.[1]) {
      currentDomain = domainSlugFromPrefix(domainMatch[1]);
      continue;
    }

    if (line.includes('— Sub Domains —')) continue;

    const routeMatch = parseRouteCatalogLine(line);
    if (!routeMatch) continue;

    const { method, path, accessToken } = routeMatch;
    const access = catalogAccessToRegistry(accessToken);

    routes.push({
      method,
      path,
      domain: currentDomain,
      access,
      description: `${method} ${path}`,
    });
  }

  return routes;
}

export function getRoutesByDomain(domain: string, catalogPath?: string): RouteEntry[] {
  return loadRouteRegistryFromCatalog(catalogPath).filter((route) => route.domain === domain);
}

export function getRouteCount(catalogPath?: string): number {
  return loadRouteRegistryFromCatalog(catalogPath).length;
}

export type OrganizationPermissionRoute = RouteEntry & {
  permissionCode: string;
};

/**
 * Routes from docs/routes.txt that require an organization permission (PERM: code).
 */
export function loadOrganizationPermissionRoutesFromCatalog(
  catalogPath: string = ROUTE_CATALOG_PATH,
): OrganizationPermissionRoute[] {
  const content = readFileSync(catalogPath, 'utf-8');
  const routes: OrganizationPermissionRoute[] = [];
  let currentDomain = 'unknown';

  for (const line of content.split('\n')) {
    if (line.startsWith('  SUMMARY')) break;

    const domainMatch = DOMAIN_HEADER_PATTERN.exec(line);
    if (domainMatch?.[1]) {
      currentDomain = domainSlugFromPrefix(domainMatch[1]);
      continue;
    }

    if (line.includes('— Sub Domains —')) continue;

    const routeMatch = parseRouteCatalogLine(line);
    if (!routeMatch?.accessToken.startsWith('PERM:')) continue;

    const permissionCode = routeMatch.accessToken.replace(/^PERM:\s*/, '').trim();
    routes.push({
      method: routeMatch.method,
      path: routeMatch.path,
      domain: currentDomain,
      access: 'org-permission',
      description: `${routeMatch.method} ${routeMatch.path}`,
      permissionCode,
    });
  }

  return routes;
}
