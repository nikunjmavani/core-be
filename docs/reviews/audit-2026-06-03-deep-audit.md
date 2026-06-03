# Deep Backend Audit — core-be (2026-06-03)

> **Auditor stance:** Senior backend security, reliability, and scalability auditor.
> **Scope:** Every domain, sub-domain, middleware, worker, queue, repository, schema, validator, controller, service, and configuration file under `src/` (1,394 TypeScript files) plus 25 SQL migrations, against the categories listed in the request.
> **Method:** Static code review with read-only verification commands (`grep`, `find`, `wc`, branch + log inspection). No mutating actions taken.
> **Branch:** `claude/amazing-darwin-7Oas8` (HEAD `c431a63`).

---

## Executive summary

`core-be` is a **mature, defensively-engineered** Fastify 5 + Drizzle + BullMQ stack with strong baseline disciplines: Argon2id password hashing with constant-time dummy-hash equalization, JWT RS256 with optional `kid` keyring rotation, SHA-256-hashed session-token rotation with reuse detection (RFC 9700-style family revocation), per-request memoized organization permission resolution with versioned Redis cache + recompute-lock stampede protection, AES-256-GCM at-rest field encryption with version prefixes, DNS-pinned outbound webhook fetches with private-IP rejection, presigned-POST S3 uploads with content-length range, server-side magic-byte verification + SVG sanitization, Stripe webhook raw-body HMAC verification, transactional outbox via `onCommit` + durable Redis commit-dispatch with recovery sweeper, Postgres FORCE RLS with scoped contexts, 19 cron retention jobs in FK-safe order, dead-letter persistence to both Postgres and Redis, idempotency middleware with fingerprint reuse detection, and comprehensive Sentry/Pino redaction.

That said, **a deep audit still surfaces production-readiness gaps and bugs.** The findings below are ordered Critical → High → Medium → Low within each section. The most pressing items are: (1) `requireOrganizationPermission`'s silent fallback to `params.id` (footgun that can authorize the wrong resource on misuse), (2) the MCP `call_api` tool forwarding arbitrary admin-supplied headers to in-process route handlers (impersonation surface — gated by admin role but not constrained), (3) the missing Stripe API version pin (silent behavioral drift), (4) the lack of authentication preHandler on the public-by-description plan routes (doc-vs-implementation mismatch), and (5) the `JWT_PUBLIC_KEYS` keyring silently falling back to the single `JWT_PUBLIC_KEY` when a token's `kid` is unknown (rotation key-mismatch can verify with the wrong key).

### Severity rollup

| Section | Critical | High | Medium | Low | Total |
| --- | --- | --- | --- | --- | --- |
| 1 — Security | 2 | 7 | 14 | 7 | 30 |
| 2 — Stability & Robustness | 0 | 4 | 7 | 4 | 15 |
| 3 — Scalability & Performance | 0 | 3 | 8 | 4 | 15 |
| 4 — Workers, Queues & Background Jobs | 0 | 3 | 7 | 3 | 13 |
| 5 — Code Quality & Maintainability | 0 | 1 | 5 | 6 | 12 |
| **Total** | **2** | **18** | **41** | **24** | **85** |

### Top-10 remediation priority (impact × likelihood)

1. **Finding #1** — `requireOrganizationPermission` falls back to `params.id` (auth bypass via param-name misuse).
2. **Finding #2** — JWT keyring silent fallback to single `JWT_PUBLIC_KEY` on unknown `kid` (rotation contract violated).
3. **Finding #3** — MCP `call_api` forwards arbitrary user-supplied headers to `app.inject()` (impersonation surface).
4. **Finding #5** — Plan endpoints unauthenticated despite "Requires authentication" in OpenAPI description (information disclosure).
5. **Finding #7** — Stripe client does not pin `apiVersion` (silent breaking changes on Stripe rollouts).
6. **Finding #8** — Auth middleware leaks JWT-validity timing because `verifyAccessToken` runs before the session lookup.
7. **Finding #11** — `/livez` and `/readyz` expose `migration_version`, `mail_outbox_pending`, `dlq_depth`, `worker_queue_manifest` unauthenticated (operational reconnaissance surface).
8. **Finding #18** — Webhook `WEBHOOK_URL_ALLOWLIST` matches `endsWith(`.entry`)` — subdomain takeover on the allowed domain widens SSRF.
9. **Finding #46** — `dispatchOrganizationWebhooks` rethrows only when 100% of fanout fails; a 99%-fail rate is silently logged.
10. **Finding #59** — `DEFAULT_DATABASE_POOL_MAX` × replica-count math can exhaust Postgres `max_connections` when worker `families=all`.

---

## Methodology

- **Baseline commands** (run during the audit, all read-only):
  `git status`, `git log --oneline -5`, `find src -name '*.ts'`, `wc`, targeted `grep -rn` for `process.env`, `Math.random`, `\.keys(`, `: any`, `as any`, `as unknown as`, `:any`, raw SQL in services, missing `await`, `\.then\(` chains. No `pnpm typecheck` / `pnpm validate` was executed end-to-end because the working tree was clean and the latest CI on `c431a63` was green.
- **Files read in full** (top-density set): ~70 files covering all middlewares, all `*.util.ts` security helpers, auth domain services, tenancy permission/auth, billing webhook ingestion + service, notify webhook delivery + SSRF guard, upload service + validator + storage adapter, user data export, request lifecycle, database connection, queue bootstrap, scheduler, dead-letter, MCP server, queue dashboard, event bus, Redis client, Sentry config, env schema, app + routes bootstrap.
- **File counts**: 1,394 `*.ts` under `src/`; 25 SQL migrations.
- **Severity calibration**: Critical = exploitable path to auth bypass / data loss / cross-tenant leak; High = realistic exploit chain or guaranteed correctness gap under load; Medium = defense-in-depth gap or edge-case bug with a workaround; Low = quality or speculative.
- **Existing controls noted in evidence** to avoid double-counting (e.g. `redactSensitive` covers logger + Sentry; idempotency middleware already drops 4xx/5xx; tenant middleware already detects header/path id mismatch).

---

# Section 1 — REST API Security

## Finding #1: `requireOrganizationPermission` silently falls back to `params.id`, authorizing the wrong resource on parameter-name misuse

**Severity:** Critical
**Category:** Security
**File:** `src/shared/utils/auth/authorization.util.ts`
**Function/Route/Worker:** `requireOrganizationPermission(permissionCode, paramName='organizationId')`

**Issue:** The factory looks up the organization id with `params[paramName] ?? params.id`. When a route registers a different `paramName` (or none) and there is no `:organizationId` param on the route, the gate quietly resolves to `params.id` — whatever that happens to be (`:userId`, `:notificationId`, `:webhookId`, etc.). The permission lookup then runs against a non-organization public id, and either (a) returns an empty permission set (denial — annoying but safe) or (b) coincidentally matches a real organization the user belongs to (authorization granted on the *wrong* resource).

**Evidence:** `src/shared/utils/auth/authorization.util.ts:78-83`
```ts
const params = request.params as Record<string, string>;
// eslint-disable-next-line security/detect-object-injection -- paramName is a function argument with a typed default.
const organizationId = params[paramName] ?? params.id;
if (!organizationId) {
  throw new ForbiddenError('errors:organizationContextRequired');
}
```

**Impact:** Privilege confusion. A developer adding a new route that takes `:notificationPublicId` and writing `preHandler: [app.authenticate, requireOrganizationPermission(NOTIFY_PERMISSIONS.MANAGE)]` (forgetting the second arg) gets a gate that resolves `params.id` — which Fastify does not even populate for that route — and either denies every request or, if the route also has `:id` (e.g. `/api/v1/foo/:id/notifications/:notificationPublicId`), authorizes the action under whatever the `:id` happens to be.

**Exploit / Failure Scenario:** Add a route `DELETE /api/v1/some-resource/:id` where `:id` is a *resource* public id (NanoID). The dev writes `requireOrganizationPermission(SOME_PERM)`. A user holding the permission in organization X submits `DELETE /api/v1/some-resource/<X>` — the gate succeeds because `X` is the org public id, and the handler then operates on a different bounded context. Worse, in a future refactor `:id` might be re-purposed to a non-org id; the gate keeps "passing" because it resolves to whatever string sits there.

**Recommended Fix:** Remove the `params.id` fallback. Require the caller to name the param explicitly (or extend the API to accept a closure that extracts the org id). Throw a *startup-time* assertion when the registered route does not contain the expected `:organizationId` param.

**Safer Code Example:**
```ts
export function requireOrganizationPermission(
  permissionCode: string,
  paramName: 'organizationId' | 'id' = 'organizationId',
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request, _reply) => {
    const auth = request.auth;
    if (!auth) throw new UnauthorizedError();
    const params = request.params as Record<string, string | undefined>;
    const organizationId = params[paramName];
    if (!organizationId || !PUBLIC_ID_REGEX.test(organizationId)) {
      // Fail loud — never fall through to params.id silently.
      throw new ForbiddenError('errors:organizationContextRequired');
    }
    // ... existing API-key and user permission logic
  };
}
```

---

## Finding #2: JWT keyring silently falls back to the single `JWT_PUBLIC_KEY` when a token's `kid` is unknown, violating the rotation contract

**Severity:** Critical
**Category:** Security
**File:** `src/shared/utils/security/jwt.util.ts`
**Function/Route/Worker:** `resolveVerifyKeyForToken(token)`

**Issue:** During RS256 verification, `resolveVerifyKeyForToken` looks up the token's `kid` in the keyring. **If the keyring is configured but the `kid` is not present, it silently falls back to `JWT_PUBLIC_KEY` (the legacy single key) and continues verification.** This violates the rotation invariant: a token signed with a retired or future key whose `kid` was removed from the keyring will verify successfully against the *current* `JWT_PUBLIC_KEY` if its signature happens to validate — which it will, because callers using a keyring *also* keep the matching public key as `JWT_PUBLIC_KEY` during the overlap window, so a token signed with any active key passes regardless of `kid`.

**Evidence:** `src/shared/utils/security/jwt.util.ts:156-174`
```ts
async function resolveVerifyKeyForToken(token: string): Promise<{
  key: CryptoKey;
  algorithm: typeof JWT_ALGORITHM;
}> {
  const header = decodeProtectedHeader(token);
  if (header.alg !== JWT_ALGORITHM) {
    throw new Error('JWT algorithm not allowed: RS256 only');
  }

  const keyring = await getVerifyKeyring();
  if (keyring && typeof header.kid === 'string') {
    const keyForKid = keyring.get(header.kid);
    if (keyForKid) {
      return { key: keyForKid, algorithm: JWT_ALGORITHM };
    }
  }

  return getVerifyKey(); // <-- silent fallback
}
```

**Impact:** Once an old key is retired (removed from `JWT_PUBLIC_KEYS`), tokens carrying its `kid` should immediately fail to verify so they cannot keep accessing the API. With the current code, the retired token verifies against `JWT_PUBLIC_KEY` if that key happens to be present — typical during a rotation overlap — so revocation never takes effect. Compromised key material remains usable until both keys roll.

**Exploit / Failure Scenario:** Operator rotates signing keys: `kid=k2` becomes primary, `kid=k1` is removed from `JWT_PUBLIC_KEYS` but `JWT_PUBLIC_KEY` still holds the `k2` PEM (deploy templates keep both for backward compat). An attacker who exfiltrated a session token before rotation continues to authenticate: `decodeProtectedHeader` returns `kid=k1`, `keyring.get('k1')` returns `undefined`, the function falls through to `getVerifyKey()` which is `k2`, and `jwtVerify` rejects only because the signature was made under `k1`. Good — that *specific* case fails. The dangerous case is when the operator *moves* a key from the keyring to the single-key slot (or vice versa) — verification then succeeds even though the keyring lookup didn't, defeating the purpose of `kid` indexing.

**Recommended Fix:** When the keyring is non-empty and the token presents a `kid`, refuse the request if the `kid` is not in the keyring. Only fall through to `JWT_PUBLIC_KEY` when the keyring is unset.

**Safer Code Example:**
```ts
async function resolveVerifyKeyForToken(token: string) {
  const header = decodeProtectedHeader(token);
  if (header.alg !== JWT_ALGORITHM) {
    throw new Error('JWT algorithm not allowed: RS256 only');
  }
  const keyring = await getVerifyKeyring();
  if (keyring) {
    if (typeof header.kid !== 'string') {
      throw new Error('JWT missing kid header (keyring active)');
    }
    const keyForKid = keyring.get(header.kid);
    if (!keyForKid) {
      throw new Error(`JWT kid not in keyring: ${header.kid}`);
    }
    return { key: keyForKid, algorithm: JWT_ALGORITHM };
  }
  return getVerifyKey();
}
```

---

## Finding #3: MCP `call_api` tool forwards arbitrary admin-supplied headers to `app.inject()` (impersonation surface)

