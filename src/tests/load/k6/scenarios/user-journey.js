/**
 * k6 Scenario: Realistic Per-VU User Journey
 *
 * Every VU authenticates as a DISTINCT user from the credential pool, so
 * 100 VUs = 100 independent user sessions — not 100 copies of the same token.
 *
 * Prerequisites:
 *   pnpm db:seed:loadtest          — seeds 12 orgs × 10 users with full domain data
 *                                    and writes src/tests/load/k6/data/credential-pool.json
 *   RATE_LIMIT_MAX=10000 pnpm dev  — raise the rate limit for load testing
 *
 * Run:
 *   pnpm load:user-journey
 *
 * Domains exercised per iteration (reads + writes):
 *   user      — GET /users/me, GET /users/me/settings, PATCH /users/me/settings,
 *               GET /users/me/notification-preferences
 *   auth      — GET /auth/me/sessions
 *   tenancy   — GET /tenancy/organizations, GET …/:id, GET …/:id/settings,
 *               PATCH …/:id/settings, GET …/:id/memberships, GET …/:id/roles,
 *               GET …/:id/api-keys
 *   billing   — GET /billing/plans, GET /billing/organizations/:id/subscriptions
 *   notify    — GET /notify/notifications, GET …/unread-count,
 *               POST …/mark-all-read (write),
 *               GET /notify/organizations/:id/webhooks,
 *               POST + DELETE one webhook per iteration (write + cleanup)
 *   upload    — POST /uploads (presigned URL request only — no actual S3 upload)
 *
 * Not included (destructive / requires special state):
 *   DELETE /users/me, POST /auth/logout (would break the VU's subsequent iterations),
 *   billing mutations (require live Stripe), MFA/WebAuthn (require device state),
 *   admin-only routes (super_admin role)
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import { API_PREFIX, SCENARIOS, STRICT_THRESHOLDS } from '../helpers/config.js';
import { checkOk, checkResponseTime } from '../helpers/checks.js';
import { authHeaders } from '../helpers/auth.js';
import { credentialPool, mintTokenPool, vuToken } from '../helpers/pool.js';

// ---------------------------------------------------------------------------
// Scenario options
// ---------------------------------------------------------------------------

export const options = {
  scenarios: {
    user_journey: {
      ...SCENARIOS.load,
      exec: 'userJourney',
    },
  },
  thresholds: {
    ...STRICT_THRESHOLDS,
    // Profile reads
    'http_req_duration{name:get-me}': ['p(95)<300', 'p(99)<600'],
    'http_req_duration{name:get-me-settings}': ['p(95)<300', 'p(99)<600'],
    'http_req_duration{name:patch-me-settings}': ['p(95)<500', 'p(99)<1000'],
    'http_req_duration{name:get-sessions}': ['p(95)<400', 'p(99)<800'],
    'http_req_duration{name:get-notif-prefs}': ['p(95)<300', 'p(99)<600'],
    // Org reads + writes
    'http_req_duration{name:list-orgs}': ['p(95)<500', 'p(99)<1000'],
    'http_req_duration{name:get-org}': ['p(95)<400', 'p(99)<800'],
    'http_req_duration{name:get-org-settings}': ['p(95)<400', 'p(99)<800'],
    'http_req_duration{name:patch-org-settings}': ['p(95)<600', 'p(99)<1200'],
    'http_req_duration{name:list-members}': ['p(95)<500', 'p(99)<1000'],
    'http_req_duration{name:list-roles}': ['p(95)<400', 'p(99)<800'],
    'http_req_duration{name:list-api-keys}': ['p(95)<400', 'p(99)<800'],
    // Billing
    'http_req_duration{name:list-plans}': ['p(95)<300', 'p(99)<600'],
    'http_req_duration{name:list-subscriptions}': ['p(95)<500', 'p(99)<1000'],
    // Notifications
    'http_req_duration{name:list-notifications}': ['p(95)<500', 'p(99)<1000'],
    'http_req_duration{name:unread-count}': ['p(95)<200', 'p(99)<400'],
    'http_req_duration{name:mark-all-read}': ['p(95)<400', 'p(99)<800'],
    // Webhooks
    'http_req_duration{name:list-webhooks}': ['p(95)<500', 'p(99)<1000'],
    'http_req_duration{name:create-webhook}': ['p(95)<600', 'p(99)<1200'],
    'http_req_duration{name:delete-webhook}': ['p(95)<400', 'p(99)<800'],
    // Upload
    'http_req_duration{name:request-upload}': ['p(95)<600', 'p(99)<1200'],
  },
};

// ---------------------------------------------------------------------------
// setup() — runs ONCE before any VU starts
// ---------------------------------------------------------------------------

/**
 * Logs in every user in the credential pool (sequentially, once total) and
 * returns the token array that VUs index into. Argon2id is exercised N times
 * total — not N × iterations — so server CPU is not the bottleneck.
 *
 * @returns {Array<{token: string, orgPublicId: string, userPublicId: string}>}
 */
