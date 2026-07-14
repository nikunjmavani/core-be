# Contract tests (outbound integrations)

Offline HTTP contract checks for **Stripe**, **Resend**, and **S3** wrappers.

## Run

```bash
pnpm test:contract
```

Do **not** rely on real API keys: the script sets `CONTRACT_TESTS_ENABLED=true` and placeholder env (see `src/tests/setup.ts`).

## Design notes

- **nock** — Responses come from JSON under `fixtures/`; `register-contract-test-hooks.ts` disables outbound network during replay.
- **Stripe** — Production uses the default Node HTTP stack; contract runs swap in **`Stripe.createFetchHttpClient`** (see `src/infrastructure/payment/stripe.client.ts`) so mocks attach to **fetch**.
- **Form bodies** — Matchers must handle nock’s **parsed** urlencoded bodies (`helpers/stripe-form.ts`).

Reference: **`docs/reference/testing/contract-tests.md`**.