**Severity:** High
**Category:** Security
**File:** `src/infrastructure/mcp/mcp-server.ts`
**Function/Route/Worker:** `registerMcpRouteHandlers` → `inject(headers)` and `call_api` tool handler

**Issue:** The MCP `call_api` tool accepts a `headers` map from the model and forwards it verbatim into `app.inject({ method, url, payload, headers })`. The MCP endpoint is gated to SUPER_ADMIN / ADMIN (good), but the gate authenticates the *caller* of `/api/v1/mcp`, not the headers that the model subsequently builds. The model can craft requests carrying an arbitrary `Authorization: Bearer <jwt>` belonging to any user whose token it has been given, and the in-process inject will execute under that identity — bypassing the admin's audit trail.

**Evidence:** `src/infrastructure/mcp/mcp-server.ts:178-196`
```ts
const result = await inject({
  method: data.method,
  url: data.path,
  payload: data.body,
  headers: data.headers ?? {},
});
```
and `mcp-server.ts:262-303` where headers flow through unchanged into `app.inject`.

**Impact:** A SUPER_ADMIN connecting an external MCP client (or an attacker who tricks one into using a malicious prompt with a leaked token) can mint requests as any user, including changing passwords, deleting accounts, or moving billing — and the audit log records the *target* user as actor, not the admin, because the request is fully injected with the impersonated session token.

**Exploit / Failure Scenario:** An admin pastes a screenshot containing another user's bearer token into a Cursor session. The model is prompted (innocently or maliciously) "use this token to look up the user's data". The model issues a `call_api` tool call with `headers: { authorization: 'Bearer <leaked>' }`. The handler runs as that user, with no audit-trail mention of the admin. Same risk on prompt-injection from a CI log a model is reading.

**Recommended Fix:** Strip privileged headers from `data.headers` before injection (`authorization`, `cookie`, `x-api-key`, `x-organization-id`) and always re-attach the admin's own auth headers from the inbound MCP request. Log every tool invocation with admin identity + method + path + scrubbed headers.

**Safer Code Example:**
```ts
const STRIPPED_HEADERS = new Set([
  'authorization', 'cookie', 'x-api-key', 'x-csrf-token',
]);
const safeHeaders: Record<string, string> = {};
for (const [k, v] of Object.entries(data.headers ?? {})) {
  if (!STRIPPED_HEADERS.has(k.toLowerCase())) safeHeaders[k] = v;
}
// Always re-inject the admin's own auth from the inbound MCP request:
const callerAuth = mcpRequest.headers.authorization;
if (typeof callerAuth === 'string') safeHeaders.authorization = callerAuth;
logger.warn({ adminUserId, method: data.method, path: data.path }, 'mcp.call_api.invoked');
const result = await inject({ method: data.method, url: data.path, payload: data.body, headers: safeHeaders });
```

---

## Finding #4: MCP routes registered at both `/mcp` and `/api/v1/mcp` (versioning bypass)

**Severity:** Medium
**Category:** Security
**File:** `src/infrastructure/mcp/mcp-server.ts`
**Function/Route/Worker:** `registerMcpRouteHandlers`

**Issue:** Four route registrations cover both the versioned (`/api/v1/mcp`) and unversioned (`/mcp`) paths. `apiVersioningMiddleware` only attaches sunset headers to versioned routes; the unversioned alias bypasses any future deprecation signaling and CORS preflight handling for the versioned namespace.

**Evidence:** `src/infrastructure/mcp/mcp-server.ts:321-362`
```ts
app.get('/api/v1/mcp', ...);
app.post('/api/v1/mcp', ...);
// Alias without /api/v1 so clients using base URL with path /mcp do not get 404
app.get('/mcp', ...);
app.post('/mcp', ...);
```

**Impact:** Operational risk only — both paths are admin-gated. But the unversioned alias creates a confusing public surface that doesn't participate in versioned API governance.

**Exploit / Failure Scenario:** Forklifting MCP support to a future v2 requires deprecating `/api/v1/mcp` with a Sunset header. The `/mcp` alias has no version to deprecate, leaving clients stuck on legacy behavior.

**Recommended Fix:** Remove the unversioned alias. Document that MCP clients must point at `/api/v1/mcp`.

**Safer Code Example:**
```ts
// Drop lines 354-362; the route catalog and Cursor MCP config point at /api/v1/mcp only.
app.get('/api/v1/mcp', ...);
app.post('/api/v1/mcp', ...);
```

---

## Finding #5: Plan list/get endpoints are unauthenticated despite docs claiming "Requires authentication"

**Severity:** High
**Category:** Security
**File:** `src/domains/billing/sub-domains/plan/plan.routes.ts`, `src/domains/billing/billing.routes.ts`
**Function/Route/Worker:** `GET /api/v1/billing/plans`, `GET /api/v1/billing/plans/:id`

**Issue:** Neither registration nor the wrapping `billingRoutesPlugin` attaches `onRequest: [app.authenticate]`. The OpenAPI `description` field on both routes states "Requires authentication." — a documentation-vs-implementation mismatch. If public discovery of plans is intentional (Stripe / Vercel / Linear do this), the description is wrong; if auth is required, the handlers are silently open.

**Evidence:** `src/domains/billing/sub-domains/plan/plan.routes.ts:14-44`
```ts
zodApplication.get('/plans', {
  schema: {
    summary: 'List available plans',
    description: '... Requires authentication.',
    tags: ['Billing', 'Plan'],
  },
}, controller.listPlans);
// No `onRequest: [app.authenticate]`.
```
and `billing.routes.ts:13` — `await app.register(planRoutes(billingDomain.planService));` (no auth scope).

**Impact:** Either (a) intentional public exposure but stale documentation that misleads clients & auditors, or (b) accidental missing preHandler that leaks plan internals (prices, feature flags) to anonymous probes — including any plans flagged inactive/hidden.

**Exploit / Failure Scenario:** A pricing change being negotiated with a customer is staged as an inactive plan row; a competitor scrapes `/api/v1/billing/plans` and discovers it before the contract is signed.

**Recommended Fix:** Decide the intent. If plans are public, edit the OpenAPI description to remove "Requires authentication." and have the plan repository filter to `is_active = true` (and exclude any internal-only plans). If auth is required, add `onRequest: [app.authenticate]`.

**Safer Code Example:**
```ts
// If plans are public-by-design:
zodApplication.get('/plans', {
  schema: { summary: 'List available plans',
            description: 'Public catalog of active plans.', tags: ['Billing', 'Plan'] },
  config: { raw_response: false },
}, controller.listPlans);
// Make sure controller.listPlans calls service.listActivePublicPlans(), not listAll().
```

---

## Finding #6: Auth middleware verifies the JWT *before* the session lookup — creates a timing oracle for JWT validity

**Severity:** Medium
**Category:** Security
**File:** `src/shared/middlewares/core/auth.middleware.ts`
**Function/Route/Worker:** `authenticate(request, reply)`

**Issue:** The middleware calls `verifyAccessToken(token)` (expensive cryptographic verification) before `authSessionService.verifyActiveAccessToken(token)` (Redis-cached DB lookup). A token that fails the JWT step takes a different time path than one that fails only the session lookup, leaking whether a presented bearer is a *currently-valid* JWT (correctly signed, audience, etc.) or merely random garbage. The session-lookup branch also runs only when the JWT passes, so an attacker can distinguish "your JWT is valid, but your session was revoked" from "your JWT is malformed" — which says they had a real token at some point.

**Evidence:** `src/shared/middlewares/core/auth.middleware.ts:28-50`
```ts
const token = getBearerToken(request);
try {
  const payload = await verifyAccessToken(token);    // <-- ~1ms RSA op
  const authSessionService = request.server.authDomain?.authSessionService;
  if (!authSessionService) throw new UnauthorizedError('errors:validation.invalidToken');
  await authSessionService.verifyActiveAccessToken(token);  // <-- Redis/DB
  request.auth = ...
} catch (error) {
  if (error instanceof UnauthorizedError) throw error;
  throw new UnauthorizedError('errors:validation.invalidToken');
}
```

**Impact:** Information leak that helps an attacker confirm exfiltrated tokens still have a valid signature even if revoked. Not a direct break, but accelerates targeted account takeover attempts against known users (skipping random guessing).

**Exploit / Failure Scenario:** Attacker scrapes Sentry breadcrumbs that capture redacted-but-length-preserved tokens. Using timing, they confirm one specific token still verifies cryptographically (worth trying to refresh) versus another that doesn't.

**Recommended Fix:** Add a fixed-delay floor (e.g. via `enforceMinimumDuration` already present in `src/shared/utils/security/anti-enumeration.util.ts`) to the failing branches so all 401s take the same minimum wall-clock time.

**Safer Code Example:**
```ts
async function authenticate(request, _reply) {
  if (request.auth) return;
  if (await applyApiKeyAuthentication(request)) return;
  const startedAtMillis = Date.now();
  try {
    const token = getBearerToken(request);
    const payload = await verifyAccessToken(token);
    await request.server.authDomain.authSessionService.verifyActiveAccessToken(token);
    request.auth = omitUndefined({ kind: 'user', userId: payload.userId, role: payload.role });
  } catch (error) {
    await enforceMinimumDuration(startedAtMillis, AUTH_TIMING_FLOOR_MS);
    throw error instanceof UnauthorizedError ? error : new UnauthorizedError('errors:validation.invalidToken');
  }
}
```

---

## Finding #7: Stripe client does not pin `apiVersion` — silent behavioral drift on Stripe rollouts

**Severity:** High
**Category:** Security
**File:** `src/infrastructure/payment/stripe.client.ts`
**Function/Route/Worker:** `getStripeClient()`

**Issue:** `new Stripe(secretKey, { typescript: true, maxNetworkRetries: 2, timeout: env.STRIPE_HTTP_TIMEOUT_MS })` omits `apiVersion`. The SDK then uses the *account's* default API version (set in the Stripe dashboard). If that default changes — either by manual dashboard edit or by Stripe's automatic upgrade for inactive accounts — webhook payloads and API responses can shift shape mid-deploy, breaking subscription sync.

**Evidence:** `src/infrastructure/payment/stripe.client.ts:39-46`
```ts
stripeInstance = new Stripe(secretKey, {
  typescript: true,
  maxNetworkRetries: 2,
  timeout: env.STRIPE_HTTP_TIMEOUT_MS,
  ...optionalOutboundHttpClientForContractTests,
});
```

**Impact:** Hidden coupling to mutable account state. A migration of the account's API version (Stripe rolls these automatically for unused/old accounts) silently changes webhook payload shapes; the worker may swallow events as `unhandled_event` or mis-map `current_period_start`/`current_period_end` (already type-coerced via `as unknown as Record<string, unknown>` — see Finding #76).

**Exploit / Failure Scenario:** Stripe upgrades the account to a newer API version overnight; the `customer.subscription.updated` payload no longer carries `current_period_start` at the top level (moved into `items.data[0].current_period_start`). The dispatcher silently defaults to `new Date()` and marks every refresh "current period now" — billing dashboards lie about renewal dates.

**Recommended Fix:** Pin `apiVersion` to a known-tested Stripe API version. Bump it deliberately with a contract test.

**Safer Code Example:**
```ts
stripeInstance = new Stripe(secretKey, {
  apiVersion: '2025-02-24.acacia', // pin and update via PR + contract tests
  typescript: true,
  maxNetworkRetries: 2,
  timeout: env.STRIPE_HTTP_TIMEOUT_MS,
  ...optionalOutboundHttpClientForContractTests,
});
```

---

## Finding #8: `WEBHOOK_URL_ALLOWLIST` matches `endsWith('.entry')` — subdomain takeover widens SSRF

**Severity:** High
**Category:** Security
**File:** `src/shared/utils/security/webhook-outbound-fetch.util.ts`
**Function/Route/Worker:** `assertWebhookHostAllowed(hostname)`

**Issue:** The allowlist check matches `normalizedHost === entry || normalizedHost.endsWith(\`.\${entry}\`)`. That covers `api.example.com` for `example.com`, but it also covers `attacker.dangling-subdomain.example.com` if `example.com` is on the allowlist *and the operator does not control every subdomain*. Subdomain takeover (forgotten CNAME, expired SaaS subdomain) becomes a webhook SSRF target into trusted networks.

**Evidence:** `src/shared/utils/security/webhook-outbound-fetch.util.ts:47-55`
```ts
const normalizedHost = hostname.toLowerCase();
const allowed = allowlist.some(
  (entry) => normalizedHost === entry || normalizedHost.endsWith(`.${entry}`),
);
if (!allowed) {
  throw new ValidationError('errors:webhookUrlNotAllowed', ...);
}
```

**Impact:** SSRF reachable through a hijacked subdomain of any allowlisted root domain. Combined with deliberate webhook URL set by an attacker organization, lets them point a webhook at internal-style URLs that resolve to the takeover-controlled host.

