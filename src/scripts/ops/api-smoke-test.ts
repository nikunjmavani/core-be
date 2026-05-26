/**
 * Full-domain API smoke tests against a running server with full seed.
 * Verifies each domain's key routes respond (not 5xx) with demo credentials.
 *
 * Requires: docker compose up -d, pnpm db:migrate, pnpm db:seed:full,
 *           pnpm dev + pnpm dev:worker
 *
 * Usage: pnpm test:api-smoke
 * Env: BASE_URL (default http://localhost:3000), TEST_EMAIL, TEST_PASSWORD
 * Deploy CD sets BASE_URL from Railway API domain; optional GitHub secrets SMOKE_DEMO_EMAIL / SMOKE_DEMO_PASSWORD
 */
import '@/shared/config/load-env-files.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const API_PREFIX = '/api/v1';
const EMAIL = process.env.TEST_EMAIL ?? 'demo@example.com';
const PASSWORD = process.env.TEST_PASSWORD ?? 'DemoPassword123!';

/** Acceptable HTTP statuses (route reachable, auth/validation handled). */
type ExpectedStatus = number | number[];

interface RouteProbe {
  name: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  authenticated?: boolean;
  needsOrganization?: boolean;
  expectedStatus: ExpectedStatus;
  body?: unknown;
}

interface SmokeContext {
  accessToken?: string;
  organizationId?: string;
  planId?: string;
  roleId?: string;
}

const smokeContext: SmokeContext = {};

function assertStatus(actual: number, expected: ExpectedStatus, detail: string): void {
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(actual)) {
    throw new Error(`${detail}: expected ${allowed.join('|')}, got ${actual}`);
  }
}

async function requestJson(
  path: string,
  options: RequestInit & { expectedStatus?: ExpectedStatus } = {},
): Promise<{ status: number; body: unknown }> {
  const { expectedStatus, ...fetchOptions } = options;
  const response = await fetch(`${BASE_URL}${path}`, fetchOptions);
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }
  if (expectedStatus !== undefined) {
    assertStatus(response.status, expectedStatus, `${fetchOptions.method ?? 'GET'} ${path}`);
  }
  if (response.status >= 500) {
    throw new Error(`${path}: server error ${response.status} — ${text.slice(0, 200)}`);
  }
  return { status: response.status, body };
}

function authHeaders(includeOrganization = false): Record<string, string> {
  const token = requireToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
  if (includeOrganization) {
    headers['X-Organization-Id'] = requireOrganizationId();
  }
  return headers;
}

function requireToken(): string {
  if (!smokeContext.accessToken) {
    throw new Error('access token not set — login must run first');
  }
  return smokeContext.accessToken;
}

function requireOrganizationId(): string {
  if (!smokeContext.organizationId) {
    throw new Error('organization id not set — list organizations must run first');
  }
  return smokeContext.organizationId;
}

function organizationPath(suffix: string): string {
  return `${API_PREFIX}/tenancy/organizations/${requireOrganizationId()}${suffix}`;
}

function billingOrganizationPath(suffix: string): string {
  return `${API_PREFIX}/billing/organizations/${requireOrganizationId()}${suffix}`;
}

function notifyOrganizationPath(suffix: string): string {
  return `${API_PREFIX}/notify/organizations/${requireOrganizationId()}${suffix}`;
}

async function runProbe(probe: RouteProbe): Promise<void> {
  const method = probe.method ?? 'GET';
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(probe.body ? { 'Content-Type': 'application/json' } : {}),
  };
  const useAuthentication = probe.authenticated === true || probe.needsOrganization === true;
  if (useAuthentication) {
    Object.assign(headers, authHeaders(probe.needsOrganization === true));
  }

  await requestJson(
    probe.path,
    omitUndefined({
      method,
      headers,
      body: probe.body !== undefined ? JSON.stringify(probe.body) : undefined,
      expectedStatus: probe.expectedStatus,
    }),
  );
}

