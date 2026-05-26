# Monthly restore drill (deployment)

Canonical process: **[backup-drills.md](../process/backup-drills.md)** — RTO recording, `RTO_MINUTES` threshold, artifacts.

This page covers deployment wiring only.

---

## Workflow

| Workflow                               | File                                                                                           | When                                         | Required?             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------- |
| **Monthly backup restore & RTO drill** | [scheduled-monthly-restore-rto.yml](../../.github/workflows/scheduled-monthly-restore-rto.yml) | 1st of month 06:00 UTC + `workflow_dispatch` | Yes (compliance gate) |

Fully automated: Neon PITR child branch from parent **`github.ref_name`** → migrate → integration smoke → RTO assert → branch delete.

---

## GitHub Environment secrets (required)

| Secret | Purpose |
| ------ | ------- |
| `MONTHLY_DATABASE_RESTORE_DRILL_NEON_API_KEY` | Neon API authentication |
| `MONTHLY_DATABASE_RESTORE_DRILL_NEON_PROJECT_ID` | Target Neon project |

Provision in `.env.development` / `.env.production` (GitHub Secrets half) and sync with `pnpm github:sync`. The workflow job uses the GitHub Environment matching the git ref (`main` → `production`, `dev` → `development`).

**Parent branch:** resolved from the workflow git ref (`main` on cron schedule; `dev` when dispatched on `dev`). The Neon project must have matching branch names.

The workflow **fails** when secrets are missing, when the parent Neon branch is not found, when restore steps do not complete, or when `restore_seconds` ≥ `RTO_MINUTES × 60` (default **60 minutes**).

---

## CI artifacts

| Artifact                   | Contents                        |
| -------------------------- | ------------------------------- |
| `restore-drill-rto`        | Automated timing JSON           |
| `restore-drill-rto-report` | Consolidated report for the run |

---

## Related

- [backup-drills.md](../process/backup-drills.md) — full drill procedure
- [dr-runbook.md](../process/dr-runbook.md) — disaster recovery runbook
- [credentials-and-env.md](../integrations/credentials-and-env.md) — secret setup
