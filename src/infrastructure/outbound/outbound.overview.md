`src/infrastructure/outbound/`

# Outbound HTTP infrastructure

## Purpose

Shared primitives for outbound HTTP calls — fetch wrappers with timeout, header normalisation, request-id propagation, and error class mapping. Used by every outbound integration (customer webhooks today; future external integrations as they're added).

## Design decisions

- **Standard global `fetch`** over `axios` / `node-fetch`: native, no dependency cost, abortable via `AbortSignal`.
- **Request-id propagation**: every outbound call attaches the originating `X-Request-Id` so customer logs can be correlated with our audit log.
- **Strict timeout via `AbortController`**: every call is bounded; the Node `fetch` default (no timeout) is never relied on.
- **Error class mapping**: aborts (timeout) → `OutboundTimeoutError`; non-2xx → `OutboundResponseError` with status, body excerpt, latency. The error handler / Sentry tagging operate on these classes.
- **Body-size guard**: response bodies are buffered up to a cap (configurable per call site); excess is truncated with a metadata note. Important for customer webhook responses, which we log.

## Operational concerns

- **Per-attempt timeout** is the call-site's responsibility; this module exposes the helper and an opinionated default.
- **TLS validation**: enabled by default. Self-signed customer endpoints fail; documented in customer onboarding.
- **Response header truncation**: customer endpoints sometimes return large `Set-Cookie` chains; we truncate to a fixed byte cap before logging.

## External dependencies

- Node global `fetch` only.

## Failure modes

- **Customer DNS failure** → `OutboundResponseError` with no status; logged as `dns-error` class.
- **TLS handshake failure** → `OutboundResponseError` with no status; logged as `tls-error` class.
- **Customer endpoint returns a redirect chain** → not followed (intentional; customers should provide a final URL).
- **Customer endpoint returns a body larger than the cap** → truncated; the attempt log records the truncation.
