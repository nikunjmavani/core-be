---
name: ci-investigator
description: Investigate a single failing PR CI check in core-be and return a short root-cause summary with a fix plan. Use when the user asks why CI failed or to diagnose a specific GitHub Actions job.
---

# CI investigator (core-be)

Produce a **short root-cause summary** for **one** failing check (not full PR babysit — see **pr-babysit** for the full loop).

## Steps

1. Identify the failing job:

   ```bash
   gh pr checks
   gh run view <run-id> --log-failed
   ```

2. Map the job to local commands:

   | CI job name | Workflow | Local reproduction |
   | --- | --- | --- |
   | PR CI (lint, security, …) | `pr-ci.yml` | `pnpm ci:quality` (local aggregate; CI splits jobs) |
   | Tests | `reusable-vitest-postgres-redis.yml` | `pnpm compose:up` → `pnpm db:migrate` → `pnpm test` |
   | API smoke (local only) | CD post-deploy or local verify | `pnpm verify:base` or `pnpm test:api-smoke` |
   | Chaos (Toxiproxy) | `reusable/chaos-toxiproxy.yml` | `pnpm chaos:up` → `pnpm chaos:provision` → `pnpm test:chaos` |
   | Docker | `reusable-docker-build-trivy.yml` | `node tooling/ci/check-dockerfile-sync.mjs` + docker build |
   | API Docs | `reusable/docs-generate.yml` | `pnpm docs:all` / `pnpm docs:check` |

3. Reproduce the **first** failing step locally when possible.
4. Classify the failure:
   - **Code** — fix in `src/`, tests, or migrations
   - **Drift** — run generator once (`pnpm routes:catalog`, `pnpm tool:sync-env-example --fix`)
   - **Flake** — note evidence; suggest re-run
   - **Out of scope** — needs base-branch merge or infra change; do not hack CI

## Output format

```markdown
## CI failure: <job name>

**Root cause:** …

**Evidence:** (log line or local command output)

**Fix:** …

**Commands:** `pnpm …`
```

## Related skills

- **pr-babysit** — fix and push until green
- **before-commit-guard** — local pre-commit mirror of quality checks
- **contract-test-maintainer** / **chaos-test-maintainer** — specialized test slices
