import { join } from 'node:path';
import type { ParsedRoute } from './types.js';

export const DOMAINS_ROOT = join(process.cwd(), 'src', 'domains');
export const ROUTES_TS_PATH = join(process.cwd(), 'src', 'routes.ts');
export const CATALOG_OUTPUT_PATH = join(process.cwd(), 'docs', 'routes.txt');
export const METHOD_ORDER = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const;

export const DOMAIN_LABELS: Record<string, string> = {
  '/api/v1/auth': 'AUTH',
  '/api/v1/users': 'USER',
  '/api/v1/audit': 'AUDIT',
  '/api/v1/tenancy': 'TENANCY',
  '/api/v1/billing': 'BILLING',
  '/api/v1/notify': 'NOTIFY',
  '/api/v1/uploads': 'UPLOAD',
  '/api/v1/mcp': 'MCP',
  '/health': 'HEALTH',
};

export const ROUTE_METHOD_PATTERN = /(?:app|zodApplication)\.(get|post|patch|put|delete)/g;
export const ROUTE_PATH_PATTERN = /['"]([/][^'"]*)['"]/;

export const SUPPLEMENTAL_ROUTES: ParsedRoute[] = [
  {
    method: 'GET',
    fullPath: '/health',
    access: 'PUBLIC',
    domainKey: '/health',
    domain: 'health',
  },
  {
    method: 'GET',
    fullPath: '/api/v1/mcp',
    access: 'AUTH',
    domainKey: '/api/v1/mcp',
    domain: 'mcp',
  },
  {
    method: 'POST',
    fullPath: '/api/v1/mcp',
    access: 'AUTH',
    domainKey: '/api/v1/mcp',
    domain: 'mcp',
  },
];
