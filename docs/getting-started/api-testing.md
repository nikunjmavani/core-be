# API testing (local, after full seed)

Manual and scripted checks against a running API (`pnpm dev` + `pnpm dev:worker`) with data from `pnpm db:seed:full`.

## Prerequisites

```bash
docker compose up -d
pnpm db:migrate
TEST_PASSWORD=DemoPassword123! pnpm db:seed:full   # fixed demo password
pnpm db:seed:sync-demo   # sync admin permissions (after permission changes)
pnpm dev              # terminal 1 — http://localhost:3000
pnpm dev:worker       # terminal 2
```

Set in `.env` for a repeatable password on every seed:

```bash
TEST_PASSWORD=DemoPassword123!
```

## Seeded credentials

| Field                  | Value                                               |
| ---------------------- | --------------------------------------------------- |
| Email                  | `demo@example.com`                                  |
| Password               | `DemoPassword123!` (or `TEST_PASSWORD` from `.env`) |
| Demo organization slug | `demo-org`                                          |
| Demo organization name | Demo Organization                                   |

After seed, note the resource ids from logs or fetch them via the flows below. Every id is prefixed by entity (`org_…`, `usr_…`, `pln_…`):

- Organization id: use `GET /api/v1/tenancy/organizations` (first item)
- User id: use `GET /api/v1/users/me`

Permissions, plans, demo org, admin role, membership, an extra org/user, and one pending invitation are created. See `src/scripts/seed/full.ts`.

## Headers (authenticated routes)

| Header              | Value                                           |
| ------------------- | ----------------------------------------------- |
| `Authorization`     | `Bearer <access_token>` from login              |
| `X-Organization-Id` | Organization id (`org_…`, see behavior below)   |
| `Content-Type`      | `application/json`                              |
| `Accept-Language`   | `en` or `es` (optional)                         |

### `X-Organization-Id` behavior

| Scenario                                                | Effect on `request.organizationId` / RLS                                                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Org-scoped route, valid header**                      | Set to the `org_<21 chars>` id; Postgres RLS session variable is set for the request. **Send this header on all org-scoped calls** for reliable tenant context.    |
| **Invalid format** (not `org_` + 21 `[a-z0-9]` chars)   | Header is **ignored**; organization context stays unset (may yield 403 or empty RLS scope — not a data leak to another tenant).                                    |
| **Header absent, URL contains `/organizations/{organization_id}/`** | Organization id is **inferred from the path** when it matches the `org_…` format.                                                                      |
| **Header and path both present but differ**             | **Header wins**; path id is not used for RLS.                                                                                                                      |
| **Neither valid header nor inferrable path id**         | Organization context unset; permission checks and RLS still apply per route.                                                                                       |

Route handlers also validate `{organization_id}`-style path params against the entity's `^org_[a-z0-9]{21}$` pattern (400 on malformed ids). Status policy reference: [response-codes.md](../reference/api/response-codes.md).

## Manual test checklist

### 1. Health (no auth)

| #   | Method | Path       | Expected                                                                                               |
| --- | ------ | ---------- | ------------------------------------------------------------------------------------------------------ |
| 1.1 | GET    | `/livez`   | 200, `{"status":"ok"}` (liveness — no dependency probes)                                               |
| 1.2 | GET    | `/readyz`  | 200, deps connected; optional `migration_version`, `mail_outbox_pending`, `dlq_depth`, `worker_queues` |

Worker replicas expose the same `/livez` and `/readyz` probes on `WORKER_HEALTH_PORT` (default `9090`).

Full semantics and probe matrix: [health-checks.md](../reference/reliability/health-checks.md).

```bash
curl -sS -w '\nHTTP %{http_code}\n' http://localhost:3000/livez
curl -sS -w '\nHTTP %{http_code}\n' http://localhost:3000/readyz
```

### 2. Auth — login and token

| #   | Method | Path                                  | Expected                 |
| --- | ------ | ------------------------------------- | ------------------------ |
| 2.1 | POST   | `/api/v1/auth/login`                  | 201, `data.access_token` |
| 2.2 | POST   | `/api/v1/auth/login` (wrong password) | 401                      |
| 2.3 | GET    | `/api/v1/users/me` (no token)         | 401                      |

```bash
# Login — save token
LOGIN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.com","password":"DemoPassword123!"}')
echo "$LOGIN" | jq .
export TOKEN=$(echo "$LOGIN" | jq -r '.data.access_token')
```

### 3. User profile

| #   | Method | Path                                        | Expected                      |
| --- | ------ | ------------------------------------------- | ----------------------------- |
| 3.1 | GET    | `/api/v1/users/me`                          | 200, email `demo@example.com` |
| 3.2 | GET    | `/api/v1/users/me/settings`                 | 200                           |
| 3.3 | GET    | `/api/v1/users/me/notification-preferences` | 200                           |

