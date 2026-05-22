# Monthly restore drill (deployment)

Canonical process: **[backup-drills.md](../process/backup-drills.md)** — RTO recording, `RTO_MINUTES` threshold, artifacts, and human checklist.

This page covers deployment wiring only.

---

## Workflow

[scheduled-monthly-restore-rto.yml](../../.github/workflows/scheduled-monthly-restore-rto.yml) (`Monthly backup restore & RTO drill`) runs on the **1st of each month** (06:00 UTC) and on `workflow_dispatch`.

| Secret / input | Purpose |
| -------------- | ------- |
| `NEON_DRILL_DATABASE_URL` | Throwaway Neon branch for automated `db:migrate` + integration smoke |
| `recorded_rto_minutes` | Manual end-to-end RTO when automation is skipped |

---

## CI artifacts

| Artifact | Contents |
| -------- | -------- |
| `restore-drill-rto` | Automated timing JSON |
| `restore-drill-rto-manual` | Manual timing JSON |
| `restore-drill-rto-report` | Consolidated report for the run |

The workflow fails when `restore_seconds` ≥ `RTO_MINUTES × 60` (default **60 minutes**).

---

## Related

- [backup-drills.md](../process/backup-drills.md) — full drill procedure
- [dr-runbook.md](../process/dr-runbook.md) — disaster recovery runbook
- [cicd-and-deployment.md](ci-cd/cicd-and-deployment.md) — repository secrets
