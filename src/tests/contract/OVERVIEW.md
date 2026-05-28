`src/tests/contract/`

# Contract tests

## Purpose

Outbound HTTP contract tests for the platform's third-party integrations: Stripe (subscription, customer, webhook), Resend (mail), S3 (presigned URLs), and customer webhook endpoints. Uses `nock` to record / replay fixture interactions and pin our request shape against the upstream's documented API.

Vitest config: [tooling/vitest/contract.config.ts](tooling/vitest/contract.config.ts).

What this suite covers:

- Request shape matches upstream API expectations (path, method, headers, body fields).
- Response parsing matches our types (we don't ignore an unexpected field that becomes mandatory).
- Idempotency-Key forwarding to Stripe.
- Webhook signature verification on inbound (Stripe).
- Request-id forwarding on outbound customer webhooks.

What it does **not** cover: real network calls (those are in integration tests with mocks), latency (load suite), or business logic (domain suites).

## Test types

- **Per-upstream contract** — one file per provider with all the request shapes pinned.

## How to run

```bash
pnpm test:contract
```

No Postgres / Redis / network required — `nock` intercepts every outbound request.

## Fixtures and helpers

- `fixtures/` — recorded HTTP request / response pairs.
- `contract-vitest-setup.ts` — registers `nock` activations + assertions per file.

## Dependencies

- **None** — fully offline. Runs in the CI quality slice.

## Failure modes

- **Stripe SDK upgrade changes the request shape** → contract test flags the diff; review whether the change is intended (then update the fixture) or a bug in our code.
- **Customer webhook handler emits a payload that doesn't pin** → the test will report which field changed; usually a serializer regression.

## Related docs

- [docs/reference/testing/contract-tests.md](docs/reference/testing/contract-tests.md)