async function setupLogin(): Promise<void> {
  const { body } = await requestJson(`${API_PREFIX}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    expectedStatus: 200,
  });
  const payload = body as { data?: { access_token?: string } };
  if (!payload.data?.access_token) {
    throw new Error('login: missing access_token — run pnpm db:seed:full with TEST_PASSWORD');
  }
  smokeContext.accessToken = payload.data.access_token;
}

async function setupOrganization(): Promise<void> {
  const { body } = await requestJson(`${API_PREFIX}/tenancy/organizations`, {
    headers: authHeaders(false),
    expectedStatus: 200,
  });
  const payload = body as { data?: Array<{ id?: string; slug?: string }> };
  const organizations = payload.data ?? [];
  if (organizations.length === 0) {
    throw new Error('organizations: empty — run pnpm db:seed:full');
  }
  const demoOrganization =
    organizations.find((organization) => organization.slug === 'demo-org') ?? organizations[0];
  if (!demoOrganization?.id) {
    throw new Error('organizations: missing public id');
  }
  smokeContext.organizationId = demoOrganization.id;
}

async function setupPlanAndRoleIds(): Promise<void> {
  const organizationId = requireOrganizationId();

  const plansResponse = await requestJson(`${API_PREFIX}/billing/plans`, {
    headers: authHeaders(true),
    expectedStatus: 200,
  });
  const plansBody = plansResponse.body as { data?: Array<{ id?: string }> };
  const planId = plansBody.data?.[0]?.id;
  if (planId !== undefined) {
    smokeContext.planId = planId;
  }

  const rolesResponse = await requestJson(
    `${API_PREFIX}/tenancy/organizations/${organizationId}/roles`,
    { headers: authHeaders(true), expectedStatus: 200 },
  );
  const rolesBody = rolesResponse.body as { data?: Array<{ id?: string }> };
  const roleId = rolesBody.data?.[0]?.id;
  if (roleId !== undefined) {
    smokeContext.roleId = roleId;
  }
}

/** Routes grouped by domain — GET-heavy probes that should not 5xx with seeded demo user. */
function buildDomainProbes(): RouteProbe[] {
  const organizationId = () => requireOrganizationId();
  const planId = () => smokeContext.planId ?? 'missing-plan-id';
  const roleId = () => smokeContext.roleId ?? 'missing-role-id';

  const probes = [
    // ── Public ────────────────────────────────────────────────────────
    {
      name: 'POST /api/v1/auth/login (invalid password)',
      method: 'POST',
      path: `${API_PREFIX}/auth/login`,
      expectedStatus: [401, 404],
      body: { email: EMAIL, password: 'wrong-password' },
    },
    {
      name: 'POST /api/v1/auth/logout (public, no session)',
      method: 'POST',
      path: `${API_PREFIX}/auth/logout`,
      expectedStatus: [200, 204, 401],
    },
    {
      name: 'POST /api/v1/auth/magic-link/send',
      method: 'POST',
      path: `${API_PREFIX}/auth/magic-link/send`,
      expectedStatus: [200, 202],
      body: { email: EMAIL },
    },

    // ── Auth (authenticated) ─────────────────────────────────────────
    {
      name: 'GET /api/v1/tenancy/permissions',
      path: `${API_PREFIX}/tenancy/permissions`,
      authenticated: true,
      expectedStatus: 200,
    },
    {
      name: 'GET /api/v1/auth/me/sessions',
      path: `${API_PREFIX}/auth/me/sessions`,
      authenticated: true,
      expectedStatus: 200,
    },
    {
      name: 'GET /api/v1/auth/oauth/providers',
      path: `${API_PREFIX}/auth/oauth/providers`,
      authenticated: true,
      expectedStatus: 200,
    },
    {
      name: 'GET /api/v1/tenancy/invitations/pending',
      path: `${API_PREFIX}/tenancy/invitations/pending`,
      authenticated: true,
      expectedStatus: 200,
    },

    // ── User ──────────────────────────────────────────────────────────
    {
      name: 'GET /api/v1/users/me',
      path: `${API_PREFIX}/users/me`,
      authenticated: true,
      expectedStatus: 200,
    },
    {
      name: 'GET /api/v1/users/me/settings',
      path: `${API_PREFIX}/users/me/settings`,
      authenticated: true,
      expectedStatus: 200,
    },
    {
      name: 'GET /api/v1/users/me/notification-preferences',
      path: `${API_PREFIX}/users/me/notification-preferences`,
      authenticated: true,
      expectedStatus: 200,
    },

    // ── Tenancy ───────────────────────────────────────────────────────
    {
      name: 'GET /api/v1/tenancy/organizations',
      path: `${API_PREFIX}/tenancy/organizations`,
      authenticated: true,
      expectedStatus: 200,
    },
    {
      name: 'GET /api/v1/tenancy/organizations/:id',
      path: () => `${API_PREFIX}/tenancy/organizations/${organizationId()}`,
      authenticated: true,
      needsOrganization: true,
      expectedStatus: 200,
    },
    {
      name: 'GET /api/v1/tenancy/organizations/by-slug/demo-org',
      path: () => `${API_PREFIX}/tenancy/organizations/by-slug/demo-org`,
      authenticated: true,
      needsOrganization: true,
      expectedStatus: 200,
    },
    {
      name: 'GET /api/v1/tenancy/organizations/:id/settings',
      path: () => organizationPath('/settings'),
      needsOrganization: true,
      expectedStatus: 200,
    },
    {
      name: 'GET /api/v1/tenancy/organizations/:id/roles',
      path: () => organizationPath('/roles'),
      needsOrganization: true,
      expectedStatus: 200,
    },
    {
      name: 'GET /api/v1/tenancy/organizations/:id/roles/:roleId',
      path: () => organizationPath(`/roles/${roleId()}`),
      needsOrganization: true,
      expectedStatus: [200, 404],
    },
    {
      name: 'GET /api/v1/tenancy/organizations/:id/roles/:roleId/permissions',
      path: () => organizationPath(`/roles/${roleId()}/permissions`),
      needsOrganization: true,
      expectedStatus: [200, 404],
    },
    {
      name: 'GET /api/v1/tenancy/organizations/:id/memberships',
      path: () => organizationPath('/memberships'),
      needsOrganization: true,
      expectedStatus: 200,
    },
    {
      name: 'GET /api/v1/tenancy/organizations/:id/invitations',
      path: () => organizationPath('/invitations'),
      needsOrganization: true,
      expectedStatus: 200,
    },
    {
      name: 'GET /api/v1/tenancy/organizations/:id/api-keys',
      path: () => organizationPath('/api-keys'),
      needsOrganization: true,
      expectedStatus: 200,
    },
    {
      name: 'GET /api/v1/tenancy/organizations/:id/notification-policies',
      path: () => organizationPath('/notification-policies'),
      needsOrganization: true,
      expectedStatus: 200,
    },
    {
      name: 'GET /api/v1/tenancy/organizations/:id/audit-logs',
      path: () => organizationPath('/audit-logs'),
      needsOrganization: true,
      expectedStatus: 200,
    },

    // ── Billing ───────────────────────────────────────────────────────
    {
      name: 'GET /api/v1/billing/plans',
      path: `${API_PREFIX}/billing/plans`,
      authenticated: true,
      expectedStatus: 200,
    },
    {
      name: 'GET /api/v1/billing/plans/:id',
      path: () => `${API_PREFIX}/billing/plans/${planId()}`,
      authenticated: true,
      needsOrganization: true,
      expectedStatus: [200, 404],
    },
    {
      name: 'GET /api/v1/billing/organizations/:id/subscriptions',
      path: () => billingOrganizationPath('/subscriptions'),
      needsOrganization: true,
      expectedStatus: 200,
    },
    // ── Notify ────────────────────────────────────────────────────────
    {
      name: 'GET /api/v1/notify/notifications',
      path: `${API_PREFIX}/notify/notifications`,
      authenticated: true,
      expectedStatus: 200,
    },
    {
      name: 'GET /api/v1/notify/notifications/unread-count',
      path: `${API_PREFIX}/notify/notifications/unread-count`,
      needsOrganization: true,
      expectedStatus: [200, 403],
    },
    {
      name: 'GET /api/v1/notify/organizations/:id/webhooks',
      path: () => notifyOrganizationPath('/webhooks'),
      needsOrganization: true,
      expectedStatus: 200,
    },
    {
      name: 'GET /api/v1/notify/organizations/:id/webhook-events',
      path: () => notifyOrganizationPath('/webhook-events'),
      needsOrganization: true,
      expectedStatus: 200,
    },

    // ── Audit (global role — demo user is "user", expect 403) ───────────
    {
      name: 'GET /api/v1/audit/logs (global admin only)',
      path: `${API_PREFIX}/audit/logs`,
      authenticated: true,
      expectedStatus: 403,
    },

    // ── Upload ────────────────────────────────────────────────────────
    {
      name: 'POST /api/v1/uploads (no token)',
      method: 'POST',
      path: `${API_PREFIX}/uploads`,
      expectedStatus: 401,
      body: {},
    },

    // ── Unauthorized ──────────────────────────────────────────────────
    {
      name: 'GET /api/v1/users/me (no token)',
      path: `${API_PREFIX}/users/me`,
      expectedStatus: 401,
    },
    {
      name: 'PATCH /api/v1/users/me/settings (no token)',
      method: 'PATCH',
      path: `${API_PREFIX}/users/me/settings`,
      expectedStatus: 401,
      body: { locale: 'en' },
    },
  ];

  return probes.map((probe) => ({
    ...probe,
    path: typeof probe.path === 'function' ? probe.path() : probe.path,
  })) as RouteProbe[];
}

const healthProbes: RouteProbe[] = [
  {
    name: 'GET /health',
    path: '/health',
    expectedStatus: 200,
  },
];

async function main(): Promise<void> {
  console.log(`API smoke tests (all domains) → ${BASE_URL}`);
  console.log(`User: ${EMAIL}\n`);

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  const runCase = async (label: string, run: () => Promise<void>): Promise<void> => {
    try {
      await run();
      console.log(`  ✓ ${label}`);
      passed += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${label}: ${message}`);
      failures.push(`${label}: ${message}`);
    }
  };

  for (const probe of healthProbes) {
    await runCase(probe.name, () => runProbe(probe));
  }

  await runCase('setup: login', setupLogin);
  if (!smokeContext.accessToken) {
    console.error('\nSetup failed — run: TEST_PASSWORD=DemoPassword123! pnpm db:seed:full');
    process.exit(1);
  }

  await runCase('setup: organizations', setupOrganization);
  await runCase('setup: plan and role ids', setupPlanAndRoleIds);

  if (!smokeContext.organizationId) {
    console.error('\nSetup failed — demo organization missing after seed');
    process.exit(1);
  }

  const domainProbes = buildDomainProbes();
  for (const probe of domainProbes) {
    await runCase(probe.name, () => runProbe(probe));
  }

  console.log(
    `\n${passed} passed, ${failed} failed (${domainProbes.length + healthProbes.length + 3} checks)`,
  );

  if (smokeContext.accessToken && smokeContext.organizationId) {
    console.log('\nFor Postman / k6:');
    console.log(`  export TEST_TOKEN="${smokeContext.accessToken}"`);
    console.log(`  export TEST_ORG_ID="${smokeContext.organizationId}"`);
  }

  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const failure of failures) {
      console.log(`  - ${failure}`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
