import { DOMAIN_LABELS, METHOD_ORDER } from './constants.js';
import type { ParsedRoute } from './types.js';

function formatRouteLine(route: ParsedRoute): string {
  const methodColumn = route.method.padEnd(6, ' ');
  const pathColumn = route.fullPath.padEnd(55, ' ');
  const status = String(route.successStatus ?? '???').padEnd(3, ' ');
  const idempotency = (route.idempotencyRequired ? 'req' : '-').padEnd(3, ' ');
  const orgScope = (route.orgScope ?? 'both').padEnd(4, ' ');
  // ACCESS stays the LAST column (variable width, may contain spaces) so the
  // catalog parsers can anchor on it. New columns sit between path and access.
  return `  ${methodColumn} ${pathColumn} ${status} ${idempotency} ${orgScope} ${route.access}`;
}

export function buildCatalogContent(routes: ParsedRoute[]): string {
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
    `  Total routes: ${sortedRoutes.length}`,
    '================================================================================',
    '',
    'Legend:',
    '  Columns:  METHOD  PATH  <status>  <idem>  <org>  ACCESS',
    '    status = documented happy-path HTTP status (200 / 201 / 204)',
    "    idem   = 'req' when the Idempotency-Key header is required, else '-'",
    "    org    = 'team' (rejected with 422 on a personal organization) or 'both'",
    '  ACCESS (last column):',
    '    PUBLIC  = No authentication required',
    '    AUTH    = JWT authentication required',
    '    ROLE    = Global role required (super_admin, admin, user)',
    '    PERM    = Organization-scoped permission required',
    '    TOKEN   = Non-JWT bearer token required',
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
      lines.push(formatRouteLine(route));
    }
    lines.push('');
  }

  const publicCount = sortedRoutes.filter((route) => route.access === 'PUBLIC').length;
  const authCount = sortedRoutes.filter((route) => route.access === 'AUTH').length;
  const roleCount = sortedRoutes.filter((route) => route.access.startsWith('ROLE:')).length;
  const permCount = sortedRoutes.filter((route) => route.access.startsWith('PERM:')).length;
  const tokenCount = sortedRoutes.filter((route) => route.access.startsWith('TOKEN:')).length;

  const formatKey = (route: ParsedRoute) => `    ${route.method} ${route.fullPath}`;
  const idempotencyRequiredRoutes = sortedRoutes
    .filter((route) => route.idempotencyRequired)
    .map(formatKey);
  const teamOnlyRoutes = sortedRoutes.filter((route) => route.orgScope === 'team').map(formatKey);
  const deprecatedRoutes = sortedRoutes.filter((route) => route.deprecated).map(formatKey);

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
    `  Token-guarded   : ${tokenCount}`,
    '',
    '================================================================================',
    '  IDEMPOTENCY (Idempotency-Key header)',
    '================================================================================',
    '',
    '  Optional on all POST/PUT/PATCH/DELETE when the header is present (24h Redis cache).',
    `  REQUIRED (the write fails without it) on these ${idempotencyRequiredRoutes.length} routes:`,
    ...idempotencyRequiredRoutes,
    '',
    '  See docs/reference/reliability/idempotency.md and OpenAPI operation descriptions.',
    '',
    '================================================================================',
    '  ACTIVE-ORGANIZATION SCOPE (org column)',
    '================================================================================',
    '',
    '  TEAM-only routes — a PERSONAL (single-member) organization rejects these with',
    '  422. The active-org GET response exposes a `capabilities` object so clients can',
    '  branch without trial-and-error. See docs/reference/api/route-consistency-and-org-model.md.',
    ...(teamOnlyRoutes.length > 0 ? teamOnlyRoutes : ['    (none)']),
    '',
    '================================================================================',
    '  DEPRECATED ROUTES (Sunset / Deprecation headers)',
    '================================================================================',
    '',
    ...(deprecatedRoutes.length > 0 ? deprecatedRoutes : ['    (none)']),
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
