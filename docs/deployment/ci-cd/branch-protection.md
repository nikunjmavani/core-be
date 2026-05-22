# Branch protection and required CI checks

Canonical reference for **which GitHub checks must gate merges** into **`main`** and **`dev`**, and how that maps to workflows and committed ruleset JSON under [`.github/rulesets/`](../../../.github/rulesets/).

**Related docs:** [CI/CD and deployment](cicd-and-deployment.md) (what runs in CI, deploy, and release flow), [Git workflow](../../process/git-workflow.md) (branch naming and promotion).

---

## Branch model

Long-lived branches **`main`** and **`dev`** align with Railway environments (production, development). Typical promotion path:

```mermaid
flowchart LR
  subgraph work [Working branches]
    featureBranches["feature/*"]
    fixBranches["fix/*"]
    hotfixBranches["hotfix/*"]
  end

  subgraph longlived [Long-lived branches]
    devBranch[dev]
    mainBranch[main]
  end

  featureBranches --> devBranch
  fixBranches --> devBranch
  devBranch --> mainBranch
  hotfixBranches --> mainBranch
```

Hotfixes merge **`hotfix/* → main`** first; then sync **`main → dev`** so long-lived branches stay aligned (see [Git workflow](../../process/git-workflow.md)).

---

## Required status checks (pull requests)

These are the **exact check names** to require in GitHub for every PR targeting **`main`** or **`dev`**.

GitHub Actions reports checks as **`{workflow_name} / {job_name}`** (workflow `name:` from the YAML file, then job `name:`). Match **including spaces and punctuation**.

| Workflow file                                                               | Workflow `name:` | Job `name:`                                  | Required check string                             |
| --------------------------------------------------------------------------- | ---------------- | -------------------------------------------- | ------------------------------------------------- |
| [.github/workflows/pr-branch-ci.yml](../../../.github/workflows/pr-branch-ci.yml) | `CI` | `Quality` | `CI / Quality` |
| [.github/workflows/pr-branch-ci.yml](../../../.github/workflows/pr-branch-ci.yml) | `CI` | `Tests` | `CI / Tests` |
| [.github/workflows/pr-branch-ci.yml](../../../.github/workflows/pr-branch-ci.yml) | `CI` | `API smoke` | `CI / API smoke` |
| [.github/workflows/pr-branch-ci.yml](../../../.github/workflows/pr-branch-ci.yml) | `CI` | `Docker` (Trivy image scan) | `CI / Docker` |
| [.github/workflows/pr-governance.yml](../../../.github/workflows/pr-governance.yml) | `PR Governance` | `Checks` | `PR Governance / Checks` |

### Same checks on both branches

Require **all five** CI + PR rows above for **`main`** and **`dev`** PRs. [`.github/workflows/pr-branch-ci.yml`](../../../.github/workflows/pr-branch-ci.yml) runs the same CI targets on PRs into each of these branches (`on: pull_request: branches: [main, dev]`). Chaos, SBOM, and API docs run from [post-merge-ci.yml](../../../.github/workflows/post-merge-ci.yml) on push only (not required PR checks).

### Skipped CI jobs on docs-only pull requests

When [pr-branch-ci.yml](../../../.github/workflows/pr-branch-ci.yml) path filters detect **no `src-code` changes**, these jobs are **skipped** on `pull_request` (push runs are owned by [post-merge-ci.yml](../../../.github/workflows/post-merge-ci.yml)):

| Job `name:`                                  | Skipped when       |
| -------------------------------------------- | ------------------ |
| `Tests`     | Docs/markdown-only |
| `API smoke` | Docs/markdown-only |
| `Docker`    | Docs/markdown-only (unless `docker` paths change) |

Skipped required checks do **not** block merge. `Quality` and `PR Governance` always run. The markdown lane lives in [pr-docs-lane.yml](../../../.github/workflows/pr-docs-lane.yml) and only triggers when a PR touches `*.md`, so code-only PRs never list it as `Skipped`.

### Advisory PR jobs (not in rulesets)

_None — all merge-gating CI jobs are listed in the required table above._

### Post-merge-only jobs (do not add as PR required checks)

| Job `name:`  | Workflow                                                                     | Why                                     |
| ------------ | ---------------------------------------------------------------------------- | --------------------------------------- |
| `Chaos`      | [post-merge-ci.yml](../../../.github/workflows/post-merge-ci.yml)            | Push to `main` only — Toxiproxy chaos suite |
| `SBOM`       | [post-merge-ci.yml](../../../.github/workflows/post-merge-ci.yml)            | Push to `main`/`dev` — CycloneDX artifact for the branch tip |
| `API docs`   | [post-merge-ci.yml](../../../.github/workflows/post-merge-ci.yml)            | Push to `main`/`dev` — regenerates OpenAPI + Postman and uploads to Postman/Scalar when environment secrets exist |
| `Commitlint` | [protected-branch-commitlint.yml](../../../.github/workflows/protected-branch-commitlint.yml) | Push to `main`, `dev` |

Treat these as **post-merge gates**: failing runs still indicate problems on the branch tip after merge.

[deploy-railway.yml](../../../.github/workflows/deploy-railway.yml) runs after **CI** succeeds (`workflow_run`) or via **workflow_dispatch**; it is **not** a PR status check.

---

## Ruleset policy summary (by branch)