export function setup() {
  return mintTokenPool(credentialPool);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Headers for authenticated, org-scoped requests.
 * Merges Authorization, Content-Type, and X-Organization-Id.
 */
function orgHeaders(token, orgPublicId) {
  return {
    ...authHeaders(token).headers,
    'X-Organization-Id': orgPublicId,
  };
}

/** Parse `data` from a JSON response, or null on failure. */
function parseData(response) {
  try {
    return JSON.parse(response.body)?.data ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main VU function
// ---------------------------------------------------------------------------

/**
 * One iteration = one realistic authenticated user session spanning all
 * major domains. Each VU uses its own token + org, so no cross-VU contention.
 *
 * @param {Array<{token: string, orgPublicId: string, userPublicId: string}>} tokenPool
 */
export function userJourney(tokenPool) {
  const entry = vuToken(tokenPool);
  if (!entry?.token) {
    console.error(`VU ${__VU}: no token in pool — ensure setup() succeeded`);
    return;
  }

  const { token, orgPublicId } = entry;
  const authed = authHeaders(token).headers;
  const withOrg = orgHeaders(token, orgPublicId);
  const json = { 'Content-Type': 'application/json' };

  // ── Phase 1: Profile reads ──────────────────────────────────────────────

  const meRes = http.get(`${API_PREFIX}/users/me`, {
    headers: authed,
    tags: { name: 'get-me' },
  });
  checkOk(meRes, 'get-me');
  checkResponseTime(meRes, 300, 'get-me');
  sleep(0.2);

  const settingsRes = http.get(`${API_PREFIX}/users/me/settings`, {
    headers: authed,
    tags: { name: 'get-me-settings' },
  });
  checkOk(settingsRes, 'get-me-settings');
  checkResponseTime(settingsRes, 300, 'get-me-settings');
  sleep(0.2);

  const sessionsRes = http.get(`${API_PREFIX}/auth/me/sessions`, {
    headers: authed,
    tags: { name: 'get-sessions' },
  });
  checkOk(sessionsRes, 'get-sessions');
  checkResponseTime(sessionsRes, 400, 'get-sessions');
  sleep(0.2);

  const notifPrefsRes = http.get(`${API_PREFIX}/users/me/notification-preferences`, {
    headers: authed,
    tags: { name: 'get-notif-prefs' },
  });
  checkOk(notifPrefsRes, 'get-notif-prefs');
  checkResponseTime(notifPrefsRes, 300, 'get-notif-prefs');
  sleep(0.3);

  // ── Phase 2: Org reads ───────────────────────────────────────────────────

  const listOrgsRes = http.get(`${API_PREFIX}/tenancy/organizations`, {
    headers: authed,
    tags: { name: 'list-orgs' },
  });
  checkOk(listOrgsRes, 'list-orgs');
  checkResponseTime(listOrgsRes, 500, 'list-orgs');
  sleep(0.2);

  const getOrgRes = http.get(`${API_PREFIX}/tenancy/organizations/${orgPublicId}`, {
    headers: authed,
    tags: { name: 'get-org' },
  });
  checkOk(getOrgRes, 'get-org');
  checkResponseTime(getOrgRes, 400, 'get-org');
  sleep(0.2);

  const orgSettingsRes = http.get(`${API_PREFIX}/tenancy/organizations/${orgPublicId}/settings`, {
    headers: withOrg,
    tags: { name: 'get-org-settings' },
  });
  checkOk(orgSettingsRes, 'get-org-settings');
  checkResponseTime(orgSettingsRes, 400, 'get-org-settings');
  sleep(0.2);

  const listMembersRes = http.get(
    `${API_PREFIX}/tenancy/organizations/${orgPublicId}/memberships`,
    { headers: withOrg, tags: { name: 'list-members' } },
  );
  checkOk(listMembersRes, 'list-members');
  checkResponseTime(listMembersRes, 500, 'list-members');
  sleep(0.2);

  const listRolesRes = http.get(`${API_PREFIX}/tenancy/organizations/${orgPublicId}/roles`, {
    headers: withOrg,
    tags: { name: 'list-roles' },
  });
  checkOk(listRolesRes, 'list-roles');
  checkResponseTime(listRolesRes, 400, 'list-roles');
  sleep(0.2);

  const listApiKeysRes = http.get(`${API_PREFIX}/tenancy/organizations/${orgPublicId}/api-keys`, {
    headers: withOrg,
    tags: { name: 'list-api-keys' },
  });
  checkOk(listApiKeysRes, 'list-api-keys');
  checkResponseTime(listApiKeysRes, 400, 'list-api-keys');
  sleep(0.3);

  // ── Phase 3: Billing reads ───────────────────────────────────────────────

  const plansRes = http.get(`${API_PREFIX}/billing/plans`, {
    headers: authed,
    tags: { name: 'list-plans' },
  });
  checkOk(plansRes, 'list-plans');
  checkResponseTime(plansRes, 300, 'list-plans');
  sleep(0.2);

  const subsRes = http.get(`${API_PREFIX}/billing/organizations/${orgPublicId}/subscriptions`, {
    headers: withOrg,
    tags: { name: 'list-subscriptions' },
  });
  checkOk(subsRes, 'list-subscriptions');
  checkResponseTime(subsRes, 500, 'list-subscriptions');
  sleep(0.3);

  // ── Phase 4: Notifications ───────────────────────────────────────────────

  const notificationsRes = http.get(`${API_PREFIX}/notify/notifications`, {
    headers: authed,
    tags: { name: 'list-notifications' },
  });
  checkOk(notificationsRes, 'list-notifications');
  checkResponseTime(notificationsRes, 500, 'list-notifications');
  sleep(0.2);

  const unreadRes = http.get(`${API_PREFIX}/notify/notifications/unread-count`, {
    headers: authed,
    tags: { name: 'unread-count' },
  });
  checkOk(unreadRes, 'unread-count');
  checkResponseTime(unreadRes, 200, 'unread-count');
  sleep(0.2);

  // Write: mark all notifications read
  const markReadRes = http.post(`${API_PREFIX}/notify/notifications/mark-all-read`, null, {
    headers: authed,
    tags: { name: 'mark-all-read' },
  });
  checkOk(markReadRes, 'mark-all-read');
  checkResponseTime(markReadRes, 400, 'mark-all-read');
  sleep(0.3);

  // ── Phase 5: Webhooks (list → create → delete) ───────────────────────────

  const listWebhooksRes = http.get(`${API_PREFIX}/notify/organizations/${orgPublicId}/webhooks`, {
    headers: withOrg,
    tags: { name: 'list-webhooks' },
  });
  checkOk(listWebhooksRes, 'list-webhooks');
  checkResponseTime(listWebhooksRes, 500, 'list-webhooks');
  sleep(0.2);

  // Write: create a webhook unique per VU+iteration, then immediately delete it
  // so the DB does not accumulate test rows across a long soak run.
  const suffix = `${__VU}-${__ITER}-${randomString(4)}`;
  const createWebhookRes = http.post(
    `${API_PREFIX}/notify/organizations/${orgPublicId}/webhooks`,
    JSON.stringify({
      url: `https://httpbin.org/post?k6=${suffix}`,
      events: ['*'],
      description: `k6 journey ${suffix}`,
    }),
    { headers: { ...withOrg, ...json }, tags: { name: 'create-webhook' } },
  );
  check(createWebhookRes, { 'create-webhook 2xx': (r) => r.status >= 200 && r.status < 300 });
  checkResponseTime(createWebhookRes, 600, 'create-webhook');

  const createdWebhook = parseData(createWebhookRes);
  if (createdWebhook?.id) {
    sleep(0.1);
    const deleteWebhookRes = http.del(
      `${API_PREFIX}/notify/organizations/${orgPublicId}/webhooks/${createdWebhook.id}`,
      null,
      { headers: withOrg, tags: { name: 'delete-webhook' } },
    );
    checkOk(deleteWebhookRes, 'delete-webhook');
    checkResponseTime(deleteWebhookRes, 400, 'delete-webhook');
  }
  sleep(0.3);

  // ── Phase 6: Upload — presigned URL request (no actual S3 upload in k6) ──

  const uploadRes = http.post(
    `${API_PREFIX}/uploads`,
    JSON.stringify({
      file_name: `k6-${randomString(6)}.jpg`,
      content_type: 'image/jpeg',
      purpose: 'avatar',
    }),
    { headers: { ...authed, ...json }, tags: { name: 'request-upload' } },
  );
  check(uploadRes, { 'request-upload 2xx': (r) => r.status >= 200 && r.status < 300 });
  checkResponseTime(uploadRes, 600, 'request-upload');
  sleep(0.3);

  // ── Phase 7: Write — user settings ───────────────────────────────────────

  const patchSettingsRes = http.patch(
    `${API_PREFIX}/users/me/settings`,
    JSON.stringify({ marketing_emails_enabled: false }),
    { headers: { ...authed, ...json }, tags: { name: 'patch-me-settings' } },
  );
  checkOk(patchSettingsRes, 'patch-me-settings');
  checkResponseTime(patchSettingsRes, 500, 'patch-me-settings');
  sleep(0.2);

  // ── Phase 8: Write — org settings ────────────────────────────────────────

  const patchOrgSettingsRes = http.patch(
    `${API_PREFIX}/tenancy/organizations/${orgPublicId}/settings`,
    JSON.stringify({ is_email_notifications_enabled: true }),
    { headers: { ...withOrg, ...json }, tags: { name: 'patch-org-settings' } },
  );
  checkOk(patchOrgSettingsRes, 'patch-org-settings');
  checkResponseTime(patchOrgSettingsRes, 600, 'patch-org-settings');

  sleep(1);
}

export default userJourney;
