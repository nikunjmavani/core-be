# Deep Security, Reliability, and Scalability Audit — 2026-06-03

**Codebase:** `core-be` (Fastify 5 / TypeScript / Drizzle / BullMQ)
**Auditor:** Claude Sonnet 4.6 (claude-sonnet-4-6)
**Audit date:** 2026-06-03
**Files in scope:** 1,394 TypeScript source files
**Recent HEAD:** `15bc55a` (perf: parallelize S3 object deletes in deleteAllExportsForUser)

---

## How to Read This Report

Findings are numbered globally (#1 upward) in order of severity within each section. Each finding includes:

- **Severity:** Critical / High / Medium / Low / Informational
- **File(s) with line references**
- **Evidence** (quoted code or log output)
- **Impact**
- **Recommendation**

Items the team already remediated before this audit are listed in a **Remediated** subsection at the end of each section — they are confirmed fixed and are not counted in the open findings.

---

## Section 1 — REST API Security

### Open Findings

---

**#1 — Medium — Webhook `events` array is unbounded**

**File:** `src/domains/notify/sub-domains/webhook/webhook.dto.ts`, lines 34 and 48

**Evidence:**
```typescript
// CreateWebhookDto
events: z.array(trimmedString().max(100)).min(1),  // no .max() on the array

// UpdateWebhookDto
events: z.array(trimmedString().max(100)).min(1).optional(),  // same omission
```

**Impact:** A single authenticated POST to `POST /api/v1/organizations/:id/webhooks` with an `events` array containing tens of thousands of 100-character strings passes schema validation, reaches the service, and triggers an INSERT with the full array stored in the DB column. The 1 MB Fastify body limit (`bodyLimit: 1_048_576` in `fastify-server.util.ts`) constrains maximum payload size to approximately 10,000 entries at full element length, which is still sufficient to produce oversized rows, stress the DB write path, and inflate notification fan-out work in the `webhook-delivery` worker.

**Recommendation:** Add `.max(50)` on the `events` array in both `CreateWebhookDto` and `UpdateWebhookDto`. The `organization-api-key` DTO already sets `.max(50)` on its `scopes` array and is the correct pattern to follow.

---

**#2 — Low — `user-notification-preferences` array is unbounded**

**File:** `src/domains/user/sub-domains/user-notification-preferences/user-notification-preferences.dto.ts`, line 12

**Evidence:**
```typescript
preferences: z.array(
  z.object({
    notification_type: trimmedString().max(50),
    channel: z.enum(NOTIFICATION_CHANNELS),
    organization_id: z.number().nullable().optional(),
    is_enabled: z.boolean(),
  }).strict(),
),
```

The outer `z.array(...)` has no `.max()` constraint.

**Impact:** `PUT /api/v1/users/me/notification-preferences` uses replace-all semantics: the service deletes all rows for the user and re-inserts the submitted list. A large array forces a full-table delete followed by a bulk insert inside a user-scoped transaction, creating disproportionate write amplification per request.

**Recommendation:** Add `.max(200)` on the `preferences` array (200 covers all realistic combinations of notification types × channels × organizations for a single user).

---

**#3 — Low — `PUT /organizations/:id/roles/:roleId/permissions` permission array is unbounded**

**File:** `src/domains/tenancy/sub-domains/member-roles/member-role-permission/member-role-permission.dto.ts`, line 11

**Evidence:**
```typescript
permission_codes: z.array(trimmedStringMinMax(1, 100)).min(0),
```

No `.max()` on the array.

**Impact:** The PUT endpoint replaces the entire permission set for a role in a single transaction. A large array (up to the body limit) would bulk-insert rows into `member_role_permissions`, trigger an `invalidateOrganizationPermissions` INCR, and orphan many old cache keys. The permission set for a role is bounded by the total number of defined permissions in the system, which is a small, finite set — an upper limit of 200 is generous and still safe.

**Recommendation:** Add `.max(200)` on the `permission_codes` array.

---

**#4 — Low — `preferred_locales` user-settings array is unbounded**

**File:** `src/domains/user/sub-domains/user-settings/user-settings.dto.ts`, line 14

**Evidence:**
```typescript
preferred_locales: z.array(trimmedString().max(10)).optional(),
```

No `.max()` on the array.

**Impact:** Low severity because locale tags are short (10 chars max per element), but a large array still inflates the stored JSONB column and validation-step runtime. A limit of 10 covers all realistic locale stacks.

**Recommendation:** Add `.max(10)` on `preferred_locales`.

---

**#5 — Low — Email templates inject server-controlled URLs without explicit HTML escaping**

**Files:**
- `src/infrastructure/mail/templates/invitation.template.ts`, line 37 (`href="${data.acceptUrl}"`) and line 39 (`${data.acceptUrl}`)
- `src/infrastructure/mail/templates/magic-link.template.ts`, line 15 (`href="${data.magicLinkUrl}"`) and line 21 (`${data.magicLinkUrl}`)

**Evidence (invitation.template.ts, abbreviated):**
```typescript
<a href="${data.acceptUrl}" class="button">Accept Invitation</a>
...
${data.acceptUrl}
```

**Impact:** Both URLs are generated from server-side cryptographic tokens (`generateMagicLinkUrl`, `generateInvitationAcceptUrl`) so they contain no attacker-controlled input today. The risk is defense-in-depth: if a future code path constructs these URLs from partially-external input (e.g., a misconfigured frontend base URL read from the database), injected characters (`"`, `>`, `javascript:`) could break the `href` attribute or introduce XSS in email clients that render HTML without sandboxing. The `base.template.ts` JSDoc explicitly states that string interpolation is "plain text" and pushes the escaping responsibility to callers — but callers do not currently perform it.

**Recommendation:** Wrap URL values with a lightweight HTML-attribute encoder before injection: at minimum encode `&`, `<`, `>`, `"` characters. A small helper `escapeHtmlAttr(url: string)` would cost near-zero and close the defense-in-depth gap permanently. The `inviterName` and `organizationName` fields already set the correct precedent in the same templates.

---

**#6 — Low — Stripe webhook replay tolerance uses SDK default (300 seconds)**

**File:** `src/infrastructure/payment/stripe.client.ts`, line 323

**Evidence:**
```typescript
return stripe.webhooks.constructEvent(body, signature, webhookSecret);
// No explicit tolerance argument; SDK default is 300 s
```

**Impact:** A 5-minute tolerance window is larger than necessary for most deployment topologies. An event captured by a passive MITM and replayed within 300 seconds would pass signature verification. This is a known Stripe SDK default rather than a bug, but explicit tightening is straightforward. Stripe recommends 300 s for deployments where clock skew between origin and server may be large; for a well-NTP-synchronized deployment a 60–150 second window reduces replay exposure.

**Recommendation:** Pass an explicit `{ tolerance: 150 }` (or `{ tolerance: 60 }`) option to `stripe.webhooks.constructEvent` and document the chosen value. This does not affect the existing at-least-once idempotency mechanism in `StripeWebhookService` (which uses `tryClaimEvent`), but adds a first-line replay filter at the transport layer.

---

**#7 — Informational — MCP `call_api` tool carries no per-request rate limit**

**File:** `src/infrastructure/mcp/mcp-server.ts`, `src/app.ts` (registration at line 96)

**Impact:** The `/api/v1/mcp` POST endpoint sits behind `app.authenticate` + `requireRole(SUPER_ADMIN, ADMIN)` and is subject to the global IP-level rate limiter (`RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_MS`, default 100 req/min). However, a single MCP POST can invoke the `call_api` tool multiple times (one tool call per JSON-RPC request, but a session may batch). There is no per-user or per-call throttle specifically on the MCP endpoint. Because only global admins can reach this endpoint, the practical exploitation surface is narrow. The per-authenticated-user presets (`STRICT_AUTHED_RATE_LIMIT`, `ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT`) are not applied here.

**Recommendation:** Apply `STRICT_AUTHED_RATE_LIMIT` (10 req/60s per user) to the `/api/v1/mcp` Fastify scope during registration in `registerMcpRoute`. Admin-only tools should still be bounded by user identity, not just IP.

---

### Remediated

The following issues were identified, resolved, and confirmed fixed before this audit date:

- **Stripe `event.data.object` unsafe casts removed.** The `handleSubscriptionUpdated` / `handleSubscriptionDeleted` handlers previously cast `event.data.object` as `Stripe.Subscription` without type narrowing. Fixed in commit `f8f9cfe` by introducing a discriminated-union type guard (`isStripeSubscriptionEvent`). `current_period_start` and `current_period_end` are now read from `items.data[0]`, which is the correct per-price period source.

- **`DATABASE_HTTP_STATEMENT_TIMEOUT_MS` env validation added.** Previously unvalidated. Fixed in `47bdab4`: the Zod schema now validates this field and asserts it is smaller than `PERMISSION_CACHE_RECOMPUTE_LOCK_TTL_SECONDS` to prevent runaway queries from silently exceeding the recompute lock window.

- **Webhook allowlist subdomain matching tightened.** Explicit `*.` prefix required; bare domain entries no longer inadvertently cover subdomains. Fixed in commit `8d79c89` (`fix(security): require explicit wildcard prefix for webhook allowlist subdomain matching`).

- **JWT `kid` unknown to active keyring now hard-rejects.** Tokens signed with a retired key whose `kid` is absent from `JWT_PUBLIC_KEYS` are rejected rather than falling back to the legacy single-key path. Fixed in `2bedfa1`.

- **MCP `call_api` blocked headers list expanded.** `x-forwarded-for`, `x-real-ip`, and `x-csrf-token` are stripped from injected sub-requests to prevent IP spoofing and CSRF token injection. Unversioned `/mcp` aliases removed. Fixed in `cdaf9ce`.

- **API-key rotation made atomic.** The `softDelete` step now uses `WHERE deleted_at IS NULL` so concurrent rotations yield a `ConflictError` rather than minting duplicate replacement keys.

---

## Section 2 — API Stability and Robustness

### Open Findings

---

**#8 — Medium — WebAuthn service uses `as unknown as` casts on library response types**

**File:** `src/domains/auth/sub-domains/auth-webauthn/webauthn.service.ts`, lines 167 and 302

**Evidence:**
```typescript
// line 167 (registration)
parsed.response as unknown as RegistrationResponseJSON

// line 302 (authentication)
parsed.response as unknown as AuthenticationResponseJSON
```

**Impact:** `as unknown as T` bypasses the TypeScript type checker for the bridge between the raw Zod-parsed input and the `@simplewebauthn/server` library types. If the `@simplewebauthn` library changes the shape of `RegistrationResponseJSON` or `AuthenticationResponseJSON` in a minor-version bump, the mismatch will be invisible at compile time and will surface as a runtime failure or silent data corruption during WebAuthn ceremonies. WebAuthn registration and authentication are security-critical operations.

**Recommendation:** Define a Zod schema that mirrors the exact shape of `RegistrationResponseJSON` / `AuthenticationResponseJSON` from `@simplewebauthn/types` and use `z.parse()` to produce a correctly-typed value. Alternatively, use `satisfies RegistrationResponseJSON` (a non-widening assertion) to catch structural divergence at compile time.

---

**#9 — Low — `buildExportPayload` holds no DB connection but allocates all user data in a single in-process object**

**File:** `src/domains/user/sub-domains/user-data-export/workers/user-data-export.processor.ts`, line 69

**Evidence:**
```typescript
const payload = await userDataExportService.buildExportPayload(userPublicId);
const jsonBody = JSON.stringify(payload);
const compressedBody = await gzipBufferAsync(Buffer.from(jsonBody, 'utf8'));
```

**Impact:** The full GDPR export bundle is assembled as a single in-memory object, serialized to JSON string, and then gzip-compressed — all in Node.js heap before the S3 upload begins. For a user with a long history (many sessions, notifications, audit events), this object can be several megabytes of heap. On a worker running many concurrent export jobs the aggregate heap pressure may trigger GC pauses. The RSS monitor in `bootstrap.ts` warns at 512 MB, but there is no per-export memory cap.

**Note:** This is an architectural consideration rather than a critical bug. The processor already correctly avoids holding a Postgres connection during gzip/S3 (`withUserDatabaseContext` is released before `buildExportPayload`). The concern is purely heap size.

**Recommendation:** Consider streaming the export payload through a Transform pipeline that serializes and gzip-compresses JSON incrementally, then pipes to an S3 multipart upload. This would decouple export job memory cost from dataset size. As a lower-effort short-term mitigation, cap the per-section row counts in `buildExportPayload` (e.g., cap `sessions` at 500 rows, `audit_events` at 1000 rows) and include a `data_truncated` flag in the export bundle.

---

### Remediated

- **`WEBHOOK_DELIVERY_JOB_ATTEMPTS` exported from queue module.** Previously unexported, causing incomplete test mock factories. Fixed in `cd24515`.

- **Event-bus swallowed errors captured in Sentry.** Previously unhandled handler errors were logged but not forwarded to Sentry. Fixed in `8cd8107` — all `emit()` handler errors now call `Sentry.captureException`.

- **`requireOrganizationPermission` silent `params.id` fallback removed.** A fallback that silently read `request.params.id` when `X-Organization-Id` was absent allowed route handlers to inadvertently accept a path parameter as an org context. Fixed in `17f4d83`.

---

## Section 3 — Scalability and Performance

### Open Findings

---

**#10 — Informational — Permission-cache stampede waiter uses a busy-poll loop with `setTimeout`**

**File:** `src/domains/tenancy/sub-domains/permission/permission-cache.service.ts`, lines 221–229

**Evidence:**
```typescript
for (let attempt = 0; attempt < STAMPEDE_POLL_ATTEMPTS; attempt++) {
  await new Promise<void>((resolve) =>
    setTimeout(resolve, PERMISSION_CACHE_STAMPEDE_POLL_MS),
  );
  const waiterCached = await getCachedPermissions(userId, organizationId);
  if (waiterCached !== null) return waiterCached;
}
```

`STAMPEDE_POLL_ATTEMPTS = 40`, `PERMISSION_CACHE_STAMPEDE_POLL_MS` determines latency per poll (not shown here but small). If the lock holder dies mid-recompute, all 40 waiters run the full poll window (≈2s total) before falling through to their own uncached recompute. This means a node crash can add ~2s to a burst of permission-check latencies simultaneously.

**Impact:** Informational. The fallback to uncached recompute prevents correctness problems and the Lua compare-and-delete lock release in the `finally` block handles clean exits. The poll loop is a safe, acceptable pattern for stampede protection. The main observation is that the fallback path does not cache its result (it correctly skips caching because it does not own the lock), meaning a second wave of requests may still hit the database.

**Recommendation:** No urgent change required. If permission-check latency becomes a production concern under node-failure scenarios, a Redis Pub/Sub "recompute done" notification could replace the poll loop. Acceptable as-is.

---

**#11 — Informational — Default Postgres pool size (10) may be undersized for high-concurrency HTTP + monolithic worker deployments**

**File:** `src/infrastructure/database/pool/pool.constants.ts`, line 9

**Evidence:**
```typescript
export const DEFAULT_DATABASE_POOL_MAX = 10;
```

**Impact:** The startup assertion in `bootstrap.ts` correctly fails when `computeWorkerPostgresPoolDemand` determines that the sum of worker concurrencies exceeds `DATABASE_POOL_MAX`. For the API process, however, there is no corresponding startup check that the pool is sized for peak HTTP concurrency. At 10 connections with a typical RLS transaction duration of 5–20ms, the pool supports ~500–2000 req/s at saturation — adequate for moderate traffic but tight for spiky workloads. The `getActiveOrganizationRlsCheckoutCount()` gauge and pool-exhaustion alerter (`database-pool-exhaustion.chaos.test.ts`) provide observability and a chaos regression test.

**Recommendation:** Document the expected concurrency profile and default pool sizing rationale in `pool.constants.ts`. Consider adding a startup log line for the API process similar to the worker bootstrap pool-demand report.

---

### Remediated

- **Sequential S3 deletes in `deleteAllExportsForUser` parallelized.** Fixed in `15bc55a` — `Promise.all` now fires all `storage.deleteObject` calls concurrently.

- **Worker startup fails when pool demand exceeds `DATABASE_POOL_MAX`.** Fixed in `faf2fab` — a startup-time assertion throws rather than allowing the worker to start with insufficient pool connections.

- **Redis `commandTimeout` added.** Prevents hung Redis commands from blocking the event loop indefinitely. Fixed in `8cd8107`.

---

## Section 4 — Workers, Queues, and Background Jobs

### Open Findings

There are no new open findings in this section. All material issues identified during the audit have been remediated.

### Remediated

- **DLQ auto-retry starvation fixed.** The previous DLQ implementation retried all jobs in FIFO order without a starvation guard, allowing high-volume failing jobs to starve low-volume jobs indefinitely. Fixed prior to this audit.

- **Event-bus errors captured in Sentry** (see Section 2 Remediated).

- **Webhook delivery worker holds no Postgres connection during outbound HTTP call.** The three-phase design (claim → deliver → record) correctly opens separate short transactions before and after the network call, preventing pool starvation during slow webhook targets. Confirmed correct by code review of `webhook-delivery.worker.ts`.

- **Notification worker email dispatch is idempotent across BullMQ retries.** A Redis-backed one-time claim marker (`claimNotificationEmailDispatch`) prevents duplicate email delivery when a job is retried after a crash between outbox insert and job completion. Confirmed correct.

- **Mail processor uses a stable Resend idempotency key.** The outbox `id` is used as the Resend idempotency key (`mail-outbox-{id}`), ensuring that retries of the same outbox row never produce duplicate emails on the Resend side. Confirmed correct.

- **Session refresh-token reuse detection revokes the entire session family.** `AuthSessionService.refreshSessionCredentials` implements RFC 9700-aligned reuse detection: a replayed (already-rotated) refresh secret triggers `revokeAllSessionsForReusedRefreshSecret`, not merely the targeted session. Confirmed correct.

- **TOTP replay within the validity window is blocked atomically.** `rejectReplayedTotpCode` uses Redis `SET NX` to atomically mark a freshly-verified code as consumed; a concurrent request with the same valid code cannot succeed. Confirmed correct.

---

## Section 5 — Code Quality and Maintainability

### Open Findings

---

**#12 — Low — WebAuthn `as unknown as` casts reduce type safety at a security boundary (cross-listed from #8)**

Already described in Section 2, #8. Listed here as a code quality issue as well because the pattern is unusual for a codebase that otherwise avoids type erasure on security-critical paths.

---

**#13 — Informational — `base.template.ts` escaping contract is implicit and push-to-callers**

**File:** `src/infrastructure/mail/templates/base.template.ts`

**Evidence:** The JSDoc states that `title`, `preheader`, and `footerText` parameters are "interpolated as plain text" — meaning callers are responsible for ensuring no HTML-injection characters are present. In practice all callers pass string literals, so this is not an active vulnerability. However, the contract is implicit and relies on code-review discipline rather than enforcement.

**Recommendation:** Encode `title`, `preheader`, and `footerText` using the same HTML escape helper recommended in finding #5. This makes the template self-defending for future callers.

---

### Remediated

No code-quality-specific remediations to note beyond those covered in Sections 1–4.

---

## Appendix A — Areas with No Open Findings

The following areas were inspected thoroughly and found to have no open findings:

| Area | Files Inspected | Status |
|---|---|---|
| JWT RS256 signing + keyring rotation | `jwt.util.ts`, `auth.middleware.ts` | No issues; unknown `kid` hard-rejects correctly |
| CSRF double-submit cookie | `cookie-session-origin.pre-handler.ts` | Correct `timingSafeEqual`; Referer fallback non-production only |
| CORS origin enforcement | `cors.middleware.ts` | Non-empty allowlist enforced; wildcard `*` disallowed in production |
| Error handler (no stack leakage) | `error-handler.middleware.ts` | Stack traces never sent to clients; 500+ errors → Sentry |
| Global + per-route rate limiting | `rate-limit.middleware.ts`, `rate-limit-presets.constants.ts` | IP-keyed global; org+actor-keyed per route; per-email keyed on auth routes; Redis fallback to in-process, not fail-open |
| Idempotency middleware | `idempotency.middleware.ts` | SETNX fingerprint; fails closed (503) on Redis error; never caches secrets |
| SSRF protection for outbound webhooks | `webhook-url.util.ts`, `webhook-outbound-fetch.util.ts` | DNS pinning; all private/link-local/multicast ranges blocked; IPv4-mapped IPv6 normalized; 64 KB response cap |
| SVG sanitization | `upload-svg.util.ts` | DOMPurify with `{ USE_PROFILES: { svg: true, svgFilters: true } }` |
| Magic-byte verification for uploads | `upload.service.ts` | Enforced on confirm, not just MIME type; matched against purpose config |
| CAPTCHA enforcement | `captcha.middleware.ts`, `env-schema.ts` | Bypass header blocked in production; env schema refine requires `turnstile` in production |
| Sensitive data redaction | `sensitive-redaction.util.ts` | Recursive, depth-capped, URL/query-string-aware; covers `email`, `token`, `cookie`, `jwt` fragments |
| Permission cache (Redis versioned INCR) | `permission-cache.service.ts` | O(1) org-wide invalidation; stampede lock with compare-and-set commit; lock released in `finally` |
| Health endpoints | `health.middleware.ts` | No version leakage; short-TTL cached probes; no DB connection per request |
| Cursor-based pagination | `pagination.util.ts` | Opaque base64url cursor; microsecond tie-breaking; strict schema |
| Trust-proxy startup assertion | `trust-proxy.util.ts` | Throws at startup in hosted environments when `TRUST_PROXY` is false |
| MCP auth gate | `mcp-server.ts` | `SUPER_ADMIN` or `ADMIN` role required; blocked headers list correct |
| Worker DB context rules | `worker-processor.util.ts` | No `getRequestDatabase()` in workers; correct `withOrganizationContext` / `withUserDatabaseContext` / `withGlobalRetentionCleanupDatabaseContext` usage |
| DLQ persistence and payload scrubbing | `dead-letter.ts` | Postgres-durable (30-day retention); payload summary extracts only non-secret identifiers |
| Stripe webhook ingress idempotency | `stripe-webhook.service.ts` | `tryClaimEvent` enforces at-least-once with lease window; `processed_duplicate` skips silently; `still_processing_within_lease` retries via `ConflictError` |

---

## Appendix B — Top-10 Remediation Cheat Sheet

Priority order (highest-value, lowest-effort first):

| # | Finding | File | Change |
|---|---|---|---|
| 1 | Webhook `events` array unbounded | `webhook.dto.ts` L34, L48 | Add `.max(50)` to both `events` arrays |
| 2 | Notification preferences array unbounded | `user-notification-preferences.dto.ts` L12 | Add `.max(200)` to `preferences` array |
| 3 | Permission codes array unbounded | `member-role-permission.dto.ts` L11 | Add `.max(200)` to `permission_codes` array |
| 4 | `preferred_locales` array unbounded | `user-settings.dto.ts` L14 | Add `.max(10)` to `preferred_locales` array |
| 5 | URL injection in email templates | `invitation.template.ts` L37/L39, `magic-link.template.ts` L15/L21 | Add `escapeHtmlAttr()` helper; apply to all URL interpolations |
| 6 | WebAuthn unsafe casts | `webauthn.service.ts` L167, L302 | Replace `as unknown as T` with Zod schema parse or `satisfies T` assertion |
| 7 | Stripe replay tolerance not explicit | `stripe.client.ts` L323 | Pass `{ tolerance: 150 }` to `constructEvent` |
| 8 | MCP endpoint lacks per-user rate limit | `mcp-server.ts`, `app.ts` L96 | Apply `STRICT_AUTHED_RATE_LIMIT` in `registerMcpRoute` |
| 9 | Email template base escaping implicit | `base.template.ts` | Encode `title`, `preheader`, `footerText` with same HTML escaper |
| 10 | Export payload fully in-process heap | `user-data-export.processor.ts` L69 | Add per-section row caps in `buildExportPayload`; document heap risk |
