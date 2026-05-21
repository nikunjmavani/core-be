import { DOMAIN_LABELS, METHOD_ORDER } from './constants.js';
import type { ParsedRoute, RouteAccess } from './types.js';

function formatRouteLine(method: string, path: string, access: RouteAccess): string {
  const methodColumn = method.padEnd(6, ' ');
  const pathColumn = path.padEnd(55, ' ');
  return `  ${methodColumn}${pathColumn}${access}`;
}

export function buildCatalogContent(routes: ParsedRoute[]): string {
  const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const sortedRoutes = [...routes].sort((left, right) => {
    if (left.domainKey !== right.domainKey) return left.domainKey.localeCompare(right.domainKey);
    if ((left.subDomainLabel ?? '') !== (right.subDomainLabel ?? '')) {
      return (left.subDomainLabel ?? '').localeCompare(right.subDomainLabel ?? '');
    }
    if (left.fullPath !== right.fullPath) return left.fullPath.localeCompare(right.fullPath);
    return (
      METHOD_ORDER.indexOf(left.method as (typeof METHOD_ORDER)[number]) -
      METHOD_ORDER.indexOf(right.method as (typeof METHOD_ORDER)[number])
    );
  });

  const lines: string[] = [
    '================================================================================',
    '  ROUTE CATALOG — core-be',
    `  Generated: ${timestamp}`,
    `  Total routes: ${sortedRoutes.length}`,
    '================================================================================',
    '',
    'Legend:',
    '  PUBLIC  = No authentication required',
    '  AUTH    = JWT authentication required',
    '  ROLE    = Global role required (super_admin, admin, user)',
    '  PERM    = Organization-scoped permission required',
    '',
  ];

  const flushDomainHeader = (domain: string, count: number) => {
    const label = DOMAIN_LABELS[domain] ?? domain;
    lines.push('================================================================================');
    lines.push(`  DOMAIN: ${label} (${domain})`);
    lines.push(`  Routes: ${count}`);
    lines.push('================================================================================');
    lines.push('');
  };

  const routesByDomain = new Map<string, ParsedRoute[]>();
  for (const route of sortedRoutes) {
    const list = routesByDomain.get(route.domainKey) ?? [];
    list.push(route);
    routesByDomain.set(route.domainKey, list);
  }

  for (const [domainKey, domainRoutes] of [...routesByDomain.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    flushDomainHeader(domainKey, domainRoutes.length);

    let lastSubDomain = '';
    for (const route of domainRoutes) {
      if (route.subDomainLabel && route.subDomainLabel !== lastSubDomain) {
        lines.push(`  — ${route.subDomainLabel} —`);
        lastSubDomain = route.subDomainLabel;
      }
      lines.push(formatRouteLine(route.method, route.fullPath, route.access));
    }
    lines.push('');
  }

  const publicCount = sortedRoutes.filter((route) => route.access === 'PUBLIC').length;
  const authCount = sortedRoutes.filter((route) => route.access === 'AUTH').length;
  const roleCount = sortedRoutes.filter((route) => route.access.startsWith('ROLE:')).length;
  const permCount = sortedRoutes.filter((route) => route.access.startsWith('PERM:')).length;

  lines.push(
    '================================================================================',
    '  SUMMARY',
    '================================================================================',
    '',
    `  Total routes    : ${sortedRoutes.length}`,
    `  Public          : ${publicCount}`,
    `  Authenticated   : ${authCount}`,
    `  Role-guarded    : ${roleCount}`,
    `  Perm-guarded    : ${permCount}`,
    '',
    '================================================================================',
    '  IDEMPOTENCY (Idempotency-Key header)',
    '================================================================================',
    '',
    '  Optional on all POST/PUT/PATCH/DELETE when header is present (24h Redis cache).',
    '  Strongly recommended (forwarded to Stripe) on:',
    '    POST /api/v1/billing/organizations/{id}/subscriptions',
    '',
    '  See docs/reference/reliability/idempotency.md and OpenAPI operation descriptions.',
    '',
    '================================================================================',
    '  PERMISSION CODES REFERENCE',
    '================================================================================',
    '',
    '  Tenancy:',
    '    organization:read             organization:update            organization:delete',
    '    membership:read               membership:manage',
    '    invitation:manage',
    '    role:read                     role:manage',
    '    api-key:read                  api-key:manage',
    '    notification-policy:read      notification-policy:manage',
    '',
    '  Billing:',
    '    subscription:read             subscription:manage',
    '',
    '  Notify:',
    '    webhook:read                  webhook:manage',
    '',
    '  Audit:',
    '    audit-log:read',
    '',
    '  Global Roles:',
    '    super_admin                   admin                          user',
    '',
  );

  return lines.join('\n');
}

export function normalizeCatalogForCheck(content: string): string {
  return content.replace(/Generated: .+\n/, 'Generated: <timestamp>\n');
}
