# Hadrian — API authorization testing (local & dev)

Runbook for [Hadrian](https://github.com/praetorian-inc/hadrian) (Praetorian, v1.0.0) — role-based
authorization permutation testing (BOLA/BFLA/BOPLA) against a **running** core-be target.

> Companion to the strategy doc: [`docs/reference/security/authorization-testing-plan.md`](../../docs/reference/security/authorization-testing-plan.md).
> Hadrian is the **black-box, deployed-target** layer (§9.2 there). The in-process matrix remains the primary, white-box gate.

---

## What I verified about Hadrian v1.0.0 (corrects the original report)

| Claim in the source report | Reality (v1.0.0, read from the installed binary + module cache) |
| -------------------------- | --------------------------------------------------------------- |
| SARIF output → GitHub code scanning | ❌ **Not in v1.0.0.** `--output` supports `terminal`, `json`, `markdown` only. |
| `--base-url` to point at an environment | ❌ No such flag for REST. Target = the OpenAPI **`servers`** block. `run-hadrian.sh` patches it per env. |
| `auth.yaml` username/password login | The shipped pattern is **static per-role bearer tokens** via env vars. We mint JWTs and inject them. |
| Role `level` + `permissions` | ✅ Real. Format `action:object:scope`; attacker = lower level, victim = higher. |
| Apache-2.0, 30 templates, OWASP API Top 10 | ✅ Real (8 REST templates ship under the module's `templates/rest/`). |

---

## Prerequisites

| Tool | Note |
| ---- | ---- |
| **Node 24.13.0** | repo pins it (`.nvmrc`). This container defaulted to Node 22 — activate with `nvm use 24.13.0`. |
| **pnpm ≥ 11** + `pnpm install` | needed for `docs:generate` (spec) and to boot the app. |
| **hadrian** | `go install github.com/praetorian-inc/hadrian/cmd/hadrian@latest` → `~/go/bin/hadrian` (installed). |
| **Docker** | local Postgres + Redis for a live (non-dry-run) scan. |

---

## Files here

| File | Purpose |
| ---- | ------- |
| `auth.yaml` | bearer-in-header; per-role token from env (committed; **no secrets**). |
| `roles.yaml` | object model + roles (levels/permissions) + path→object map. |
| `run-hadrian.sh` | generate spec → patch `servers` to target → load tokens → run hadrian. |
| `.gitignore` | excludes generated spec, `.tokens.env`, reports, `.hadrian/`. |
| `.tokens.env` | **gitignored**, you create it — per-role JWTs (see below). |

---

## Local run

```bash
nvm use 24.13.0 && pnpm install            # one-time
# 1. (live scan only) bring up the stack + deterministic authz fixtures
pnpm compose:up && pnpm compose:wait && pnpm db:migrate && pnpm db:seed:full
pnpm dev &                                  # API on http://localhost:10000

# 2. mint per-role tokens into tooling/hadrian/.tokens.env  (see "Tokens" below)
# 3. preview the plan (no requests, no server needed):
tooling/hadrian/run-hadrian.sh local --dry-run
# 4. real scan:
tooling/hadrian/run-hadrian.sh local
#    → tooling/hadrian/report.local.md
```

## Dev run

No staging exists, so `dev` is the deployed target. **Requires** (tracked in TODO):

```bash
export CORE_BE_DEV_URL="https://<dev-api-host>"   # not present in setup.config.json yet
# .tokens.env populated with DEDICATED dev test accounts (never prod users)
tooling/hadrian/run-hadrian.sh dev --dry-run      # always dry-run first against dev
tooling/hadrian/run-hadrian.sh dev
```

⚠️ **Mutation safety:** Hadrian's BOLA/BFLA write templates **create, modify, and delete** resources. Run against local and a disposable dev tenant only — never production, never shared real accounts.

---

## Tokens (`.tokens.env`)

core-be JWTs are RS256 and carry the active org in the `org` claim. Two ways to populate:

- **Local (recommended):** mint directly with the app's signing key for seeded users — bypasses captcha on the public login form. A `mint-tokens` helper (TODO) reusing `signAccessToken` will emit:

  ```text
  CORE_BE_USER_A_TOKEN=...   CORE_BE_USER_B_TOKEN=...
  CORE_BE_OWNER_TOKEN=...     CORE_BE_ADMIN_TOKEN=...
  CORE_BE_MEMBER_TOKEN=...    CORE_BE_SUPER_ADMIN_TOKEN=...
  ```

- **Dev:** log in dedicated dev accounts via `POST /api/v1/auth/login` and copy the JWTs (store as CI secrets).

For cross-org BOLA, `user_b`'s token must carry a *different* `org` claim than `user_a`'s.

---

## TODO

**Done**

- [x] Install Hadrian v1.0.0 (`~/go/bin/hadrian`).
- [x] Reverse-engineer the real v1.0.0 config schema from the module cache.
- [x] Scaffold `auth.yaml`, `roles.yaml`, `run-hadrian.sh`, `.gitignore`.
- [x] Commit the authorization testing plan (`docs/reference/security/authorization-testing-plan.md`).
- [x] Install Node 24.13.0 (container shipped Node 22).

**Local — pending**

- [ ] `pnpm install` (in progress).
- [ ] `docs:generate` + `run-hadrian.sh local --dry-run` → confirm endpoint selectors hit the real routes.
- [ ] `mint-tokens` helper → `.tokens.env` for all six roles.
- [ ] Bring up stack (compose + migrate + seed deterministic authz users) and run the first live scan.
- [ ] Triage `report.local.md`; reconcile against the in-house matrix findings.

**Dev — pending (blocked)**

- [ ] Obtain `CORE_BE_DEV_URL` — not exposed in `tooling/setup/setup.config.json`.
- [ ] Provision dedicated, non-prod dev test accounts per role (creds as secrets).
- [ ] Confirm network reachability from CI/runner → dev.
- [ ] Scheduled (non-PR) CI job; mutation-safety sign-off.

**Cross-cutting**

- [ ] Sanity-check the harness against OWASP crAPI first (`test/crapi/` ships configs).
- [ ] Decide on LLM triage (`--llm-host` Ollama / `--llm-provider`) vs none.
- [ ] Add `pnpm` aliases `security:authz:hadrian:{local,dev}`.
- [ ] Verify `roles.yaml` `endpoints` paths against the generated spec's `{param}` style + `/api/v1` prefix.
