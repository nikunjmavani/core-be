`src/infrastructure/resilience/`

# Resilience infrastructure

## Purpose

Cross-cutting reliability primitives that don't belong to any single domain: circuit-breaker factories (`opossum`), retry-with-jitter helpers, and the timeout wrappers used by outbound HTTP clients (Stripe, Resend, customer webhooks). Components opt in by wrapping the call site with one of these helpers.

## Design decisions

- **`opossum` over hand-rolled circuit breakers**: we get half-open / closed transitions, error-class-aware thresholds, and Sentry-friendly stats events for free.
- **Per-upstream breaker instance**: each upstream (Stripe, Resend, customer webhook URL) has its own breaker. A failure cluster on one upstream does not open a breaker on the others.
- **Jitter on retry**: pure exponential backoff produces synchronized retry storms after a brief upstream outage. We add randomized jitter on every retry to break the herd.
- **Timeouts are explicit, never inherited**: every outbound call has its own timeout configured at the call site. The Node fetch default (no timeout) is never relied on.
- **Circuit breaker stats → Sentry**: the breaker emits open / half-open / close events; the Sentry transport tags them so we can correlate with the upstream's status.

## Operational concerns

- **Threshold tuning**: open / close thresholds are upstream-dependent. Stripe is sensitive to bursts; customer webhooks tolerate more failures before opening.
- **Half-open probe rate**: low (default opossum value) so we don't flood a recovering upstream.
- **Open-breaker error class**: `CircuitBreakerOpenError`, mapped to 502 by the error handler.

## External dependencies

- **`opossum`** — circuit breaker library.

## Failure modes

- **Breaker open** → calls fail-fast with `CircuitBreakerOpenError`; controllers return 502.
- **Breaker half-open and probe fails** → reopens immediately.
- **Per-upstream breaker not configured** → call falls through with no protection; should be considered a missing instrumentation, caught in code review.