These settings match the committed JSON files in [`.github/rulesets/`](../../../.github/rulesets/). Adjust there and re-import if policy changes.

| Rule                                  | `main`                                                              | `dev`                 |
| ------------------------------------- | ------------------------------------------------------------------- | --------------------- |
| Required approving reviews            | 1                                                                   | 1                     |
| Require CODEOWNER review              | Yes ([CODEOWNERS](../../../.github/CODEOWNERS))                     | No                    |
| Dismiss stale approvals on push       | Yes                                                                 | No                    |
| Require approval on last push         | Yes                                                                 | No                    |
| Require conversation resolution       | Yes                                                                 | Yes                   |
| Allowed merge methods                 | Squash only                                                         | Squash + merge commit |
| Require linear history                | Yes                                                                 | No                    |
| Require signed commits                | Yes                                                                 | No                    |
| Block force-push (`non_fast_forward`) | Yes                                                                 | Yes                   |
| Block branch deletion                 | Yes                                                                 | Yes                   |
| Required status checks                | CI quality + tests + API smoke + chaos + docker (Trivy) + PR checks | Same                  |

**Signed commits on `main`:** Contributors must use [verified signatures](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification). Teams without signing enabled should temporarily relax `required_signatures` in `main.json` until onboarding is complete.

---

## Apply rulesets (GitHub UI)

1. Repository → **Settings** → **Rules** → **Rulesets** → **New ruleset** → **New branch ruleset**.
2. Target branches: **`main`** (or **`dev`**).
3. Add rules matching the table above and the corresponding JSON file under [`.github/rulesets/`](../../../.github/rulesets/).
4. Set enforcement to **Active** (use **Evaluate** on Enterprise first if you want dry-run insights).

---

## Apply rulesets via GitHub CLI (`gh`)

Requires [`gh`](https://cli.github.com/) authenticated with **`repo`** scope (and organization permission if the repo belongs to an org).

### One-step init (recommended)

Use [`tooling/setup/github-init.ts`](../../../tooling/setup/github-init.ts). It derives the target branches from the committed rulesets (`refs/heads/<branch>` entries in `conditions.ref_name.include`), ensures each branch exists on the remote (creating missing branches from the default branch's SHA via `POST /repos/{repo}/git/refs`), `POST`s / `PUT`s every ruleset, and idempotently creates the GitHub Environments declared in [`.github/environments/*.json`](../../../.github/environments/). Safe to run repeatedly.

```bash
pnpm github:sync --check   # read-only: consistency + drift (missing branches, rulesets, environments)
pnpm github:sync           # apply branches + rulesets + environments + push .env.<env> values
```

Before any GitHub API call, `github:sync` runs a **gh auth preflight** that prints the currently active `gh` user and lets you confirm, abort, or switch to a different account (`gh auth switch`). The values push requires typing `sync` (or `--yes` in automation) and is non-reversible.

The script resolves the target repository in this order: `GITHUB_REPOSITORY` env → `origin` git remote → `gh repo view`.

### Manual one-off via raw API

Replace **`OWNER`** and **`REPO`** with your GitHub owner and repository name.

Each **`POST`** creates a **new** ruleset. Do not run these repeatedly without deleting duplicate rulesets in **Settings → Rules**, or use **`PUT`** / **`PATCH`** with an existing ruleset ID instead.

```bash
gh api --method POST repos/OWNER/REPO/rulesets \
  -H "Accept: application/vnd.github+json" \
  --input .github/rulesets/main.json

gh api --method POST repos/OWNER/REPO/rulesets \
  -H "Accept: application/vnd.github+json" \
  --input .github/rulesets/dev.json
```

**Updating an existing ruleset:** use `PATCH /repos/{owner}/{repo}/rulesets/{ruleset_id}` with the same JSON shape (omit fields you do not want to change), or edit in the UI. Listing IDs: `gh api repos/OWNER/REPO/rulesets`.

### Plan requirement

Repository rulesets on **private** repos require **GitHub Pro / Team / Enterprise**. On the free personal plan the API returns `HTTP 403`:

> `Upgrade to GitHub Pro or make this repository public to enable this feature.`

The sync script surfaces this message verbatim and exits non-zero. Either upgrade the account/org plan or make the repository public to apply rulesets.

**Verifying check names:** After at least one PR run, open the PR → **Checks** tab and confirm names match **`CI / …`** and **`PR Governance / …`**. If GitHub shows a different label, align [`.github/rulesets/*.json`](../../../.github/rulesets/) and this doc.

---

## Maintenance

- **Renaming or splitting CI jobs:** Update job `name:` values in workflows **and** sync **`required_status_checks`** contexts in **every** file under [`.github/rulesets/`](../../../.github/rulesets/), plus this document.
- **Adding a new required workflow:** Prefer extending [.github/workflows/pr-branch-ci.yml](../../../.github/workflows/pr-branch-ci.yml) or [.github/workflows/pr-governance.yml](../../../.github/workflows/pr-governance.yml) so checks stay consistent across branches.

Consult [.cursor/skills/skill-index/SKILL.md](../../../.cursor/skills/skill-index/SKILL.md) after edits to `.github/rulesets/` or this file (**docs-maintainer**). Changes to [.github/workflows/pr-branch-ci.yml](../../../.github/workflows/pr-branch-ci.yml) should still follow **code-quality-guard**.