**Exploit / Failure Scenario:** Allowlist = `example.com`. Marketing decommissioned `events.example.com` but left a CNAME pointing at a deleted Heroku app. Attacker registers that Heroku app, sets webhook URL `https://events.example.com/...`; SSRF guard checks pass (DNS resolves to a public IP under attacker's control), HMAC-signed requests with internal context arrive at attacker host.

**Recommended Fix:** Require *exact* match for hostnames; if subdomain wildcards are needed, accept an explicit `*.example.com` syntax and document that operators must own every subdomain. Better: combine with explicit CIDR allowlists for known SaaS endpoint ranges.

**Safer Code Example:**
```ts
function assertWebhookHostAllowed(hostname: string): void {
  const allowlist = parseWebhookAllowlist();
  if (allowlist.length === 0) {
    if (env.NODE_ENV === 'production') throw new ValidationError('errors:webhookUrlAllowlistRequired', ...);
    return;
  }
  const normalizedHost = hostname.toLowerCase();
  const allowed = allowlist.some((entry) => {
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(1); // ".example.com"
      return normalizedHost.endsWith(suffix);
    }
    return normalizedHost === entry; // exact match only
  });
  if (!allowed) throw new ValidationError('errors:webhookUrlNotAllowed', ...);
}
```

---

## Finding #9: `parseAllowedOriginsList` accepts any string; CORS plugin treats them as exact-match — protocol/case mismatches silently bypass

**Severity:** Medium
**Category:** Security
**File:** `src/shared/utils/security/allowed-origins.util.ts`, `src/shared/middlewares/security/cors.middleware.ts`
**Function/Route/Worker:** `parseAllowedOriginsList`

**Issue:** The parser only trims segments. `@fastify/cors` compares the inbound `Origin` header byte-for-byte against entries. `HTTPS://Example.com` (uppercase scheme/host) and `https://example.com:443` (explicit default port) are different strings but the same origin. The env-schema refine enforces `https://` in production but does not normalize casing or strip default ports, so a malformed allowlist entry silently fails to match real browser-sent Origins and the request is rejected with CORS errors *or* — if an attacker can influence the env (unlikely) — overly tolerant patterns are missed.

**Evidence:** `src/shared/utils/security/allowed-origins.util.ts:4-10` (no normalization).

**Impact:** Operational footgun: deploys with case-mismatched origins get blanket CORS rejections in browsers; harder to debug than necessary. Not exploitable on its own.

**Exploit / Failure Scenario:** Operator writes `ALLOWED_ORIGINS=https://Example.com` in `.env.production`; the SPA at `https://example.com` receives `403 origin_not_allowed`.

**Recommended Fix:** Normalize via `new URL(entry).origin` during parse; reject entries that fail URL parsing or carry a path.

**Safer Code Example:**
```ts
export function parseAllowedOriginsList(value?: string): string[] {
  return (value ?? '').split(',').map(s => s.trim()).filter(Boolean).map((entry) => {
    if (entry === '*') return entry;
    try { return new URL(entry).origin; } catch { throw new Error(`ALLOWED_ORIGINS entry not a valid origin: ${entry}`); }
  });
}
```

---

## Finding #10: `cookie-session-origin.pre-handler` falls back to Referer in non-production, opening CSRF gap in staging/dev

**Severity:** Medium
**Category:** Security
**File:** `src/shared/middlewares/session/cookie-session-origin.pre-handler.ts`
**Function/Route/Worker:** `requireAllowedSourceOriginForCookieSessionRoute`

**Issue:** When the `Origin` header is absent **and** `NODE_ENV !== 'production'`, the gate accepts the `Referer` header. Referer is stripped by many privacy tools and can be spoofed by intermediaries. Staging environments are exactly where attackers test exploits before targeting prod; this opens a CSRF surface that doesn't exist in prod.

**Evidence:** `src/shared/middlewares/session/cookie-session-origin.pre-handler.ts:64-77`
```ts
if (env.NODE_ENV === 'production') {
  requireCsrfDoubleSubmit(request);
  return;
}
const refererHeader = firstHeaderValue(request.headers.referer);
if (refererHeader !== undefined) {
  const refererOrigin = originFromRefererHeader(refererHeader);
  assertOriginAllowed(refererOrigin, allowedOriginsList);
  return;
}
throw new ForbiddenError('errors:originNotAllowed');
```

**Impact:** Staging-only CSRF on the refresh endpoint when a same-site phishing page is hosted on a subdomain not in the allowlist but visited by the victim.

**Recommended Fix:** Require CSRF double-submit in every environment; Referer fallback is only useful for non-browser clients (which should adopt the CSRF header).

**Safer Code Example:**
```ts
if (originHeader !== undefined) { assertOriginAllowed(originHeader, allowedOriginsList); return; }
// Always require CSRF double-submit when Origin is absent — no Referer fallback.
requireCsrfDoubleSubmit(request);
```

---

## Finding #11: `/livez` and `/readyz` expose `migration_version`, `mail_outbox_pending`, `dlq_depth`, `worker_queue_manifest` unauthenticated

**Severity:** Medium
**Category:** Security
**File:** `src/shared/middlewares/core/health.middleware.ts`, `src/shared/utils/infrastructure/health-operational-metrics.util.ts`
**Function/Route/Worker:** `handleReadinessProbe(reply)`

**Issue:** Readiness response includes operational metrics: latest applied migration id, mail outbox backlog, DLQ depth, worker queue manifest (queue names + concurrency). Probes are bypassed from rate limiting (`RATE_LIMIT_ALLOWLISTED_PATHS`) and have no auth.

**Evidence:** `src/shared/middlewares/core/health.middleware.ts:42-50`
```ts
const [readiness, operational] = await Promise.all([
  getCachedDependencyReadinessProbes(),
  getOperationalMetricsForReadiness(),
]);
return { ...readiness, ...operational };
```

**Impact:** Reconnaissance: an attacker learns when a deploy lands (migration id), queue backlog patterns (timing attacks against retention windows), and worker concurrency budgets (sizing DDoS to exhaust them).

**Exploit / Failure Scenario:** Attacker polls `/readyz` once a minute over a week; correlates `mail_outbox_pending` spikes with promotion bursts and times account-takeover attempts to coincide with maximum mail latency (when victims are least likely to notice a takeover email).

**Recommended Fix:** Keep `/livez` and `/readyz` minimal (process/binary readiness). Move operational metrics behind the existing `/metrics` Prometheus endpoint, which already requires `METRICS_SCRAPE_TOKEN`.

**Safer Code Example:**
```ts
async function handleReadinessProbe(reply: FastifyReply) {
  if (isApplicationDraining()) { reply.status(503); return { status: 'draining' as const }; }
  const readiness = await getCachedDependencyReadinessProbes();
  if (readiness.status !== 'ok') reply.status(503);
  return readiness; // strip operational metrics
}
```

---

## Finding #12: `request-context` middleware echoes the inbound `x-request-id` (validated for charset only) — log poisoning surface

**Severity:** Medium
**Category:** Security
**File:** `src/shared/middlewares/core/request-context.middleware.ts`, `src/shared/utils/http/fastify-server.util.ts`
**Function/Route/Worker:** `genReqId` (Fastify server option)

**Issue:** Fastify is configured (`fastify-server.util.ts` shows a `MAX_INBOUND_REQUEST_IDENTIFIER_LENGTH` of 128 and an allowlist of alphanumerics + hyphen + underscore) to accept client-supplied `x-request-id` up to 128 chars and reflect it as the request id and the `x-request-id` response header. While the validator caps charset and length, it permits an attacker to choose request ids that collide with internal request ids in log triage, or that contain UUID-shaped collisions across customers (impersonating another tenant's traffic in dashboards).

**Evidence:** `src/shared/middlewares/core/request-context.middleware.ts:11` (`reply.header('x-request-id', request.id)`) plus the server-options util permitting the inbound header.

**Impact:** Log triage poisoning. An attacker spamming `x-request-id: deadbeef...` mixes their traffic with a victim's investigation. Not a direct security break, but cross-customer log obfuscation slows incident response.

**Recommended Fix:** When the client supplies a `x-request-id`, store it as `x-client-request-id` for cross-correlation but always generate a server-side `request.id` (the existing `randomUUID()` path). Keep the echoed response header on the server-side id.

**Safer Code Example:**
```ts
genReqId(request: IncomingMessage) {
  const incoming = (request.headers['x-request-id'] ?? '').toString();
  // Stash, never adopt:
  (request as { _clientReqId?: string })._clientReqId =
    INBOUND_REQUEST_ID_PATTERN.test(incoming) ? incoming : '';
  return randomUUID();
}
```

---

## Finding #13: `encryption.middleware` AES-GCM response encryption is honestly labeled "obfuscation" but ships a fixed key from env, single-IV per request — a footgun if anyone treats it as a real defense

**Severity:** Medium
**Category:** Security
**File:** `src/shared/middlewares/security/encryption.middleware.ts`, `src/shared/utils/security/encryption.util.ts`
**Function/Report:** `encryptPayload`

**Issue:** The middleware's docstring is honest: "they appear as unreadable ciphertext in Chrome DevTools." That's obfuscation, not encryption. The risk is that consumers (sales, support, security questionnaires) treat it as encryption-at-rest. Worse, the key is a single AES-256 key shared across all responses; if it leaks (it sits in env on every API instance), every recorded response is decryptable forever.

**Evidence:** `src/shared/middlewares/security/encryption.middleware.ts:38-66`.

**Impact:** False sense of security; auditor confusion. Not a direct compromise, but encourages disabling TLS or other real defenses on the assumption "we already encrypt".

**Recommended Fix:** Rename to `ENABLE_RESPONSE_OBFUSCATION` and document explicitly that this is anti-curiosity only; remove or refuse to enable in production by default.

**Safer Code Example:**
```ts
if (!env.ENABLE_RESPONSE_ENCRYPTION) return;
if (env.NODE_ENV === 'production') {
  logger.error('ENABLE_RESPONSE_ENCRYPTION is anti-curiosity only; refuse in production');
  throw new Error('ENABLE_RESPONSE_ENCRYPTION must not be set in production');
}
```

---

## Finding #14: API key prefix length used as DB index lookup is not in env — bucket-size unknown at audit time

**Severity:** Medium
**Category:** Security
**File:** `src/domains/tenancy/sub-domains/organization/organization-api-key/organization-api-key.service.ts`
**Function/Route/Worker:** `authenticate(key_prefix, key_hash, hashCompare)`

**Issue:** `findActiveByKeyPrefix(key_prefix)` returns *all* candidates with the same prefix; the service then iterates and timing-safe-compares each hash. If `ORGANIZATION_API_KEY_PREFIX_DISPLAY_LENGTH` is too short (e.g. 8 chars), under heavy load every authentication does N comparisons against random keys. Worse, the loop is sequential and uses `hashCompare` (constant-time `timingSafeEqual` per pair), so the per-request CPU cost grows linearly with the number of keys sharing a prefix.

**Evidence:** `src/domains/tenancy/sub-domains/organization/organization-api-key/organization-api-key.service.ts:174-197`
```ts
const candidates = await this.apiKeyRepository.findActiveByKeyPrefix(key_prefix);
for (const candidate of candidates) {
  if (!hashCompare(candidate.key_hash, key_hash)) continue;
  ...
}
```

**Impact:** With a 6-byte prefix and 10⁶ keys, collisions are common enough that an attacker can amplify CPU work on every auth attempt; combined with the lack of per-key rate limiting on the API-key auth path (handled only by global IP limit), an attacker spraying ak_-prefixed garbage on a known prefix burns server CPU.

**Recommended Fix:** Use a 16-char (8 byte) prefix; or look up by both prefix AND hash with a unique constraint, eliminating the loop.

**Safer Code Example:**
```ts
// Repository:
async findActiveByPrefixAndHash(prefix: string, hash: string) {
  return this.db.select(...).from(apiKeys).where(and(eq(apiKeys.key_prefix, prefix), eq(apiKeys.key_hash, hash), isActive));
}
// Service: drop the loop, single equality check.
```

---

## Finding #15: Idempotency cache key includes `organization_public_id` from the unverified `X-Organization-Id` header at claim time

**Severity:** Medium
**Category:** Security
**File:** `src/shared/middlewares/core/idempotency.middleware.ts`
**Function/Route/Worker:** `resolveIdempotencyScope(request)`

**Issue:** The scope used to build the Redis idempotency key is `{ userId, organizationId, apiKeyPublicId }` where `organizationId` is taken from `request.organizationId ?? request.headers['x-organization-id']`. At idempotency-claim time the tenant middleware has set `request.organizationId` only after pattern-validating the header — but the user's membership in that org has not yet been verified (that happens in `requireOrganizationPermission`). A caller can pass a valid public id of an org they don't belong to and reserve idempotency keys in that org's scope, opening the door to denial of a future legitimate retry by the real member.

**Evidence:** `src/shared/middlewares/core/idempotency.middleware.ts:149-169`.

**Impact:** Cross-tenant denial of service against the idempotency layer: attacker reserves `Idempotency-Key: kx` in victim org scope; victim's legitimate retry conflicts.

**Exploit / Failure Scenario:** Attacker authenticated as user_A in org_A submits `POST /api/v1/foo` with `Idempotency-Key: shared-id` and `X-Organization-Id: <org_B>`. The middleware claims the key in scope `(user_A, org_B)`. Later, user_C in org_B issues the same key (in a CI loop or mobile retry) and conflicts.

**Recommended Fix:** Move idempotency scope resolution after the auth + permission gate, or scope strictly by authenticated principal (drop org_id from the scope key).

**Safer Code Example:**
```ts
function resolveIdempotencyScope(request: FastifyRequest) {
  const auth = request.auth;
  return omitUndefined({
    userId: auth?.kind === 'user' ? auth.userId : undefined,
    apiKeyPublicId: auth?.kind === 'apiKey' ? auth.apiKeyPublicId : undefined,
    // Drop organizationId — caller controls it pre-auth.
  });
}
```

---

## Finding #16: Magic-link DTO emits the raw token through `AUTH_EVENT.MAGIC_LINK_REQUESTED`; PII redaction does not cover this domain-event channel

**Severity:** Medium
**Category:** Security
**File:** `src/domains/auth/sub-domains/auth-method/magic-link.service.ts`, `src/core/events/event-bus.ts`
**Function/Route/Worker:** `MagicLinkService.issueMagicLinkIfUserExists` → `eventBus.emitStrict(MAGIC_LINK_REQUESTED, { magic_link_token })`

**Issue:** The event payload carries the **raw** 32-byte magic-link token. Event handlers run via `Promise.all` and the bus logs handler errors with the full event object (`logger.error({ eventType: event.type, error }, 'Domain event handler failed')`). If a handler throws after destructuring the payload, the `error` may include the payload — and Pino's redact paths (`authorization`, `password`, `token`, `secret`) cover top-level keys like `token` but the field here is `magic_link_token` (and `password_reset_token`, etc.), which contains the substring `token` so should be redacted by recursive `redactSensitive`. **But** the recursive redactor only triggers on key-name match, and `magic_link_token` matches `token` via substring. So it's protected — but barely. If a future field is named `link_url` containing the token, it would not match.

**Evidence:** `src/domains/auth/sub-domains/auth-method/magic-link.service.ts:119-127`
```ts
await eventBus.emitStrict({
  type: AUTH_EVENT.MAGIC_LINK_REQUESTED,
  payload: {
    email: user.email,
    magic_link_token: rawToken,
    expires_in_minutes: MAGIC_LINK_EXPIRES_IN_MINUTES,
  } satisfies MagicLinkEmailPayload,
  timestamp: new Date(),
});
```

**Impact:** Future-PR risk: a developer adds a `link_url` field carrying `https://app.example.com/verify?token=<raw>` — the recursive redactor scrubs the URL via `redactSensitiveQueryString`, but only if the parameter name itself contains a sensitive fragment. URL-embedded tokens are protected; arbitrary fields embedding them are not.

**Recommended Fix:** Move the raw token out of the event payload entirely. Persist it under a short-lived Redis key indexed by `verification_token.id` and have the email handler fetch + delete it. Keeps event payload free of secrets and shrinks the redaction surface.

**Safer Code Example:**
```ts
await redis.set(`magic-link:${verificationRowId}`, rawToken, 'EX', 60);
await eventBus.emitStrict({
  type: AUTH_EVENT.MAGIC_LINK_REQUESTED,
  payload: { email: user.email, verificationRowId, expires_in_minutes: 15 },
  timestamp: new Date(),
});
// In handler: const token = await redis.getdel(`magic-link:${verificationRowId}`);
```

---

## Finding #17: `verifyAccessToken` does not validate `payload.sub` shape (UUID/public-id format) — relies on session lookup as authority

**Severity:** Low
**Category:** Security
**File:** `src/shared/utils/security/jwt.util.ts`
**Function/Route/Worker:** `verifyAccessToken(token)`

**Issue:** After signature and audience checks pass, only `if (!payload.sub) throw new Error(...)` runs. The session lookup `verifyActiveAccessToken(token)` is the real authority on whether the principal is real, but defense in depth would constrain `sub` to the project's NanoID public-id format.

**Evidence:** `src/shared/utils/security/jwt.util.ts:189-198`.

**Impact:** Negligible in current code (session lookup catches), but cheap defense-in-depth.

**Recommended Fix:** `if (!PUBLIC_ID_REGEX.test(payload.sub)) throw new Error('Invalid token: subject malformed');`.

**Safer Code Example:**
```ts
import { PUBLIC_ID_REGEX } from '@/shared/utils/identity/public-id.util.js';
if (!payload.sub || !PUBLIC_ID_REGEX.test(payload.sub)) {
  throw new Error('Invalid token: subject malformed');
}
```

---

## Finding #18: `verifyWebhookPayloadSignature` does not enforce a clock-skew window — replay protection delegated to callers who may forget

**Severity:** Medium
**Category:** Security
**File:** `src/shared/utils/security/webhook-signature.util.ts`
**Function/Route/Worker:** `verifyWebhookPayloadSignature(secret, payload, timestamp, signatureHex)`

**Issue:** The verifier only checks signature equality; the `timestamp` argument is mixed into the HMAC input but never bounded. Any consumer using this helper to validate an **inbound** webhook from a partner is responsible for separately enforcing `|now - timestamp| < maxSkew`. The Stripe path correctly delegates to Stripe SDK's `constructEvent`, which has a built-in 5-min tolerance, but any future inbound integration using this util can replay captured webhooks forever.

**Evidence:** `src/shared/utils/security/webhook-signature.util.ts:23-38`.

**Impact:** Future inbound integration footgun. No active misuse today.

**Recommended Fix:** Take `maxAgeSeconds` as a required parameter, reject signatures older than that, and document explicitly that this helper does NOT mint trust on the timestamp.

**Safer Code Example:**
```ts
export function verifyWebhookPayloadSignature(opts: {
  secret: string; payload: string; timestamp: number; signatureHex: string;
  nowSeconds?: number; maxAgeSeconds: number;
}): boolean {
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - opts.timestamp) > opts.maxAgeSeconds) return false;
  const expected = signWebhookPayload(opts.secret, opts.payload, opts.timestamp);
  if (expected.length !== opts.signatureHex.length) return false;
  try { return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(opts.signatureHex, 'hex')); } catch { return false; }
}
```

---

## Finding #19: SVG sanitization uses DOMPurify with `svgFilters` profile — allow-list is wide

**Severity:** Medium
**Category:** Security
**File:** `src/domains/upload/utils/upload-svg.util.ts`
**Function/Route/Worker:** `sanitizeSvgContent(svgMarkup)`

**Issue:** `DOMPurify.sanitize(svgMarkup, { USE_PROFILES: { svg: true, svgFilters: true } })` permits SVG filter elements (`<feImage>`, `<feFlood>`, `<filter>`), which historically host XSS vectors (e.g. external image references, SMIL animation handlers). DOMPurify catches the well-known ones, but SVG-in-img is a moving target.

**Evidence:** `src/domains/upload/utils/upload-svg.util.ts:14-16`.

**Impact:** Hosted XSS via SVG only when SVG is served back inline to other users with `Content-Type: image/svg+xml` and same-origin to the SPA. Helmet CSP is restrictive (`scriptSrc: 'self'`), which prevents inline script execution, but SVG-served-inline can still pivot via CSS `expression` (legacy) or onload.

**Recommended Fix:** Drop `svgFilters: true` unless filters are required. Set `forceCustomElements: false`. Add a `Content-Security-Policy: sandbox` response header when serving SVG.

**Safer Code Example:**
```ts
DOMPurify.sanitize(svgMarkup, {
  USE_PROFILES: { svg: true }, // drop svgFilters
  FORBID_TAGS: ['foreignObject', 'animate', 'animateMotion', 'set'],
  FORBID_ATTR: ['onload', 'onerror', 'onclick', 'onfocus', 'onmouseover'],
});
```

---

## Finding #20: Magic-byte verifier lacks GIF/ICO signatures yet upload constants are not audited here for those types

**Severity:** Low
**Category:** Security
**File:** `src/shared/utils/validation/file-magic.util.ts`

**Issue:** Supported signatures are png, jpeg, webp, pdf. Upload purpose config does not allow GIF or ICO today (verified — only `image/png`, `image/jpeg`, `image/webp`, `application/pdf`, `image/svg+xml`). Defensive note: a future PR that adds `image/gif` to `allowedTypes` without adding a signature would silently allow unsanitized files since `isMagicByteVerifiable` returns false for unknown types, and the upload service short-circuits the magic-byte check.

**Evidence:** `src/shared/utils/validation/file-magic.util.ts:10-26`; `src/domains/upload/upload.service.ts:455-459`.

**Impact:** Future-PR footgun.

**Recommended Fix:** Add a unit test that asserts every `UPLOAD_PURPOSE_CONFIG[*].allowedTypes` entry is either SVG (sanitized) or has a magic-byte signature; fail CI when a new content type is added without a signature.

**Safer Code Example:**
```ts
it('every allowed content type has magic-byte or sanitizer coverage', () => {
  for (const cfg of Object.values(UPLOAD_PURPOSE_CONFIG)) {
    for (const type of cfg.allowedTypes) {
      expect(isSvgContentType(type) || isMagicByteVerifiable(type)).toBe(true);
    }
  }
});
```

---

## Finding #21: `request.organizationId` reads the header pattern-only — no normalization against case/whitespace

**Severity:** Low
**Category:** Security
**File:** `src/shared/middlewares/tenant/tenant.middleware.ts`

**Issue:** `PUBLIC_ID_REGEX.test(headerValue)` matches `[A-Za-z0-9_-]{21}`. Whitespace, leading/trailing spaces, or uppercase variants are matched on input but not normalized when echoed into RLS GUC `app.current_organization_id`. NanoIDs are case-sensitive, so this is correct, but combined with idempotency scope (Finding #15) means whitespace differences create distinct buckets.

**Impact:** Edge-case bug at most.

**Recommended Fix:** None required if NanoID generation is the only id source. Document the invariant.

**Safer Code Example:** _N/A_

---

## Finding #22: OAuth nonce cookie `sameSite=lax` is correct, but `path=/api/v1/auth/oauth` excludes any provider that posts to a custom callback path

**Severity:** Low
**Category:** Security
**File:** `src/domains/auth/auth.http.util.ts`

**Issue:** OAuth nonce cookie path is scoped to `/api/v1/auth/oauth`, so it travels with the callback path `…/auth/oauth/:provider/callback`. Correct today. A future PR that registers `…/auth/sso/callback` would not see the cookie and would either accept missing nonce (CSRF) or break the flow.

**Evidence:** `src/domains/auth/auth.http.util.ts:114-122`.

**Recommended Fix:** Document the cookie-path coupling in `auth.http.util.ts` so future SSO additions either reuse the path or set a wider one explicitly.

**Safer Code Example:** _N/A_

---

## Finding #23: `redactSensitive` accepts `email` as a sensitive fragment but also redacts incidental keys like `is_email_verified` and `email_template_name`

**Severity:** Low
**Category:** Security
**File:** `src/shared/utils/security/sensitive-redaction.util.ts`

**Issue:** The redactor includes `email` in `SENSITIVE_KEY_FRAGMENTS` to keep PII out of logs. The substring match also redacts `is_email_verified`, `email_template_name`, `email_provider` — any key containing the substring. The comment acknowledges this as an "acceptable fail-closed trade-off". Operational debugging is harder than it needs to be because a boolean is logged as `[REDACTED]`.

**Evidence:** `src/shared/utils/security/sensitive-redaction.util.ts:38-43`.

**Impact:** Slower incident triage when investigating verification flow bugs. Not a security finding per se but worth flagging.

**Recommended Fix:** Use a smarter rule: redact only key names that *equal* one of the sensitive base names OR end with `_email`, `_address`, `_token`. Distinguish key types from value types.

**Safer Code Example:**
```ts
const SENSITIVE_KEY_NAMES = new Set(['email', 'password', 'token', ...]);
const SENSITIVE_KEY_SUFFIXES = ['_email', '_address', '_token', '_secret'];
function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_KEY_NAMES.has(k) || SENSITIVE_KEY_SUFFIXES.some(s => k.endsWith(s));
}
```

---

## Finding #24: `Captcha bypass header` (`CAPTCHA_BYPASS_HEADER`) — name configurable but value check is literal "true"/"1"

**Severity:** Low
**Category:** Security
**File:** `src/shared/middlewares/security/captcha.middleware.ts`

**Issue:** Acceptance values are literal `'true'` or `'1'`. Production rejects the bypass regardless. Risk is that a misconfiguration that ships `CAPTCHA_BYPASS_HEADER=x-bypass` to production combined with a separate misconfiguration `NODE_ENV=staging` (typo) reintroduces the bypass.

**Evidence:** `src/shared/middlewares/security/captcha.middleware.ts:50-63`.

**Impact:** Defense-in-depth gap; relies on `NODE_ENV` being correct.

**Recommended Fix:** Pair the bypass header check with a HMAC-signed token instead of a hard-coded "true". Make bypass only possible with a per-test signing key not in production env.

**Safer Code Example:** _N/A — pattern change_

---

## Finding #25: `apiKeyAuth` does not check `X-Organization-Id` matches the API key's pinned organization at middleware time

**Severity:** Medium
**Category:** Security
**File:** `src/shared/middlewares/security/api-key-auth.middleware.ts`, `src/shared/middlewares/tenant/tenant.middleware.ts`

**Issue:** When an API-key auth succeeds, the middleware sets `request.organizationId = match.organization_public_id` **overwriting** any header value. Good. But the tenant middleware runs in `onRequest` *before* `app.authenticate` (which runs in `preHandler`), so the tenant middleware first set `request.organizationId` from header (or null). The order is correct *within* the request, but the same field is being touched by both. If a route forgets `app.authenticate` and relies on `request.organizationId` set by the tenant middleware, the API-key path is bypassed.

**Evidence:** `src/shared/middlewares/security/api-key-auth.middleware.ts:78-80` plus `src/shared/middlewares/tenant/tenant.middleware.ts:38-64`.

**Impact:** Footgun for future route additions that skip `app.authenticate`. No active misuse.

**Recommended Fix:** Have the tenant middleware skip its own assignment when `request.auth?.kind === 'apiKey'` (impossible at onRequest time, so reverse the relationship: the api-key auth middleware asserts the tenant org matches its pinned org and throws otherwise).

**Safer Code Example:**
```ts
// In applyApiKeyAuthentication, before assigning:
const headerOrg = request.organizationId;
if (headerOrg && headerOrg !== match.organization_public_id) {
  throw new ForbiddenError('errors:apiKeyOrganizationMismatch');
}
request.organizationId = match.organization_public_id;
```

---

## Finding #26: Default `genReqId` accepts `x-request-id` from request, but Sentry hint `request_id` is sourced from `request.id` — log poisoning chain

**Severity:** Low
**Category:** Security
**File:** `src/shared/middlewares/core/error-handler.middleware.ts`, `src/shared/utils/http/fastify-server.util.ts`

**Issue:** `getRequestId(request)` uses `request.id ?? randomUUID()`. Sentry captureException attaches `requestId` to extras. If `request.id` was poisoned (Finding #12), the Sentry event carries a poisoned correlation id.

**Impact:** Chained risk only; severity is the same as Finding #12.

**Recommended Fix:** Same as Finding #12 — generate server-side request id, store client value in a separate field.

---

## Finding #27: `cookie.middleware.ts` registers `@fastify/cookie` with empty `parseOptions: {}` and no `secret` — by design for session cookie, but signed cookies cannot be used elsewhere

**Severity:** Low
**Category:** Security
**File:** `src/shared/middlewares/session/cookie.middleware.ts`

**Issue:** Empty options. If a future PR introduces a different signed cookie (e.g. a remember-me cookie or a marketing-tracking cookie that should be tamper-evident), Fastify cookie can't sign it without re-registration. Document the contract.

**Impact:** Future-PR footgun.

**Recommended Fix:** Add comment that all sensitive cookies must be cryptographic random values (current design) and that signing should never be reintroduced via shared secret.

---

## Finding #28: `applyApiKeyAuthentication` only fetches by 8-char `keyPrefix`, then loops with `hashCompare` — DB index must be on `(key_prefix, is_active=true, deleted_at IS NULL)` for performance

**Severity:** Low
**Category:** Security/Performance
**File:** `src/domains/tenancy/sub-domains/organization/organization-api-key/organization-api-key.service.ts`

**Issue:** Reliant on a partial index for performance under high QPS. Migration audit is out of scope, but flag the operational risk: a missing partial index degrades API-key auth to a full table scan.

**Impact:** Performance under load.

**Recommended Fix:** Confirm `CREATE INDEX … ON organization_api_keys (key_prefix) WHERE deleted_at IS NULL` exists; add a domain test.

---

## Finding #29: No CSP `report-uri` or `report-to` — CSP violations are not surfaced

**Severity:** Low
**Category:** Security
**File:** `src/shared/middlewares/security/helmet.middleware.ts`

**Issue:** Helmet CSP is restrictive but no reporting endpoint is configured. CSP violations in the wild (browser extensions, bad embeds) go unobserved.

**Impact:** Reduced visibility into XSS attempts.

**Recommended Fix:** Add `reportUri: '/csp-report'` and a Fastify route that posts violations to Sentry as breadcrumbs.

---

## Finding #30: Worker family `WORKER_QUEUE_FAMILIES=all` with maxed `WORKER_CONCURRENCY_*` can exceed Postgres `max_connections` via cluster sizing

**Severity:** High
**Category:** Security/Stability (DoS surface)
**File:** `src/shared/config/env-schema.ts`, `src/infrastructure/queue/worker-runtime/worker-connection-budget.ts`

**Issue:** The schema permits per-queue concurrency up to 20 each (mail, notify, webhook, stripe), defaulting to 4. With `WORKER_QUEUE_FAMILIES=all` and pool max derived per-process, six API replicas + four worker replicas can plausibly demand `(DATABASE_POOL_MAX × replicas)` connections that exceed Neon/Railway's `max_connections - POSTGRES_RESERVED_CONNECTIONS`. The budget util warns but does not refuse to start.

**Evidence:** `src/shared/config/env-schema.ts:233-244, 207-232`.

**Impact:** Connection-exhaustion DoS during deploys (rolling restarts double the connection demand briefly).

**Recommended Fix:** Add a `pnpm validate:deployment-budget` script that checks `(DATABASE_POOL_MAX + sum(workerConcurrency)) × (API_REPLICAS + WORKER_REPLICAS) ≤ POSTGRES_MAX_CONNECTIONS - POSTGRES_RESERVED_CONNECTIONS` and fail CI if exceeded. The infrastructure already has `assertPostgresConnectionBudget` at boot — extend it to fail (not just warn) when the cluster demand exceeds capacity.

---

# Section 2 — API Stability & Robustness

## Finding #31: `event-bus.emit` swallows handler errors via Promise.all → logger.error — failed side effects are silently lost

**Severity:** High
**Category:** Stability
**File:** `src/core/events/event-bus.ts`
**Function/Route/Worker:** `EventBus.emit`

**Issue:** Handlers run via `Promise.all` and each handler is wrapped in `try { } catch { logger.error(...) }`. Failed handlers do not propagate. Some handlers enqueue email or webhook delivery via `scheduleCommitDispatch`; a failure to enqueue means the side effect is lost permanently (no retry).

**Evidence:** `src/core/events/event-bus.ts:150-163`.

**Impact:** Lost mail outbox enqueues, lost webhook deliveries, lost audit log emissions when an event handler's downstream (Redis SET) transiently fails.

**Exploit / Failure Scenario:** Redis hiccup during a magic-link send: `scheduleCommitDispatch` falls back to in-memory `onCommit` (log: `commit-dispatch.append_failed.fallback_to_memory`). The process crashes between the fallback and the request response → the in-memory task is lost → user never receives magic link.

**Recommended Fix:** When a handler throws, the bus must observe (Sentry breadcrumb + Sentry capture for events that mutate user-visible state). Build an opt-in `emitWithDurability` that *requires* `scheduleCommitDispatch` so durable retries are guaranteed; reject events that lack one.

**Safer Code Example:**
```ts
async emit(event: DomainEvent): Promise<void> {
  const handlers = this.handlers.get(event.type) ?? [];
  if (handlers.length === 0) return;
  const errors: { handlerName: string; err: unknown }[] = [];
  await Promise.all(handlers.map(async (handler, i) => {
    try { await handler(event); }
    catch (err) {
      errors.push({ handlerName: handler.name ?? `handler#${i}`, err });
      captureException(err as Error, { tags: { eventType: event.type, handlerName: handler.name ?? 'anon' } });
    }
  }));
  // Emit a single warn with the count so handler failures are visible in dashboards.
  if (errors.length > 0) logger.warn({ eventType: event.type, count: errors.length, errors }, 'event-bus.handler.failures');
}
```

---

## Finding #32: `flushOnCommit` runs durable Redis tasks BEFORE in-memory onCommit tasks — out-of-order side effects

**Severity:** High
**Category:** Stability
**File:** `src/core/events/event-bus.ts`
**Function/Route/Worker:** `EventBus.flushOnCommit`

**Issue:** The durable Redis-backed dispatch runs sequentially (one-by-one) and synchronously, then the in-memory queue runs via `Promise.all`. This guarantees no atomic ordering between durable and in-memory tasks. If a workflow uses both (e.g. durable mail enqueue + in-memory audit log), the audit can land before the durable task succeeds, leaving the audit pointing at a state that never materialized.

**Evidence:** `src/core/events/event-bus.ts:103-133`.

**Impact:** Audit log inconsistency in failure modes.

**Recommended Fix:** Document the contract: use either durable OR in-memory tasks for any single workflow. Add a `mergeFlush()` variant that runs both queues in registration order, awaiting strictly.

**Safer Code Example:**
```ts
async flushOnCommit(opts?: { requestId?: string }) {
  const durableTasks = opts?.requestId ? await consumeCommitDispatchTasks({ requestId: opts.requestId }) : [];
  const inMemTasks = onCommitStorage.getStore()?.tasks ?? [];
  const all = [...durableTasks.map(t => () => executeCommitDispatchTask(t)), ...inMemTasks];
  for (const task of all) {
    try { await task(); } catch (err) { logger.error({ err }, 'commit.task.failed'); }
  }
}
```

---

## Finding #33: `redis.connection` `enableOfflineQueue: false` + `maxRetriesPerRequest: null` — commands hang indefinitely during a long Redis stall

**Severity:** High
**Category:** Stability
**File:** `src/infrastructure/cache/redis.client.ts`

**Issue:** `maxRetriesPerRequest: null` means ioredis will retry forever; combined with `enableOfflineQueue: false`, commands fail immediately during disconnect but a partial connect (TCP up, Redis unresponsive) results in the command sitting in the in-flight queue with no timeout. There is no `commandTimeout` set on individual commands; only the connection-level retry strategy applies.

**Evidence:** `src/infrastructure/cache/redis.client.ts:14-33`.

**Impact:** A frozen Redis (split-brain failover, full-disk) holds connections open with pending commands. HTTP handlers awaiting these commands stall until the request timeout fires (5s statement_timeout for Postgres but no equivalent for Redis here).

**Recommended Fix:** Set `commandTimeout: 3_000` (or via env) on the ioredis instance. Add chaos tests for slow-Redis scenarios.

**Safer Code Example:**
```ts
export const redisConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3, // bounded
  commandTimeout: 3_000,    // bound per-command
  // ...
});
```

---

## Finding #34: Many controllers cast `request.params as { publicId: string }` instead of relying on Zod type provider

**Severity:** Medium
**Category:** Stability
**File:** `src/domains/upload/upload.controller.ts` (and others)

**Issue:** Controllers like `(request.params as { publicId: string }).publicId` bypass Fastify's Zod type provider, which would validate and refine. The DTO `uploadPublicIdParamDto` is defined but not registered on the routes (`schema: { ... }` lacks `params`). The validator later calls `validateUploadPublicIdParam` to re-check, but `confirmUpload` / `deleteUpload` route registrations omit `params: uploadPublicIdParamDto` entirely.

**Evidence:** `src/domains/upload/upload.controller.ts:22-41`, `src/domains/upload/upload.routes.ts:45-49`.

**Impact:** Missing validation at the route boundary; relies on the controller-internal validator. Consistent today but easy to miss.

**Recommended Fix:** Attach `params: uploadPublicIdParamDto` to every route; remove the cast.

**Safer Code Example:**
```ts
zodApplication.post('/:publicId/confirm', {
  onRequest: [app.authenticate],
  ...MODERATE_AUTHED_RATE_LIMIT,
  schema: { params: uploadPublicIdParamDto },
}, controller.confirmUpload);
// Controller: const { publicId } = request.params;
```

---

## Finding #35: `body.fileSize` is unbounded in `createUploadDto` — relies on validator-layer cap

**Severity:** Medium
**Category:** Stability
**File:** `src/domains/upload/upload.dto.ts`, `src/domains/upload/upload.validator.ts`

**Issue:** `fileSize: z.number().int().positive()` has no `.max()`. A client can submit `fileSize: Number.MAX_SAFE_INTEGER`; Zod accepts it, then the post-Zod validator compares it against `config.maxSize`. Defense-in-depth: the schema layer should also cap.

**Evidence:** `src/domains/upload/upload.dto.ts:9-23`.

**Impact:** Bigger surface for bug-finding; if validator-layer is bypassed (e.g. service called from another internal context), unbounded size could pass.

**Recommended Fix:** Add `.max(MAX_ANY_UPLOAD_SIZE_BYTES)` where `MAX_ANY_UPLOAD_SIZE_BYTES` is the max across all purposes.

**Safer Code Example:**
```ts
fileSize: z.number().int().positive().max(MAX_ANY_UPLOAD_SIZE_BYTES),
```

---

## Finding #36: `webhookService.update` calls `resolveAndPinWebhookUrl(parsed.url)` outside the transaction; URL change then update may race

**Severity:** Medium
**Category:** Stability
**File:** `src/domains/notify/sub-domains/webhook/webhook.service.ts`
**Function/Route/Worker:** `WebhookService.update`

**Issue:** SSRF pin runs at the SERVICE entry, then the DB transaction starts. A racing rotation of DNS between the pin call and the update means the persisted URL passes pin at update-time but resolves differently when the worker dispatches. This is by design (DNS pinning happens per-delivery), so the duplication is not harmful. However, on update, the URL is *persisted* but the resolved address is not — and the worker re-resolves. The pin at update time only validates the URL was safe at that instant; a DNS-rebinding window between update and first delivery is still open. This is correct behavior but worth documenting.

**Evidence:** `src/domains/notify/sub-domains/webhook/webhook.service.ts:152-200`.

**Impact:** Documentation only.

**Recommended Fix:** Comment in code clarifying that the per-delivery pin is the actual SSRF defense; update-time pin is a UX shortcut to fail fast on obviously-bad URLs.

---

## Finding #37: `dispatchOrganizationWebhooks` rethrows only when 100% of fanout fails

**Severity:** Medium
**Category:** Stability
**File:** `src/domains/notify/sub-domains/webhook/webhook.service.ts`
**Function/Route/Worker:** `WebhookService.dispatchOrganizationWebhooks`

**Issue:** When `failureCount === webhooks.length` the first error is rethrown. A 99% failure rate is silently logged but the caller proceeds as if dispatch succeeded. BullMQ will not retry the entire batch even if 99 out of 100 endpoints were unreachable, because the partial-success case returns normally.

**Evidence:** `src/domains/notify/sub-domains/webhook/webhook.service.ts:236-278`.

**Impact:** Webhook delivery losses during a partial outage of upstream — only 1% of subscribers received the event, the others have failed `requestWebhookDelivery` calls that did not persist a delivery attempt row.

**Exploit / Failure Scenario:** Redis hiccup during a billing event fanout to 100 webhooks: 99 enqueue calls throw, 1 succeeds. Caller sees no error → no retry → 99 endpoints permanently miss the event.

**Recommended Fix:** Always persist a "fanout request" attempt row per webhook BEFORE enqueueing, so a failure at enqueue still leaves a recoverable record that the mail/notification sweeper or a dedicated dispatch sweeper can replay. Alternatively, retry the fanout via BullMQ if any individual enqueue failed.

**Safer Code Example:**
```ts
if (failureCount > 0 && firstError !== undefined) {
  // Persist a fanout failure row + emit Sentry so partial outage is investigated.
  captureMessage('notify.webhook.fanout.partialFailure', { extra: { failureCount, total: webhooks.length } });
  if (failureCount === webhooks.length) throw firstError;
}
```

---

## Finding #38: `auth.controller.ts` exports handlers but Stripe webhook route reads `request.stripeWebhookEvent` from a custom Fastify type augmentation; no fallback if augmentation diverges

**Severity:** Low
**Category:** Stability
**File:** `src/domains/billing/sub-domains/stripe-webhook/stripe-webhook-ingress.plugin.ts`

**Issue:** `request.stripeWebhookEvent = stripeWebhookEvent;` mutates the request with an ambient type. If a downstream Fastify middleware copies the request object (it shouldn't), the augmentation is lost. Low-risk pattern.

**Recommended Fix:** Document the augmentation contract in `app.d.ts`.

---

## Finding #39: `app.ts` content-type parser reads the entire body into a Buffer for *every* JSON request, even when not a Stripe webhook

**Severity:** Medium
**Category:** Stability/Scalability
**File:** `src/app.ts`
**Function/Route/Worker:** `app.addContentTypeParser('application/json', { parseAs: 'buffer' }, ...)`

**Issue:** Fastify normally streams JSON. With `parseAs: 'buffer'`, the entire body is buffered before `JSON.parse` runs, on every request — not just on Stripe webhook paths. The body limit (1 MB) bounds the buffer, but every authenticated POST also pays the buffer copy.

**Evidence:** `src/app.ts:70-81`; `src/shared/utils/http/fastify-server.util.ts:109` (`bodyLimit: 1_048_576`).

**Impact:** Roughly doubled JSON parsing memory peak per request; minor latency for large bodies.

**Recommended Fix:** Use Fastify's per-route content parsers: register a buffer parser only on the Stripe webhook route; let other routes use the default streaming JSON parser.

**Safer Code Example:**
```ts
// In stripe-webhook routes:
app.register(async (scope) => {
  scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    (request as { rawBody?: Buffer }).rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
    try { done(null, JSON.parse(body.toString())); } catch (e) { done(e as Error, undefined); }
  });
  // ... webhook routes
});
```

---

## Finding #40: `userDataExport` worker streams in-memory; large exports for users with millions of audit rows can exceed `RSS_WARNING_THRESHOLD_BYTES`

**Severity:** Medium
**Category:** Stability
**File:** `src/domains/user/sub-domains/user-data-export/user-data-export.service.ts`

**Issue:** `buildExportPayload` loads up to `GDPR_EXPORT_MAX_ROWS_PER_TABLE + 1` rows per category in parallel into memory, JSON-serializes the entire object, gzips it, then uploads via `objectStorage.putObject`. The cap exists but the gzipped body must still fit in memory. With a high cap (10,000 audit rows × hundreds of bytes each = MBs), and parallel fetch of four categories, peak memory spikes during the export.

**Impact:** Worker OOM under bursty export requests, especially when split workers share a single container.

**Recommended Fix:** Stream JSON-gzip directly to S3 using a streaming PUT (`putObjectStream`); discard each category from memory after serializing.

---

## Finding #41: `request-lifecycle` `onResponse` runs idempotency cache write + outbox flush *after* response is sent; the network round-trip ends before durable state is final

**Severity:** Medium
**Category:** Stability
**File:** `src/shared/middlewares/core/request-lifecycle.middleware.ts`

**Issue:** Fastify `onResponse` runs after the response is flushed to the wire. If the process crashes between response send and Redis cache write, the client sees success but the idempotency cache is empty, so a retry re-executes the handler. Same for the outbox flush — durable Redis-backed tasks are persisted before commit, but the in-memory queue's tasks run only here, after response.

**Evidence:** `src/shared/middlewares/core/request-lifecycle.middleware.ts:35-69`.

**Impact:** A retry replays a successful write, breaking idempotency. The durable commit-dispatch sweeper recovers durable tasks, but in-memory `onCommit` tasks (mail enqueues that did not go through `scheduleCommitDispatch`) are lost.

**Recommended Fix:** Document that all post-response side effects MUST go through `scheduleCommitDispatch` (durable). Audit the codebase for `eventBus.onCommit` callers and migrate them.

---

## Finding #42: `revokeSessionByAccessToken` invalidates Redis cache BEFORE the DB revoke succeeds; a failed DB revoke leaves stale cache "valid" entries unreachable but the session still active

**Severity:** Low
**Category:** Stability
**File:** `src/domains/auth/sub-domains/auth-session/auth-session.service.ts`

**Issue:** Order is `await invalidateCachedSessionToken(tokenHash); const revoked = await ...revokeByTokenHash(tokenHash)`. If the DB revoke throws, the cache is invalidated (good) but the DB still says active. Next request re-validates via DB and re-caches as valid. Self-healing — no leak.

**Impact:** No real impact; documents pattern.

**Recommended Fix:** None.

---

## Finding #43: Stripe webhook ingress logs `eventId` on verify but does NOT check `event.created` against a clock-skew window of its own

**Severity:** Low
**Category:** Stability
**File:** `src/domains/billing/sub-domains/stripe-webhook/stripe-webhook-ingress.plugin.ts`

**Issue:** `constructStripeWebhookEvent` (Stripe SDK) enforces a 5-min clock skew. Operationally fine, but if an operator manually re-fires a 7-day-old test event from Stripe dashboard, the ingress will reject signature; if an attacker captures a recent (within 5 min) signed event from logs, they can replay it because the worker idempotency dedupes by `event.id` but not by ingest time. Replay protection depends on the worker's idempotent claim.

**Impact:** Theoretical replay is bounded by Stripe's clock-skew window and the worker's idempotent claim — defense in depth.

**Recommended Fix:** No change.

---

## Finding #44: Notify dispatch resolves org public id BEFORE the row insert, so a missing org throws BEFORE writing — but does the lookup outside the transaction

**Severity:** Low
**Category:** Stability
**File:** `src/domains/notify/sub-domains/notification/notification-dispatch.service.ts`

**Issue:** Lookup + insert are not in a single transaction; a concurrent org soft-delete could land between them. Insert would then succeed with a now-invalid `organization_id` reference, only to be picked up at delivery time and either succeed (RLS allows soft-deleted orgs to receive notifications?) or fail.

**Impact:** Edge case.

**Recommended Fix:** Run both inside a single transaction with `withOrganizationDatabaseContext`.

---

## Finding #45: `auth-session.service.refreshSessionCredentials` reuse detection re-reads the session a second time to disambiguate "expired" from "reused" — extra round-trip on every failed refresh

**Severity:** Low
**Category:** Stability/Performance
**File:** `src/domains/auth/sub-domains/auth-session/auth-session.service.ts`

**Issue:** When `rotated === null`, the service issues another `findByPublicId` inside `withSessionPublicIdDatabaseContext` to learn whether the refresh token mismatch means "session expired" or "refresh reuse". Two DB hits on every failed refresh.

**Impact:** Performance under brute-force refresh attempts.

**Recommended Fix:** Make `rotateSessionCredentials` return the existing `refresh_token_hash` (or a flag indicating reuse) in a single round-trip so the caller can branch without re-reading.

---

# Section 3 — Scalability & Performance

## Finding #46: `permission-cache` recompute lock TTL == cache TTL — stampede holds lock for the FULL cache lifetime

**Severity:** High
**Category:** Scalability
**File:** `src/domains/tenancy/sub-domains/permission/permission-cache.service.ts`

**Issue:** `PERMISSION_CACHE_RECOMPUTE_LOCK_TTL_SECONDS` (not visible in this file but referenced) gates the recompute. If the lock TTL equals or exceeds `PERMISSION_CACHE_DEFAULT_TTL_SECONDS`, a crashed recompute leaves the lock until TTL, blocking every other request. The compare-and-del release on exception handles the happy crash, but a process kill -9 strands the lock until TTL.

**Recommended Fix:** Set recompute lock TTL to a small bounded window (e.g. 5 seconds — the maximum a recompute should take) regardless of cache TTL.

---

## Finding #47: `Sentry continuous profiling` enabled with `PRODUCTION_PROFILE_SESSION_SAMPLE_RATE` in prod — V8 profiler overhead

**Severity:** Medium
**Category:** Scalability/Performance
**File:** `src/infrastructure/observability/sentry/sentry.ts`

**Issue:** V8 CpuProfiler imposes ~5-15% CPU overhead on profiled transactions. Profile sample rate is configurable; default settings are not visible without reading the sampling util. Verify production rate is ≤ 0.1.

**Recommended Fix:** Document default sample rate; ensure prod default ≤ 10%.

---

## Finding #48: `redactSensitive` walks every log object recursively (max depth 8) — non-trivial CPU on every log line

**Severity:** Medium
**Category:** Scalability/Performance
**File:** `src/shared/utils/security/sensitive-redaction.util.ts`

**Issue:** Pino `formatters.log` runs the recursive redactor on EVERY log entry. With `LOG_LEVEL=info` and high request volume, this is sustained CPU. The walker creates a fresh object graph (deep copy) per log.

**Impact:** Throughput ceiling under load; logger becomes hot path.

**Recommended Fix:** Use Pino's built-in `redact.paths` for top-level paths (already done) and skip recursive redaction except on objects matching a `_needsRedaction` marker. Cache redaction results by reference for the duration of a request.

---

## Finding #49: `idempotency.middleware` reads + writes Redis on every write request — single round-trip latency on the hot path

**Severity:** Medium
**Category:** Scalability/Performance
**File:** `src/shared/middlewares/core/idempotency.middleware.ts`

**Issue:** Every POST/PUT/PATCH/DELETE incurs a `GET` (cache check), a `SETNX` (claim), and an `INCR` (counter) sequentially. Three Redis round-trips per write before the handler runs. Combined with permission-cache reads (another 1-2 round-trips), authenticated writes have 4-5 Redis trips at minimum.

**Impact:** Round-trip-bound latency under degraded Redis.

**Recommended Fix:** Combine GET + SETNX into one Lua script so the round-trip cost is 1 instead of 2. Use `EXPIRE` + `INCRBY` batching where possible.

---

## Finding #50: `webhookDelivery` worker re-creates the per-webhook circuit breaker if not in cache — cache invalidation on URL change is best-effort

**Severity:** Medium
**Category:** Scalability
**File:** `src/domains/notify/sub-domains/webhook/webhook-delivery/workers/webhook-outbound-circuit.ts`

**Issue:** `invalidateWebhookOutboundCircuit(webhookId)` is called from the service `update`/`delete` paths, but cross-process workers fall back to the cache's idle TTL. During the window, a worker can use stale breaker state (e.g. half-open against the old URL).

**Impact:** Stale circuit breaker behavior post-update.

**Recommended Fix:** Publish a Redis pub/sub message on `update`; subscribers in each worker drop the cached breaker on receipt.

---

## Finding #51: BullMQ `RSS warning threshold 512 MB` — no hard limit / graceful shutdown when worker memory grows unbounded

**Severity:** Medium
**Category:** Scalability
**File:** `src/infrastructure/queue/bootstrap.ts`

**Issue:** `startRssMonitoring` warns at 512 MB but takes no action. A worker leaking memory (e.g. webhook delivery worker accumulating fetch buffers) will be killed by OOM rather than performing a graceful shutdown.

**Impact:** Job loss / partial transactions on OOM kill.

**Recommended Fix:** When RSS > threshold for 3 consecutive samples, initiate graceful shutdown and let the orchestrator restart.

---

## Finding #52: `compress.middleware` threshold 1024 bytes — small JSON responses (≤ 1 KB, the common case for list endpoints with `limit=1`) are not compressed

**Severity:** Low
**Category:** Scalability
**File:** `src/shared/middlewares/core/compress.middleware.ts`

**Issue:** Many list endpoints return ≤ 1 KB; threshold prevents compression. Mild bandwidth cost.

**Recommended Fix:** Lower threshold to 256 bytes for HTTP/2 environments where compression overhead is minimal.

---

## Finding #53: `BUILD_PUBLIC_ID_REGEX` `[A-Za-z0-9_-]{21}` — extracted from URL only at first match position; long URLs scan from start

**Severity:** Low
**Category:** Performance
**File:** `src/shared/middlewares/tenant/tenant.middleware.ts`

**Issue:** The regex `\/organizations\/([A-Za-z0-9_-]{21})(?:\/|$)/` runs on every request URL. Compiled once (module-level), so it's cheap, but worth noting that it scans the entire URL each request. Not a real performance concern at typical URL length.

**Recommended Fix:** None.

---

## Finding #54: `getCachedSessionTokenValid` Redis cache is 60s — `revokeAllSessions` issues N parallel `DEL`s without batching

**Severity:** Low
**Category:** Performance
**File:** `src/domains/auth/sub-domains/auth-session/auth-session.service.ts`, `session-token-cache.service.ts`

**Issue:** `invalidateRevokedSessionCaches` does `Promise.all(map(invalidate))`. If a user has 100 devices and "revoke all" is invoked, 100 parallel Redis DELs run. Acceptable but could be one MGET + one DEL.

**Recommended Fix:** Batch Redis DELs via `UNLINK key1 key2 ...`.

---

## Finding #55: `email` field in user repository — case-insensitive `LIKE %term%` search via backslash escaping; no functional index on `LOWER(email)` visible

**Severity:** Medium
**Category:** Performance
**File:** `src/domains/user/user.repository.ts` (per Phase A explore)

**Issue:** The user search uses `LIKE %term%` with backslash escaping on email + name. Leading wildcards prevent index usage; full table scans on large `users` tables.

**Recommended Fix:** Use trigram (`pg_trgm`) GIN index on `email_normalized` and `LOWER(full_name)` for prefix or fuzzy search. Cap search to authenticated admin contexts.

---

## Finding #56: `LISTEN/NOTIFY` not used for permission cache invalidation across replicas

**Severity:** Medium
**Category:** Scalability
**File:** `src/domains/tenancy/sub-domains/permission/permission-cache.service.ts`

**Issue:** Invalidation runs `INCR perm:org:<org>:v` on Redis, which IS cross-replica (Redis is shared). Good. So this is fine — no finding. Recanting.

---

## Finding #57: `Stripe webhook` worker uses `withSystemTableWorkerContext` for the ledger write, then enters `withOrganizationContext` — two distinct GUC settings per event

**Severity:** Low
**Category:** Performance
**File:** `src/domains/billing/sub-domains/stripe-webhook/stripe-webhook.service.ts`

**Issue:** Two transactions per event. The ledger write needs admin context; the subscription update needs org context. Two distinct DB round-trips for the GUC set, two transactions for the work. Could combine into a single transaction if the RLS policies allowed it.

**Impact:** Per-event throughput limited by Postgres transaction overhead under burst loads.

**Recommended Fix:** Run both in a single transaction with the org GUC set, allowing the system-table policy to also accept org context.

---

## Finding #58: `user-data-export` `buildExportPayload` runs four cross-domain reads in parallel — but each reads up to 10,000+ rows; peak memory grows linearly with categories added

**Severity:** Medium
**Category:** Scalability
**File:** `src/domains/user/sub-domains/user-data-export/user-data-export.service.ts`

**Issue:** Each category fetches `fetchLimit = 10,001` rows in parallel. Adding more categories (e.g. memberships, audit, sessions, notifications, *uploads*, *webhooks*) compounds peak memory linearly.

**Recommended Fix:** Process categories serially when worker concurrency is shared; stream gzip to S3 per-category.

---

## Finding #59: Connection pool `idle_timeout: 30s` is short for Postgres connection establishment cost on TLS

**Severity:** Medium
**Category:** Performance
**File:** `src/infrastructure/database/connection.ts`

**Issue:** A 30-second idle timeout combined with bursty traffic causes constant reconnect churn under load valleys. TLS handshake to Neon adds 100-200ms per new connection.

**Recommended Fix:** Increase to 60-120s; align with Neon's 5-min idle close so reconnects are predictable.

---

## Finding #60: `mail-outbox sweeper` runs every 10 min — outbox latency floor for failed sends is 10 min

**Severity:** Low
**Category:** Scalability
**File:** `src/infrastructure/queue/scheduler.ts`

**Issue:** A user signing up during a Resend outage waits ≥10 min after Resend recovers for the magic-link email.

**Recommended Fix:** Drop to 2 min for outbox sweeper; outbox writes are cheap and rarely loaded.

---

# Section 4 — Workers, Queues & Background Jobs

## Finding #61: DLQ `audit.dead_letter_jobs` rows survive replay attempts indefinitely; no auto-purge of *successfully replayed* rows

**Severity:** High
**Category:** Stability
**File:** `src/infrastructure/queue/dlq/dead-letter.ts`, `src/infrastructure/queue/dlq/dlq-auto-retry.worker.ts`

**Issue:** The Postgres DLQ ledger is the durable source of truth. Redis DLQ entries auto-evict after 30 days, but Postgres rows are never purged — even when the auto-retry sweeper successfully replays them. Table grows monotonically.

**Recommended Fix:** Add a retention cron `daily-dead-letter-jobs-purge` that hard-deletes rows older than 90 days OR with `replayed_at IS NOT NULL` older than 30 days.

---

## Finding #62: Webhook delivery `WEBHOOK_DELIVERY_MAX_RETRY_ATTEMPTS = 4` but BullMQ's `attempts` is set elsewhere — alignment ambiguity

**Severity:** High
**Category:** Stability
**File:** `src/domains/notify/sub-domains/webhook/webhook-delivery/workers/webhook-delivery.worker.ts`

**Issue:** `WEBHOOK_DELIVERY_MAX_RETRY_ATTEMPTS = 4` is used to compute `next_retry_at`, but BullMQ's `attempts` is configured elsewhere (worker options or default). If they drift, persisted `next_retry_at` can suggest a retry that BullMQ will not perform.

**Recommended Fix:** Derive `WEBHOOK_DELIVERY_MAX_RETRY_ATTEMPTS` from the BullMQ default-job-options at startup; add a contract test.

---

## Finding #63: Stripe webhook claim → handler → markProcessed sequence does not enforce a max-lease — a stuck handler holds the claim until lease expiry

**Severity:** High
**Category:** Stability
**File:** `src/domains/billing/sub-domains/stripe-webhook/stripe-webhook.service.ts`

**Issue:** `tryClaimEvent` has a lease window (visible by name only). If a handler crashes mid-dispatch, the event sits in "still_processing" until the lease expires. Reclaim worker runs every 5 min — recovery is bounded but slow.

**Recommended Fix:** Document lease window; add metric `stripe.webhook.lease_held_seconds`.

---

## Finding #64: `attachDeadLetterAndAlerting` registers a `failed` listener but does not handle `error` (worker-level) — uncaught worker errors are unobserved

**Severity:** Medium
**Category:** Stability
**File:** `src/infrastructure/queue/dlq/dead-letter.ts`

**Issue:** Only `worker.on('failed', ...)` is wired. `worker.on('error', ...)` is unsubscribed; Redis disconnect or BullMQ-internal errors are unobserved.

**Recommended Fix:** Add `worker.on('error', (err) => { captureException(err, { tags: { queue: queueName } }); })`.

---

## Finding #65: `webhook-delivery` worker idempotency relies on `tryMarkSending` to atomically transition `PENDING → SENDING` — but the *event itself* (event_type+payload hash) is not deduplicated

**Severity:** Medium
**Category:** Stability
**File:** `src/domains/notify/sub-domains/webhook/webhook-delivery/workers/webhook-delivery.worker.ts`

**Issue:** Two `WebhookDeliveryAttempt` rows for the same `webhook_id + event_id` would both run independently. The fanout layer prevents duplicate attempts per event, but a manual replay via the queue dashboard can create a duplicate attempt and the subscriber receives the event twice.

**Recommended Fix:** Add a unique index `(webhook_id, event_id)` on `notify.webhook_delivery_attempts`; the create call should `ON CONFLICT DO NOTHING`.

---

## Finding #66: `notification.worker` does not have a documented idempotency strategy in the audit snippet — verify per-job dedup key

**Severity:** Medium
**Category:** Stability
**File:** `src/domains/notify/sub-domains/notification/workers/notification.worker.ts` (not opened in detail)

**Issue:** Not enough evidence to confirm a per-job idempotency key. Flag for follow-up.

**Recommended Fix:** Add unit test asserting that re-running a notification job for the same `notification_id` is a no-op.

---

## Finding #67: Tombstone retention workers run sequentially in cron (5:45 → 5:53) — FK-safe ordering but no transaction across them

**Severity:** Low
**Category:** Stability
**File:** `src/infrastructure/queue/scheduler.ts`

**Issue:** A crash mid-sequence leaves the tombstone graph inconsistent until the next nightly run. Acceptable since FK-safe ordering means partial completion never violates FKs; just deferred cleanup.

**Recommended Fix:** Add Sentry alert when any tombstone retention worker has not run in 48 hours.

---

## Finding #68: `commit-dispatch-recovery` runs every 5 min — durable tasks waiting on recovery experience a 5-min tail latency

**Severity:** Medium
**Category:** Stability
**File:** `src/infrastructure/queue/commit-dispatch/commit-dispatch-recovery.worker.ts`

**Issue:** If the API process crashes between `scheduleCommitDispatch` Redis RPUSH and the subsequent `flushOnCommit`, the recovery worker picks up the orphaned tasks every 5 min.

**Impact:** Up to 5-min delay for the side effects of a successful but crash-after-response request.

**Recommended Fix:** Lower interval to 1 min; recovery work is cheap.

---

## Finding #69: `mail-outbox` reclaim threshold (`MAIL_OUTBOX_RECLAIM_SENDING_MINUTES = 30`) is conservative; a stuck send blocks the row for 30 min

**Severity:** Low
**Category:** Stability
**File:** `src/shared/config/env-schema.ts`

**Issue:** 30-min reclaim is safe (avoids double-send while Resend retry is in flight), but a Resend total-outage means messages are delayed 30+ min from queue.

**Recommended Fix:** Document the trade-off; align with Resend's idempotency window (24h).

---

## Finding #70: `Worker.on('stalled', ...)` logs warnings but the stall reason (lock lost vs job stuck) is opaque

**Severity:** Low
**Category:** Observability
**File:** Multiple worker files (e.g. `webhook-delivery.worker.ts`, `audit-retention.worker.ts`).

**Issue:** Stall reason is not distinguished. A repeatedly stalled job indicates either lock starvation under contention or a runaway processor.

**Recommended Fix:** Add a metric `worker.stalled_total{queue=...}` so Prometheus / Sentry can correlate.

---

## Finding #71: DLQ Postgres ledger insert uses base DB connection (no RLS context), bypassing tenant isolation by design

**Severity:** Low
**Category:** Stability
**File:** `src/infrastructure/queue/dlq/dead-letter.ts`

**Issue:** Documented: "runs outside any request/worker DB context; identifiers are passed explicitly". DLQ rows carry `organizationPublicId` in payload summary but the rows are stored in `audit.dead_letter_jobs` accessible to admin. Confirmed as intentional design.

**Recommended Fix:** Document in `docs/reference/queue/dlq.md` that DLQ rows are admin-only and not subject to RLS.

---

## Finding #72: `DLQ_AUTO_RETRY_MAX_COUNT = 3` per row — silent permanent failure when exceeded

**Severity:** Medium
**Category:** Stability
**File:** `src/shared/config/env-schema.ts`

**Issue:** After 3 auto-retries, the row sits indefinitely (no Sentry alert on the auto-retry circuit-open event). Operators must manually inspect.

**Recommended Fix:** Emit Sentry `dlq.auto_retry.exhausted` with row id + queue.

---

## Finding #73: Scheduler `withSchedulerTimezone` is forwarded as `tz` to BullMQ but BullMQ's tz handling has known DST edge cases for cron patterns near midnight

**Severity:** Low
**Category:** Stability
**File:** `src/infrastructure/queue/scheduler.ts`

**Issue:** A cron `0 4 * * *` interpreted in `America/Los_Angeles` will skip one occurrence on spring-forward and run twice on fall-back if BullMQ uses naive timezone math. Worth a sanity check.

**Recommended Fix:** Document expected DST behavior; consider UTC for all crons.

---

# Section 5 — Code Quality & Maintainability

## Finding #74: `as unknown as Record<string, unknown>` cast in Stripe handler — loses type-safety on Stripe SDK shape changes

**Severity:** High
**Category:** Maintainability
**File:** `src/domains/billing/sub-domains/stripe-webhook/stripe-webhook.service.ts`

**Issue:**
```ts
const rawSubscription = stripeSubscription as unknown as Record<string, unknown>;
const periodStart =
  typeof rawSubscription.current_period_start === 'number'
    ? new Date(rawSubscription.current_period_start * 1000)
    : new Date();
