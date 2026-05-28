`src/infrastructure/observability/`

# Observability infrastructure

## Purpose

The platform's instrumentation surface: Sentry (errors, traces, profiling, structured logs), idempotency-cardinality monitoring (bounded SCAN to detect Redis-key leaks), and the DLQ-depth + DB-pool alerting workers. This module owns the wiring; individual domains and infrastructure modules consume it through `Sentry.captureException()`, `logger.*`, etc.

## Design decisions

- **Sentry over alternatives**: chosen for the integrated error + tracing + profiling story, the breadcrumb model, and the seamless V8 CpuProfiler integration. Continuous profiling lets us find regressions without enabling profiling per-incident.
- **Structured logging via Pino + Sentry**: Pino emits JSON logs to stdout (collected by Railway / the cloud provider); Sentry receives a structured copy of `error`-level entries via the Sentry transport.
- **Idempotency cardinality sampling**: a bounded `SCAN` on the `idempotency:*` Redis keyspace runs on a schedule, logs the cardinality, and fires Sentry when a threshold is crossed. The point is to detect the "leak" failure mode where a bug strands keys past their TTL.
- **DLQ depth alerts**: the [dlq-depth/](src/infrastructure/observability/dlq-depth/) worker polls every queue's DLQ count and emits Sentry warnings when depth exceeds a threshold, so on-call sees the queue health independently of any single failed job.
- **DB pool alerting**: similar pattern for Postgres pool waiters — a long-running pool wait is a leading indicator of a transaction holding a connection across a remote round trip (see `billing` invariant about Stripe calls outside RLS contexts).

## Operational concerns

- **PII redaction**: the Sentry `beforeSend` hook strips emails, IP addresses, and tokens from breadcrumbs and event tags. The redaction list lives in [sentry.ts](src/infrastructure/observability/sentry.ts).
- **Sample rate**: `SENTRY_TRACES_SAMPLE_RATE` controls trace sampling; we run at 1.0 in dev and a tunable rate in prod.
- **Profile cadence**: continuous profiling runs in 60 s windows; Sentry merges them into the project's profile timeline.

## External dependencies

- **Sentry** — error / trace / profile / log destination.

## Failure modes

- **Sentry unavailable** → SDK queues events in memory up to a cap; events drop after the cap (logged at warn). Application path is not blocked.
- **Pino transport blocks on stdout** (very rare, container-level pipe full) → the worker pool can stall; mitigated by the cloud provider's log forwarding.
- **Idempotency-cardinality SCAN is bounded** so it cannot trigger Redis CPU pressure, but a cluster of large mismatches will produce alerts.
