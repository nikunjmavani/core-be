# Rollback deploy (previous image)

One-click rollback of a bad release: redeploy the `:previous` GHCR images —
retagged by the last **successful** deploy — without building anything.
Incident time drops from "hotfix + full CI" (~30 min) to a dispatch + approval
(~3 min).

## When to use

- The current production release misbehaves (errors, latency, broken flow) and
  the previous version was healthy.
- You need traffic off the bad version **now**, before a code-level fix or
  revert can ride the normal pipeline.

## How

1. Actions → **Rollback deploy (previous image)** → *Run workflow* →
   `target: production` → Run.
2. Approve the `production` environment gate when prompted (same required
   reviewer as a deploy).
3. The run reuses the full deploy pipeline (`reusable-railway-deploy.yml` with
   `image_override`): env validation → migrations (no-op) → Railway API +
   worker → `/readyz` + API-surface probes.

## What it does and does not roll back

| | Rolled back? |
| --- | --- |
| Application code (API + worker images) | ✅ yes — `:previous` GHCR tags |
| Database schema / migrations | ❌ no — migrations are forward-only |
| GitHub Environment config / secrets | ❌ no |
| The git branch / release tag | ❌ no — `main` and the tag are untouched |

Migrations lint enforces additive/compatible changes, which is what makes image
rollback safe in the common case. If the bad release shipped a **destructive**
migration, rollback alone is not sufficient — treat it as a restore scenario
(see the restore drills) and involve the backup runbooks.

## After rolling back

1. Land the real fix or a `revert:` commit through the normal path (a `fix:` PR to
   `main`, then merge the Release PR). Versions only move forward — the fix ships as
   the **next** patch version, never by re-tagging.
2. Note: the next successful deploy overwrites `:previous` with the version you
   just rolled back **from**. Do not roll back twice expecting to go two
   versions back.
3. Close the auto-opened `ci-failure` issue if one was created for the incident.

## Preconditions

- `:previous` tags exist only after at least one successful deploy of that
  environment has completed its retag step.
- The dispatch runs from `main` (the single trunk); the environment's deployment
  branch policy accepts `main` and `v*` release tags.
