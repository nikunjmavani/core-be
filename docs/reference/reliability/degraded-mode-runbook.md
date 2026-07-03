# Degraded-mode runbook

How the API behaves when a runtime dependency (Redis, Cloudflare Turnstile) degrades, what
signals to alert on, and the operator response. These are deliberate **security-over-availability**
choices: the affected paths fail **closed** rather than silently dropping a safety guarantee.

See also: [external-service-resilience.md](external-service-resilience.md),
[observability-log-events.md](observability-log-events.md),
[../runtime/internationalization.md](../runtime/internationalization.md).

## Redis down → required-idempotency writes return `503`

**Behavior.** The idempotency middleware (`src/shared/middlewares/core/idempotency.middleware.ts`)
needs Redis to guarantee at-most-once execution. When Redis is unavailable it **fails closed**: the
write handler does not run and the request gets `503` with a `Retry-After` header and
`{ error: { code: 'service_unavailable', retryable: true } }`. Routes that require an
`X-Idempotency-Key` are therefore unavailable for writes during a Redis outage; idempotent retries by
well-behaved clients succeed once Redis recovers. (Reads, and writes without an idempotency key, are
unaffected by this gate.)

Rate limiting degrades **gracefully** instead — the limiter falls back to a per-process in-memory
counter (`rate-limit-fallback-store.ts`), so the cluster-wide cap loosens to `max × instances` but
the API stays metered. The permission cache degrades to a direct DB lookup.

**Signals.**

- Log: `idempotency.cache.unavailable` (warn) — one per failed claim.
- Sentry: `idempotency.cache.unavailable` (error) — throttled to one event / 30s while degraded.
- Log: `rate_limit.redis_failover.local` (warn) — limiter running per-process.

**Operator response.** Restore Redis (managed-service failover / connectivity). No app change is
needed; the 503s clear automatically. Do **not** disable the idempotency gate to restore
availability — that reintroduces double-execution risk for writes.

## Cloudflare Turnstile down → captcha-gated auth fails closed

**Behavior.** In production the captcha pre-handler
(`src/shared/middlewares/security/captcha.middleware.ts`) fails **closed**: if Turnstile cannot be
reached (including when the per-provider circuit breaker is open) the request is rejected with `401
captchaProviderUnavailable`. Captcha-gated routes — login, email verification-code, password-reset
request — are therefore unavailable during a Turnstile outage. Fail-open is intentionally **not**
available in production (it would invite credential stuffing during the outage); the bypass header is
honored only in non-production.

**Signals.**

- Sentry: `captcha.provider_unavailable` (error) — throttled to one event / 30s; `extra.reason` is
  `breaker_open`, `verify_error`, or `not_configured`.
- A spike of `401` on public auth routes with `errors:captchaProviderUnavailable`.

**Operator response.** Confirm the Turnstile outage (Cloudflare status) vs. a local
misconfiguration (`reason: not_configured` means `CAPTCHA_SECRET` is unset/`CAPTCHA_PROVIDER` is not
`turnstile` in a production deploy — fix the env, do not ship a fail-open). For a confirmed
third-party outage, communicate the auth degradation; recovery is automatic when Turnstile returns
and the circuit breaker closes.

## Quick reference

| Dependency down | Affected surface | Mode | Primary alert |
| --- | --- | --- | --- |
| Redis | writes that require `X-Idempotency-Key` | fail closed (`503` retryable) | `idempotency.cache.unavailable` (Sentry) |
| Redis | global + per-route rate limits | graceful (per-process counter) | `rate_limit.redis_failover.local` (log) |
| Turnstile | captcha-gated auth routes | fail closed (`401`) | `captcha.provider_unavailable` (Sentry) |