```bash
curl -s http://localhost:3000/api/v1/users/me \
  -H "Authorization: Bearer $TOKEN" | jq .
```

### 4. Tenancy — organizations

| #   | Method | Path                                            | Expected                         |
| --- | ------ | ----------------------------------------------- | -------------------------------- |
| 4.1 | GET    | `/api/v1/tenancy/organizations`                 | 200, includes demo org           |
| 4.2 | GET    | `/api/v1/tenancy/organizations/{organization_id}`             | 200 (use org public id + header) |
| 4.3 | GET    | `/api/v1/tenancy/organizations/{organization_id}/memberships` | 200                              |
| 4.4 | GET    | `/api/v1/tenancy/organizations/{organization_id}/roles`       | 200, includes Admin              |

```bash
ORGS=$(curl -s http://localhost:3000/api/v1/tenancy/organizations \
  -H "Authorization: Bearer $TOKEN")
echo "$ORGS" | jq .
export ORG_ID=$(echo "$ORGS" | jq -r '.data[0].id')

curl -s "http://localhost:3000/api/v1/tenancy/organizations/$ORG_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Organization-Id: $ORG_ID" | jq .
```

### 5. Billing (org context)

| #   | Method | Path                                              | Expected           |
| --- | ------ | ------------------------------------------------- | ------------------ |
| 5.1 | GET    | `/api/v1/billing/plans`                           | 200 (seeded plans) |
| 5.2 | GET    | `/api/v1/billing/organizations/{organization_id}/subscriptions` | 200 (may be empty) |
| 5.3 | GET    | `/api/v1/billing/organizations/{organization_id}/entitlements`  | 200                |

```bash
curl -s http://localhost:3000/api/v1/billing/plans \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Organization-Id: $ORG_ID" | jq .
```

### 6. Notify (org context)

| #   | Method | Path                                        | Expected                 |
| --- | ------ | ------------------------------------------- | ------------------------ |
| 6.1 | GET    | `/api/v1/notify/organizations/{organization_id}/webhooks` | 200 (list, may be empty) |

### 7. Negative cases

| #   | Method | Path                                                                        | Expected   |
| --- | ------ | --------------------------------------------------------------------------- | ---------- |
| 7.1 | GET    | `/api/v1/tenancy/organizations/{organization_id}/memberships` without `X-Organization-Id` | 403 or 400 |
| 7.2 | POST   | `/api/v1/auth/login` with `{}` body                                         | 400        |

## Automated smoke test (all domains)

Runs health, auth, user, tenancy, billing, notify, and audit probes against a live server (39 checks). Does not replace Vitest integration tests.

### One-shot gate

Runs migrations, `pnpm db:seed`, `pnpm db:seed:full`, smoke tests, then `pnpm validate`. If nothing is listening on `BASE_URL` (default `http://localhost:3000`), it starts `pnpm dev` and `pnpm dev:worker` in the background, stops them after smoke, then runs validate. Requires Docker services up (`docker compose up -d`). Verbose API/worker logs: `VERIFY_BASE_VERBOSE=1`.

```bash
pnpm verify:base       # migrate → seeds → smoke → validate (starts dev + worker if not running)
pnpm test:api-smoke    # smoke only (server + seed must already be in place)
```

If org-scoped routes return **403** after a permission seed change, run `pnpm db:seed:sync-demo` and retry.

Optional env: `BASE_URL`, `TEST_EMAIL`, `TEST_PASSWORD` (defaults match full seed).

**CI:** Every PR runs the same probes against ephemeral Postgres + Redis after migrate + full seed ([CI/CD and deployment](../deployment/ci-cd/cicd-and-deployment.md)).

**macOS:** GNU `timeout` is not installed by default; if you copy the CI readiness wait locally, use an `until curl …` loop with a deadline or `gtimeout` from Homebrew `coreutils`.

## Get token + org for Postman / k6

```bash
pnpm tool:load-test-credentials
```

Exports `TEST_TOKEN` and `TEST_ORG_ID` for copy-paste.

## Vitest integration tests

Domain integration tests use an isolated DB per test (`cleanupDatabase` in `beforeEach`). They do **not** rely on full seed data.

```bash
pnpm test:e2e          # domain integration tests
pnpm test              # full suite (needs test DB)
```

Generated API reference: `pnpm docs:all` → `docs/openapi/openapi.json`, `docs/postman-collection.json`.

Route list: `docs/routes.txt` (`pnpm routes:catalog`).

## Related docs

- [setup.md](setup.md) — local setup and seed commands
- [../reference/testing/load-testing.md](../reference/testing/load-testing.md) — k6 load tests with seeded user
