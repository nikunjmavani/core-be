# SonarQube — local quality gate

SonarQube runs **locally** (Docker) and is enforced as a **pre-push gate**: when you push commits
that touch deployed-surface code (`src/` runtime), the hook scans the project and **blocks the
push if SonarQube reports any unresolved issue or hotspot**. Everything is local — there is no
hosted SonarQube and no CI dependency.

## TL;DR

```bash
pnpm compose:up    # starts the app stack AND SonarQube (SONAR=0 pnpm compose:up skips Sonar)
pnpm sonar:scan    # scan now + print the report; exits non-zero if anything is open
git push           # the pre-push hook runs the same gate automatically
```

`pnpm compose:up` brings SonarQube up with the rest of the local stack — detached, so it boots in
the background and the gate waits for readiness only when needed. First boot is ~2 min and
provisions an analysis token into `.env.local` (gitignored); after that a scan is ~60–90s.
`pnpm sonar:up` starts only SonarQube, and the pre-push gate auto-starts it if it is down.

## Commands (`sonar:*` namespace)

| Command | What it does |
| --- | --- |
| `pnpm sonar:up` | Start the local SonarQube server (`docker-compose.sonar.yml`). |
| `pnpm sonar:scan` | Run the quality gate now: ensure server up → scan → wait → report. Exit 1 if any issue/hotspot, else 0. |
| `pnpm sonar:down` | Stop the server (keeps the analysis volume). |
| `pnpm sonar:reset` | Wipe the volume and start fresh (`down -v` + `up`). Use if auth/state gets stuck. |

The server UI is at <http://localhost:9000>. Admin credentials are generated on first run and
stored in `.env.local` as `SONAR_ADMIN_PASSWORD` / `SONAR_TOKEN`.

## How the pre-push gate works

The `.husky/pre-push` hook runs the gate **only when the pushed commits include deployed-surface
code** — `src/**/*.ts` excluding tests, `src/scripts/**`, and `__tests__/`. Pushes that touch only
tests, tooling, docs, or migrations skip the scan (Sonar excludes those anyway — see
[Scope](#what-sonarqube-analyzes)).

The gate ([`tooling/sonar/sonar-gate.ts`](../../../tooling/sonar/sonar-gate.ts)):

1. **Auto-starts** the SonarQube container if it is not already up, and waits for it to be ready.
2. **Provisions a token** on first run (changes the default `admin/admin` password to a generated
   one, mints a token, saves both to `.env.local`). Idempotent afterwards.
3. **Scans** via the `sonar-scanner-cli` container.
4. **Waits** for the server to finish processing the report.
5. **Reports** every unresolved issue + hotspot and **exits 1** (blocking the push) if there is at
   least one; exits 0 when clean.

### Escape hatches

```bash
SKIP_SONAR=1 git push    # skip only the Sonar gate (still runs typecheck/build/tests)
git push --no-verify     # skip all pre-push hooks
```

## What SonarQube analyzes

Analysis is scoped to the **deployed-application surface** (`src/` runtime), matching the CodeQL
scoping in [`.github/codeql/codeql-config.yml`](../../../.github/codeql/codeql-config.yml). Excluded
from analysis (see [`sonar-project.properties`](../../../sonar-project.properties)):

- **Tests** — `*.test.ts`, `*.spec.ts`, `__tests__/`, `src/tests/` (run with trusted fixtures; test-only rules are systematic false positives).
- **Tooling & scripts** — `tooling/**`, `src/scripts/**` (dev/CI only, developer-controlled input).
- **Migrations, generated, and build artifacts** — `migrations/**`, `dist/`, `coverage*/`, `*.d.ts`.

So a clean gate means **zero issues in the code that ships to production**.

## Troubleshooting

- **"failed to start SonarQube (is Docker running?)"** — start Docker Desktop, then retry.
- **"admin password is unknown"** — the instance was provisioned outside this flow. Run
  `pnpm sonar:reset` to start fresh, or set `SONAR_ADMIN_PASSWORD` in `.env.local`.
- **Server slow / stuck after an upgrade** — `pnpm sonar:reset`.
- **Need to bypass once** — `SKIP_SONAR=1 git push` (see above), then fix and re-push.
