import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type ExtractedRoute = { method: string; path: string };

/**
 * Domain → URL prefix mapping.
 * Must match exactly what src/routes.ts registers.
 */
export const DOMAIN_PREFIXES: Record<string, string> = {
  audit: '/api/v1/audit',
  auth: '/api/v1/auth',
  user: '/api/v1/users',
  tenancy: '/api/v1/tenancy',
  billing: '/api/v1/billing',
  notify: '/api/v1/notify',
  upload: '/api/v1/uploads',
};

const ROUTES_DIRECTORY = join(process.cwd(), 'src', 'domains');

const ROUTE_PATTERN =
  /(?:app|zodApplication)\.(get|post|patch|put|delete)\s*(?:<[^>]+>)?\s*\(\s*['"`]([^'"`]+)['"`]/g;

export function extractRoutesFromFile(filePath: string, prefix: string): ExtractedRoute[] {
  const content = readFileSync(filePath, 'utf-8');
  const routes: ExtractedRoute[] = [];
  let match: RegExpExecArray | null;
  while ((match = ROUTE_PATTERN.exec(content)) !== null) {
    const method = match[1];
    const rawPath = match[2];
    if (!(method && rawPath)) continue;
    const path =
      prefix + (rawPath === '/' ? '' : rawPath.startsWith('/') ? rawPath : `/${rawPath}`);
    routes.push({ method: method.toUpperCase(), path });
  }
  ROUTE_PATTERN.lastIndex = 0;
  return routes;
}

export function findRouteFiles(directory: string): string[] {
  const routeFiles: string[] = [];
  try {
    const entries = readdirSync(directory);
    for (const entry of entries) {
      const fullPath = join(directory, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        routeFiles.push(...findRouteFiles(fullPath));
      } else if (entry.endsWith('.routes.ts')) {
        routeFiles.push(fullPath);
      }
    }
  } catch {
    // directory may not exist
  }
  return routeFiles;
}

export function collectRoutes(): ExtractedRoute[] {
  const seen = new Set<string>();
  const routes: ExtractedRoute[] = [];

  function addRoute(method: string, path: string): void {
    const key = `${method} ${path}`;
    if (seen.has(key)) return;
    seen.add(key);
    routes.push({ method, path });
  }

  addRoute('GET', '/health/live');
  addRoute('GET', '/health/ready');
  addRoute('GET', '/api/v1/mcp');
  addRoute('POST', '/api/v1/mcp');

  for (const [domain, prefix] of Object.entries(DOMAIN_PREFIXES)) {
    const domainDirectory = join(ROUTES_DIRECTORY, domain);
    for (const filePath of findRouteFiles(domainDirectory)) {
      for (const { method, path } of extractRoutesFromFile(filePath, prefix)) {
        addRoute(method, path);
      }
    }
  }

  return routes;
}