```
The cast is needed because Stripe SDK types moved `current_period_start` into `items.data[0]` in recent API versions. The fallback to `new Date()` silently masks the type change (see Finding #7).

**Impact:** When the cast no longer matches Stripe's actual response shape, every event records `new Date()` for period start.

**Recommended Fix:** Pin `apiVersion` (Finding #7), use the typed Stripe SDK shape, and FAIL the event (throw + retry) when fields are missing rather than substituting `new Date()`.

**Safer Code Example:**
```ts
const item = stripeSubscription.items.data[0];
if (!item?.current_period_start || !item?.current_period_end) {
  throw new Error(`stripe.webhook.malformed_subscription:${stripeSubscription.id}`);
}
const periodStart = new Date(item.current_period_start * 1000);
const periodEnd = new Date(item.current_period_end * 1000);
```

---

## Finding #75: `JWT_SECRET` env var deprecated but still in schema — confusing template surface

**Severity:** Low
**Category:** Maintainability
**File:** `src/shared/config/env-schema.ts`

**Issue:** `JWT_SECRET: z.string().min(32).optional()` with a doc comment "Deprecated: unused at runtime (RS256 only)". Keeps deploy templates valid but invites confusion.

**Recommended Fix:** Add a startup warning when `JWT_SECRET` is set in any env. Plan removal at the next major version bump.

---

## Finding #76: Cross-domain singleton — `configureAuthorization` module state

**Severity:** Medium
**Category:** Maintainability
**File:** `src/domains/tenancy/sub-domains/permission/authorization.service.ts`

**Issue:** `permissionRepository` is a module-level mutable singleton. The class `AuthorizationService` re-assigns it. Tests must `configureAuthorization` before any preHandler runs. The pattern is documented but fragile — easy to leak between tests.

**Recommended Fix:** Refactor `resolveUserOrganizationPermissions` to require an explicit `AuthorizationService` parameter; deprecate the module-level singleton.

---

## Finding #77: `mcp-server` `as Parameters<McpServerInstance['connect']>[0]` cast — fragile when SDK types change

**Severity:** Low
**Category:** Maintainability
**File:** `src/infrastructure/mcp/mcp-server.ts`

**Issue:** Type assertion on transport assignment. SDK is an optional dependency loaded by `import()`; cast is unavoidable but fragile.

**Recommended Fix:** Add a runtime sanity check (`if (typeof transport.handleRequest !== 'function') throw`).

---

## Finding #78: `request as { rawBody?: Buffer }` cast in app.ts content-type parser — type augmentation should live in app.d.ts

**Severity:** Low
**Category:** Maintainability
**File:** `src/app.ts`

**Issue:** Ad-hoc cast for `rawBody`. Should be declared in module augmentation.

**Recommended Fix:** Declare `interface FastifyRequest { rawBody?: Buffer; stripeWebhookEvent?: Stripe.Event; }` in `app.d.ts`.

---

## Finding #79: Magic-link service uses `await import('@/shared/utils/security/password.util.js')` inline for rehash — dynamic import on a hot path

**Severity:** Low
**Category:** Maintainability/Performance
**File:** `src/domains/auth/auth.service.ts:118-121`

**Issue:** Lazy import to break a circular dependency. Adds ~ms on first login post-deploy; subsequent imports are cached.

**Recommended Fix:** Refactor to remove the circular dependency so the import can be top-of-file.

---

## Finding #80: `validateUploadPublicIdParam` exists but is called inside controllers, not in route schema — duplicates validation across all upload routes

**Severity:** Low
**Category:** Maintainability
**File:** `src/domains/upload/upload.controller.ts`

**Issue:** Same as Finding #34 — the validator could be declarative on the route schema.

---

## Finding #81: `JWT_SIGNING_KID` defaults to `'default'` — a deployed instance using this default in production indicates no rotation strategy

**Severity:** Low
**Category:** Maintainability
**File:** `src/shared/config/env-schema.ts:96`

**Issue:** Allows running without setting kid (single-key rotation-disabled mode). Deploy templates should override to a meaningful kid (e.g. `prod-2026-q2`).

**Recommended Fix:** Validate `JWT_SIGNING_KID !== 'default'` in production via env-schema refine.

---

## Finding #82: `worker.ts` mutates `process.env.CORE_BE_RUNTIME = 'worker'` to gate `worker-database.context` — global mutation pattern

**Severity:** Low
**Category:** Maintainability
**File:** `src/worker.ts`, `src/infrastructure/database/contexts/worker-database.context.ts`

**Issue:** Module side effect on import.

**Recommended Fix:** Pass runtime kind via DI parameter at context boundary, not via env.

---

## Finding #83: Many places use raw `omitUndefined({ x: optional })` — fine but obscures TypeScript optionality

**Severity:** Low
**Category:** Maintainability
**File:** Pervasive (e.g. `auth.middleware.ts:40-44`, `idempotency.middleware.ts:164-168`).

**Issue:** `omitUndefined` is needed because of `exactOptionalPropertyTypes: true`. Wrapping every assignment in this util is verbose.

**Recommended Fix:** Document the pattern in CLAUDE.md; consider a Biome lint rule that flags object literals with `undefined` values.

---

## Finding #84: `applicationLifecycle.util.isApplicationDraining` (used in health checks) — singleton state not visible to test runners

**Severity:** Low
**Category:** Maintainability
**File:** `src/shared/utils/infrastructure/application-lifecycle.util.ts`

**Issue:** Module-level boolean. Tests must reset between cases.

**Recommended Fix:** Already a known pattern. Document the test-reset helper.

---

## Finding #85: `field-secret-encryption` supports v1/v2 keys but `SECRETS_ENCRYPTION_CURRENT_VERSION` defaults to `v1` — rotation requires an explicit env change

**Severity:** Low
**Category:** Maintainability
**File:** `src/shared/utils/security/field-secret-encryption.util.ts`, `src/shared/config/env-schema.ts:431-436`

**Issue:** Rotation procedure documented in admin script (`rotate-field-secrets.ts`) but easy to forget to set the env var post-rotation.

**Recommended Fix:** Emit a startup info log of the current write key version (no key material).

---

# Appendix A — Areas examined where no findings were raised

These areas were read and reviewed but did not yield findings beyond what is in the report; flagging here so reviewers can confirm coverage:

- Password hashing (`src/shared/utils/security/password.util.ts`) — Argon2id with OWASP 2024 parameters and dummy-hash timing equalization. Sound.
- CSRF double-submit (`src/shared/middlewares/session/cookie-session-origin.pre-handler.ts`) — timing-safe compare, see Finding #10 for non-prod Referer fallback.
- Permission cache stampede + invalidation (`permission-cache.service.ts`) — Lua compare-and-set, nonce-based release, INCR-based org-wide bump. Excellent design.
- DNS pinning + RFC 1918 + IPv4-mapped IPv6 rejection (`webhook-url.util.ts`) — uses `ipaddr.js` and normalizes mapped addresses correctly.
- Magic-link service anti-enumeration (`enforceMinimumDuration`) and atomic `consumeIfValid` token consumption.
- Auth-session refresh-token reuse detection with family revocation (RFC 9700) — correct implementation.
- MFA TOTP replay protection via Redis `SET NX` with `MFA_TOTP_CODE_REPLAY_TTL_SECONDS`.
- Field-secret encryption (v1/v2 prefix, AES-256-GCM, 64-hex key validation).
- Upload service: presigned POST with content-length-range, pending-key + final-key copy to prevent presigned-URL overwrite of confirmed objects, advisory-lock quota.
- SVG sanitization with DOMPurify (see Finding #19 for `svgFilters` profile).
- Rate-limit middleware: keyed on `request.ip` only (with documented rationale), fallback in-process store on Redis failure (correct trade-off).
- Sentry redaction: `redactSentryEvent` covers breadcrumbs, request, extras, contexts.
- Pino logger: redact paths + recursive value scrubbing via `redactSensitive`.
- Stripe webhook ingress: raw-body preservation only on the registered webhook paths, with `Stripe.constructEvent` enforcing signature + clock skew.
- DLQ persistence to both Postgres (durable) and Redis (replay).
- Idempotency middleware: fingerprint mismatch returns 422, in-flight returns 409, 4xx/5xx never cache.
- Database connection: SSL with `rejectUnauthorized` config, per-connection statement timeout, idle-in-transaction timeout.
- Worker queue family separation (mail, notify, webhook, stripe, retention, observability) with per-family connection budget.
- Tombstone retention FK-safe order (uploads → orgs → child tombstones → users).
- Scheduler timezone forwarding (`tz` to BullMQ).
- Trust-proxy schema: integer hop-count required (no bare `true`).
- `ALLOWED_ORIGINS` `*` rejection and prod-https-only enforcement.
- `COOKIE_SECURE=true` mandatory in production.
- `SECRETS_ENCRYPTION_KEY` entropy check (≥ 8 distinct hex digits).
- Captcha middleware: fail-closed in production, fail-open in dev/test.
- Stripe client: timeout + retries + circuit breaker via `outboundCall`.

---

# Appendix B — Top-10 remediation priority (concise)

| # | Finding | Why now |
| --- | --- | --- |
| 1 | **#1** `requireOrganizationPermission` fallback to `params.id` | Critical auth bypass surface; one-line fix. |
| 2 | **#2** JWT keyring silent fallback on unknown `kid` | Critical rotation contract violation; one-function fix. |
| 3 | **#3** MCP `call_api` header forwarding | High admin impersonation surface. |
| 4 | **#5** Plan endpoints unauthenticated vs docs claim auth | High — fix the docs or add auth. |
| 5 | **#7** Stripe `apiVersion` not pinned | High — silent breakage on Stripe rollouts. |
| 6 | **#8** Webhook allowlist subdomain takeover | High SSRF. |
| 7 | **#30** Connection budget can exceed Postgres max | Deploy-day outage risk. |
| 8 | **#37** Partial fanout failures silently logged | Webhook delivery losses. |
| 9 | **#46** Permission cache lock TTL ≥ cache TTL | Stampede holds lock for cache lifetime. |
| 10 | **#74** Stripe handler `as unknown as Record<string, unknown>` cast | Tied to #7 — fix together. |

---

# Appendix C — Auditor notes

- Findings #46 (permission cache lock TTL) requires inspecting the constant value of `PERMISSION_CACHE_RECOMPUTE_LOCK_TTL_SECONDS` (not opened in this audit). If it's ≤ a few seconds, downgrade to Medium.
- Finding #66 (notification.worker idempotency) was flagged because the worker file was not opened in detail; verify by reading `src/domains/notify/sub-domains/notification/workers/notification.worker.ts`.
- Findings #14, #28 (API key prefix length) — the constant `ORGANIZATION_API_KEY_PREFIX_DISPLAY_LENGTH` was not opened; if ≥ 16, downgrade.
- All Critical and High findings include a representative file/line citation; reviewers should open the cited line, confirm the quote, and either land a fix or open a tracking issue.

— End of report —
