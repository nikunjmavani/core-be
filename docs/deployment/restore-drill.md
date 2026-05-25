# Monthly restore drill (deployment)

Canonical process: **[backup-drills.md](../process/backup-drills.md)** — RTO recording, `RTO_MINUTES` threshold, artifacts, and human checklist.

This page covers deployment wiring only.

---

## Workflows

| Workflow                               | File                                                                                           | When                                         | Required?             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------- |
| **Monthly backup restore & RTO drill** | [scheduled-monthly-restore-rto.yml](../../.github/workflows/scheduled-monthly-restore-rto.yml) | 1st of month 06:00 UTC + `workflow_dispatch` | Yes (compliance gate) |
| **Manual DR RTO record (optional)**    | [manual-dr-rto-record.yml](../../.github/workflows/manual-dr-rto-record.yml)                   | `workflow_dispatch` only                     | No                    |

### Monthly drill (required)

| Secret / input                           | Purpose                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `DATABASE_URL_FOR_MONTHLY_RESTORE_DRILL` | **Required** repository secret — throwaway Neon branch for `db:migrate` + integration smoke |

The workflow **fails** when the secret is missing, restore steps do not complete, or `restore_seconds` ≥ `RTO_MINUTES × 60` (default **60 minutes**).

### Manual evidence (optional)

| Input                  | Purpose                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `recorded_rto_minutes` | Human end-to-end RTO after a manual drill (separate workflow; does not satisfy the monthly gate) |

---

## CI artifacts

### Monthly backup restore & RTO drill

| Artifact                   | Contents                        |
| -------------------------- | ------------------------------- |
| `restore-drill-rto`        | Automated timing JSON           |
| `restore-drill-rto-report` | Consolidated report for the run |

### Manual DR RTO record (optional)

| Artifact                   | Contents           |
| -------------------------- | ------------------ |
| `restore-drill-rto-manual` | Manual timing JSON |

---

## Related

- [backup-drills.md](../process/backup-drills.md) — full drill procedure
- [dr-runbook.md](../process/dr-runbook.md) — disaster recovery runbook
- [cicd-and-deployment.md](ci-cd/cicd-and-deployment.md) — repository secrets
