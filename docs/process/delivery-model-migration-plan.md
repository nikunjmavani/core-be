# Delivery-model migration — FINAL execution plan

**`dev`+`main` dual-channel → single-`main` trunk: branching · release-please · CI/CD lanes · deploy governance · feature flags**

> **Status: FINAL — approved for execution.** v1.4, 2026-07-07 (v1.1: §9 second-order audit;
> v1.2: release-deploy queue race, squash settings; v1.3: live governance params — merge-only main,
> review lockout, tag-ref env policy; **v1.4: the repo's own CI policy tests + generated constants
> couple Phases 1↔2 — config/identity move into Phase 1, policy-test twins updated in-PR, and the
> live dev ruleset must be hand-deleted before the branch can be archived**).
> Grounded against the repo at
> `c2549704` (dev): every file path verified, every "today" claim read from the actual files.
> Decisions are **locked** (§1) — reopening one means editing this file first.
>
> Execution model: each phase is one PR (or a settings/sync action) with a **gate** — do not start
> the next phase until the gate passes. Track progress by checking the boxes in this file.

Related: [git-workflow.md](git-workflow.md) · [release-versioning.md](release-versioning.md) ·
[branch-protection.md](../deployment/ci-cd/branch-protection.md) ·
[cicd-and-deployment.md](../deployment/ci-cd/cicd-and-deployment.md)

---

## The model in one paragraph — the cutover moment

**We merge `dev` into `main` one final time, and from that merge onward `main` is the only
long-lived branch — everything goes directly to `main`.**

```text
  ── the switch ──────────────────────────────────────────────────────────────
   1.  FINAL PROMOTION   merge dev → main once more, the existing way          (Phase 0.2)
                         · main now contains everything dev had
   2.  FREEZE            no more merges to dev — it is done receiving work      (Phase 0.4)
   3.  CUT OVER          merge the CI/release PR + retire dev                   (Phases 1–2)
                         · default branch flips dev → main
                         · dev branch archived/deleted
  ── from here on, forever ────────────────────────────────────────────────────
   ▸  EVERY feature branch → PR → **squash-merge straight into `main`**
   ▸  NO dev, NO promotion step, NO back-merge — main is trunk
   ▸  release-please keeps ONE "chore: release X.Y.Z" PR open on main;
      **merging that Release PR is the ship button** → tag + production deploy
   ▸  incomplete work hides behind feature flags, not long-lived branches
```

Concretely: after the final `dev → main` promotion in **Phase 0.2**, we never target `dev`
again. Phase 1 rewires CI to `main`, Phase 2 flips the default branch and deletes `dev`, and from
that point every contributor (and every AI agent) opens PRs **against `main`** and squash-merges
into it directly. The rest of this document is the safe, gated path to get there without breaking
the release channel, the deploy governance, or the repo's own CI-config tests along the way.

---

## 0. What changes at a glance

```text
  BEFORE (dual-channel)                        AFTER (trunk)
  ─────────────────────                        ─────────────
  feature PR → dev ──────────────┐             feature PR → main  (squash, tiny)
    post-merge: build→test→       │               post-merge: build→test→
    release-please(-dev.N,        │               release-please refreshes ONE
    AUTO-merged) → deploy DEV     │               Release PR (NOT auto-merged)
                                  │               → deploy DEVELOPMENT env
  promote dev→main (human gate) ──┘
    post-merge: build→test→                    merge Release PR (THE ship button)
    release-please(stable,                       → tag vX.Y.Z + GitHub Release
    AUTO-merged) → deploy PROD                   → deploy PRODUCTION env
    → back-merge main→dev                          (env reviewer approval)
                                                 → NO back-merge (single branch)
  versions: X.Y.Z-dev.N + X.Y.Z               versions: X.Y.Z only
```

The **human release gate moves**: today it is the `dev → main` promotion (release PRs auto-merge
on both channels). After migration it is **merging the Release PR** — so the auto-merge step is
removed, otherwise every feature merge would instantly cut a production release.

---

## 1. Decisions — LOCKED

| # | Decision | Locked choice |
| --- | --- | --- |
| L1 | Prerelease phase | **Stable-only** — drop `-dev` versions; environments distinguish dev/prod, not the version |
| L2 | Version baseline | **4.10.0** (dev is at `4.10.0-dev.31`, main manifest at `4.8.1`) |
| L3 | Baseline mechanism | **`Release-As: 4.10.0` on an empty commit INSIDE the Phase 1 PR branch** (v1.3: main's ruleset is merge-only today, so a squash-body footer is impossible; the in-branch empty commit survives any merge method and any squash setting). `manifest.json` stays `4.8.1` (last *real* tag) so the v4.10.0 changelog covers everything since v4.8.1. Never hand-pin the manifest to an untagged version |
| L4 | Merge queue | Later, when concurrent PR volume warrants (item 6.4) |
| D1 | Release PR auto-merge | **Removed.** The Release PR merge is the manual ship button ("integrate often, release on cadence") |
| D2 | Where release-please reads its PAT | **`environment: development`** (unprotected; PAT synced to both env copies by `pnpm github:sync`). Pinning to `production` would trip the required-reviewer gate on every merge. Bonus: the weekly PAT canary already probes the development copy — it now probes exactly the copy in use |
| D3 | Production image provenance | **Build-once, promote**: production deploys the *same* GHCR image built + Trivy-scanned for the release merge SHA — no rebuild |
| D4 | Production env reviewer gate | **Kept** (`requiredReviewers` on the production environment) — second confirmation on the release; also gates manual dispatch deploys/rollbacks. Revisit in 6.3 |
| D5 | Dev-environment deploy cadence | **Every merge to main** deploys the development environment (trunk = dev env) |
| D6 | Feature-flag governance | **Prefix-classified release flags** (`FEATURE_<NAME>_ENABLED`) + JSON registry + CI expiry gate (§8; built in Phase 3) — dead flags fail CI instead of accumulating |
| D7 | Production deploy trigger | **`release-deploy.yml` on `release: published`, pinned to the release TAG SHA** — the post-merge concurrency group cancels intermediate *pending* runs, so `releases_created` can fire on a **later** run whose `github.sha` already contains post-release commits (and the tag sha's image may never have been built). A release-event workflow is immune to the queue race and independently retryable. Requires the PAT (events from `github.token`-created releases don't trigger workflows — the existing tripwire now also guards prod deploys). **Prerequisite (v1.3):** the production environment's deployment policy must admit **tag refs** — see 1.12 |
| D8 | PR review policy on main | **Adopt dev's current profile**: `required_approving_review_count: 0`, no code-owner review, no last-push approval (keep thread resolution). Main's *current* params (1 approval + code-owner + last-push approval, CODEOWNERS exists) were promotion-gate settings — carried into single-trunk they **lock a solo maintainer out of merging anything**, including the Release PR. Re-tighten deliberately when a second regular reviewer exists |
| D9 | Strict up-to-date checks | **Keep `strict_required_status_checks_policy: true`** (both rulesets already have it) — every PR must be current with main before merge. Cost: the update-branch treadmill under concurrent PRs; that treadmill becoming painful *is the trigger* for the merge queue (6.4), not a reason to weaken to `false` |
| D10 | Post-merge test model | **PR gate authoritative + adaptive post-merge lanes** (user-approved 2026-07-07). Because strict up-to-date (D9) + squash means the merge commit's tree equals the tested PR tree, the **full matrix (e2e + integration + unit-db + rls + performance) moves onto the PR gate** — the PR becomes the authoritative test. Post-merge on `main` then branches on `N = commits in the push` (squash ⇒ N = number of PRs): **N==1 → FAST lane** (build image + release-please + deploy dev; **no re-test**); **N≥2 → FULL lane** (re-run the matrix — the *combined* tree of batched/merge-queued PRs was never tested together, the one real collision risk). This **subsumes C1–C4**: the redundant "PR runs X, post-merge re-runs X" pairs (unit, RLS, docker) collapse because post-merge single-PR runs none of them; CodeQL-once (C1) still applies. Trade-off: PRs run the full suite pre-merge — negligible at solo/low volume (this repo, per D8); the update-branch treadmill (D9) is the trigger to add the merge queue (6.4), which then makes N≥2 batches the norm and the FULL lane their natural gate |

---

## 2. Current state — grounded facts (and the 3 landmines)

| Fact | Where | Impact |
| --- | --- | --- |
| 🔵 **Live default branch already flipped to `main`** (owner-changed, 2026-07-07, after v1.4 was written) — but **committed `setup.config.json` still says `defaultBranch: "dev"`, `protectedBranches: ["dev","main"]`** | live: `gh repo view`; committed: `tooling/setup/setup.config.json` `git.defaultBranch` | The Phase 2 *live* default flip is **already done**; what remains is reconciling **committed config → main** (item 1.26 + regenerated identity constants) so config-as-code stops drifting and the weekly drift guard stops fighting it. Bonus: removes the Phase 1→2 "zero-CI window" risk — new PRs already default to `main`. dependabot already follows `main` |
| Branch protection is **committed as code** | `.github/rulesets/dev.json`, `.github/rulesets/main.json`, applied by `pnpm github:sync`; drift-checked weekly | Phase 2 edits JSON + sync, not UI clicks |
| GitHub Environments committed as code | `.github/environments/{development,production}.json` | Env changes go through these files |
| 🧨 **Production env has a required-reviewer gate** (`nikunjmavani`) + protected-branches deploy policy | `.github/environments/production.json` | `post-merge-ci.yml:230` comment "both environments have no protection rules" is **stale/wrong**. release-please pinned to `environment: production` would block the Release-PR refresh on manual approval **every merge** → D2 |
| 🧨 **Release PRs auto-merge today** (`gh pr merge --auto`, both channels) | `post-merge-ci.yml:350-401` | Carried into single-trunk = accidental continuous production releases → D1 |
| 🧨 **Deploy environment is resolved from the branch name** (`main→production`, `dev→development`) | `reusable-railway-deploy.yml` `resolve-environment`; same mapping in the `api-docs` job | On a single trunk, "push to main" must NOT mean "deploy production" → deploy keys on `releases_created` + explicit `github_environment` input (precedent: `reusable-openapi-postman-publish` already has one) |
| Release PRs are merged with the PAT so the merge re-triggers post-merge CI | `post-merge-ci.yml:350` comment | Preserved: a human merging the Release PR always re-triggers; PAT tripwire step stays |
| `versioning: prerelease` + `CHANGELOG-dev.md` on the dev channel | `.github/release-please/config.dev.json` | Deleted in Phase 1 |
| Scheduled guards: ancestry (daily) + env/ruleset drift (weekly) + PAT canary (weekly) | `scheduled-release-guards.yml` | Ancestry guard dies with single-trunk; the other two stay |
| `rollback-deploy.yml` maps `production→main / development→dev` | line 68 | Repoint: both environments deploy from `main` |
| `scheduled-chaos.yml` defaults its target branch to `dev` | lines 25-44 | Repoint to `main` |
| `dependabot.yml` has **no** `target-branch` override (follows the default branch) | `.github/dependabot.yml` | Auto-repoints on the default flip; fix the stale comment. 1 open PR (#863) targets dev |
| PR CI is already trunk-ready | `pr-ci.yml`: per-PR concurrency + cancel, docs-only short-circuit, parallel fan-out, no PG/Redis except the RLS job | Only the trigger list changes |
| pr-governance enforces the PR-title contract on `pull_request` | `pr-governance.yml` | Unchanged — squash commit = PR title = the conventional-commit gate |
| Env→runtime value chain is fully automated | `.env.<env>` → `github:sync` → GitHub Environment → deploy-time mirror → Railway (`reusable-railway-deploy.yml:495`) | Foundation of the §8 flag lifecycle: a flag flip is a config-only redeploy |

---

## 3. Target CI/CD lanes

```text
┌ LANE 1 — PR (merge gate, unchanged jobs) ──────────────────────────────────┐
│ on: pull_request → [main]                                                  │
│ concurrency: per-PR, cancel-in-progress ✓ (already)                        │
│ changes → docs-only? ──yes──► docs lane only (pr-docs-lane + unit gate)    │
│    │no                                                                     │
│    ├─ lint · typecheck · static-sync · unit · migration-lint               │
│    ├─ rls-security (only PG/Redis job) · build-verify (docker, load-only)  │
│    ├─ security: audit · secrets · SAST · IaC · dependency-review           │
│    ├─ contract+property · openapi-breaking · actionlint · agent-os evals   │
│    └─ pr-governance (conventional PR title = future squash commit)         │
└────────────────────────────────────────────────────────────────────────────┘
                                    │ squash-merge (title = conventional commit)
                                    ▼
┌ LANE 2 — TRUNK post-merge (every merge to main) ───────────────────────────┐
│ on: push → [main]        concurrency: per-ref, NO cancel (evaluate all)    │
│                                                                            │
│ changes ─┬─► docker build+push GHCR + Trivy  (sha-tagged, attested)        │
│          ├─► sbom (source, attested)                                       │
│          ├─► api-docs → publish DEVELOPMENT docs                           │
│          └─► matrix-tests (full vitest, PG+Redis) ⚡ parallel to docker    │
│ tests ───► release-please  · env: development (D2)                         │
│            · single config.json / manifest.json / CHANGELOG.md             │
│            · refreshes ONE Release PR — NO auto-merge (D1)                 │
│ docker+docs ─► deploy DEVELOPMENT (Railway; explicit env input) (D5)       │
│               └─► /readyz probe                                            │
│ any failure ─► ci-failure issue (kept)                                     │
└────────────────────────────────────────────────────────────────────────────┘
                                    │ human merges the Release PR  ★ SHIP
                                    ▼
┌ LANE 3 — RELEASE (post-merge tags it · release-deploy.yml ships it) ───────┐
│ post-merge (Lane 2 run on the release merge):                              │
│   release-please → tag vX.Y.Z + GitHub Release (created with the PAT —     │
│     a github.token-created release would NOT trigger the next workflow)    │
│   release-sbom → attach SBOM to the Release (exact tag_name output)        │
│                                                                            │
│ release-deploy.yml · on: release: published        (NEW — D7)              │
│   pinned to the RELEASE TAG SHA — never github.sha (immune to the          │
│   post-merge pending-cancellation race, §9.1)                              │
│   → resolve the GHCR image for the tag sha (build only if that run was     │
│     queue-cancelled — otherwise D3 build-once, no rebuild)                 │
│   → publish PRODUCTION docs (Postman/Scalar)                               │
│   → deploy PRODUCTION · environment: production                            │
│        ├─ ⏸ required-reviewer approval (D4)                                │
│        └─ migrate → API → /readyz → worker                                 │
│   independently retryable: re-run the workflow, same tag, any time         │
│   (back-merge job DELETED — single branch)                                 │
└────────────────────────────────────────────────────────────────────────────┘

┌ LANE 4 — SCHEDULED / OPS ──────────────────────────────────────────────────┐
│ release guards: env/ruleset drift (wkly) + PAT canary (wkly)               │
│                 [ancestry guard DELETED]                                   │
│ codeql (push/PR main + cron) · chaos (target: main) · k6 SLO ·             │
│ restore drills · stryker · cleanup-cache/ghcr                              │
│ rollback-deploy (manual): production|development → both from main          │
│ hotfix old version (manual): post-merge-ci dispatch on release/X.Y ref     │
└────────────────────────────────────────────────────────────────────────────┘
```

**Runs-per-event scorecard**

| Event | Today | Target |
| --- | --- | --- |
| Feature merge | 1× post-merge on dev (build, test, dev-release-PR auto-merge → *second* full post-merge run for the `-dev.N` tag, deploy dev) | 1× post-merge on main (build, test, Release-PR refresh, deploy dev) — **the auto-merge echo run disappears** |
| Release | promotion post-merge on main (build+test+deploy prod) **+** release-PR-merge post-merge (build+test+deploy prod again) + back-merge workflow + daily ancestry guard forever | **one** post-merge run (build, test, tag, deploy dev + deploy prod on approval) |
| Prod deploys per release | 2 (promotion + release merge) | 1 |
| Release channels maintained | 2 configs, 2 manifests, 2 changelogs | 1 each |

---

## 4. Per-file delta map

| File | Today | Target | Phase |
| --- | --- | --- | --- |
| `.github/release-please/config.dev.json` | prerelease dev channel | **delete** | 1 |
| `.github/release-please/manifest.dev.json` | `4.10.0-dev.31` | **delete** | 1 |
| `.github/release-please/config.json` | stable channel | keep (verify `prerelease:false`, `draft:false`) | 1 |
| `.github/release-please/manifest.json` | `4.8.1` | **keep `4.8.1`** (L3 — Release-As drives 4.10.0) | 1 |
| `CHANGELOG-dev.md` | dev-channel changelog | fold into `CHANGELOG.md`, **delete** | 1 |
| `package.json` | `4.10.0-dev.31` | `4.10.0` | 1 |
| `.github/workflows/post-merge-ci.yml` | push [dev, main]; channel-switched config/env; release-PR auto-merge; single branch-mapped deploy; back-merge dispatch | push [main]; fixed config; **no auto-merge**; release-please env→development; deploy-**development** only; matrix-tests un-serialized from docker (⚡ 1.15); back-merge job deleted; release-sbom by exact `tag_name` | 1 |
| `.github/workflows/release-deploy.yml` | — (new) | `on: release: published` — tag-sha-pinned production deploy + production docs publish (D7) | 1 |
| `.github/workflows/post-release-backmerge.yml` | main→dev back-merge | **delete** | 1 |
| `.github/workflows/scheduled-release-guards.yml` | ancestry + drift + PAT canary | ancestry job deleted; drift + canary kept; notify text updated | 1 |
| `.github/workflows/reusable-railway-deploy.yml` | env resolved from `target_branch` | add `github_environment` workflow_call input (takes precedence; branch mapping kept as fallback) | 1 |
| `.github/workflows/reusable-docker-build-trivy.yml` / `reusable-openapi-postman-publish.yml` / `reusable-vitest-postgres-redis.yml` | `target_branch` (main\|dev) | drop `dev` from dispatch choice lists — no functional change | 1 |
| `.github/workflows/pr-ci.yml` | PRs → [dev, main] | PRs → [main] | 1 |
| `.github/workflows/pr-docs-lane.yml` | PRs → [dev, main] | PRs → [main] | 1 |
| `.github/workflows/codeql.yml` | push+PR [dev, main] | push+PR [main] | 1 |
| `.github/workflows/rollback-deploy.yml` | production→main, development→dev | both environments → main | 1 |
| `.github/workflows/scheduled-chaos.yml` | default target branch `dev` | `main` | 1 |
| `.github/rulesets/dev.json` | active ruleset (squash+merge, 0 approvals) | **delete** (+ remove live ruleset via sync) | 2 |
| `.github/rulesets/main.json` | **merge-only**; 1 approval + code-owner + last-push approval; strict checks | **squash-only**; dev's review profile (D8); strict checks kept (D9); + linear-history | 2 |
| `tooling/setup/github/sync-config.ts` | expects `allowed_merge_methods: ['squash','merge']` (~line 240) | expects `['squash']` — mirror of main.json | 2 |
| `.github/rulesets/release.json` | — (new) | ~~protect `release/*` so the production env's protected-branches deploy policy admits hotfix deploys~~ **SUPERSEDED: removed — single-trunk hardening retired `release/*`; hotfixes fix-forward to `main`, `main.json` is the only ruleset** | 4 |
| `tooling/openapi/breaking/check-breaking-changes.ts` | baseline spec from hard-coded `origin/dev` | `origin/main` (else `pnpm docs:breaking` breaks on dev deletion) | 1 |
| `.github/actions/setup-project-identity/action.yml` | generated; bakes `PROTECTED_BRANCHES_JSON=["dev","main"]` | regenerated via `pnpm tool:generate-project-identity` after the setup.config.json edit | 2 |
| `tooling/setup/setup.config.json` | `defaultBranch: dev`, `protectedBranches: [dev, main]`; development env `branch: dev` | `defaultBranch: main`, `protectedBranches: [main]`; development env `branch: main` | **1** (moved — test-coupled, 1.26) |
| `src/shared/constants/project-identity.constants.ts` (generated) | `GIT_DEFAULT_BRANCH='dev'`, `PROTECTED_GIT_BRANCHES=['dev','main']`, `GIT_NON_PRODUCTION_BRANCH='dev'` | regenerated main-only; consumer semantics reviewed | 1 |
| `src/tests/unit/ci/*.policy.unit.test.ts` | mirror the dual-channel workflows/configs/rulesets | twins updated with each edit: release-please-manifests + post-merge-ci + sbom/unit-gate sweep (Phase 1); pr-rls-security-gate `['dev','main']`→`['main']` (Phase 2); new twin for release-deploy.yml | 1–2 |
| `.github/dependabot.yml` | follows default branch (dev); stale comment | follows main after the flip; fix comment | 2 |
| `.husky/pre-push` | allowlists `dev\|main` | `main` (+ `release/.*` in Phase 4); keep `claude/*`, type prefixes | 2 |
| `agent-os/rules/git-branch-naming.mdc` | dev+main long-lived | main only | 2 |
| `agent-os/commands/{open-pr,ship,merge-pr,build-requirement,README}.md` | PRs target dev | target main | 2 |
| `agent-os/commands/release-dev-to-production.md` | promotion command | **retire** (replacement: "merge the Release PR") | 2 |
| `.github/environments/production.json` | required reviewers + `deploymentBranchPolicy: protectedBranches` (rejects tag refs) | reviewers **unchanged** (D4); deploy policy → custom: branch `main` + **tag `v*`** (1.12b — else release-deploy is blocked) | 1 |
| `tooling/feature-flags/feature-flag-registry.json` | — (new) | release-flag registry: owner, remove_by, status (§8.5) | 3 |
| `src/tests/global/feature-flag-lifecycle.global.test.ts` | — (new) | CI expiry gate for `FEATURE_*` flags (§8.5) | 3 |
| `docs/process/feature-flags.md` | — (new) | lifecycle + flip runbook (§8.4) | 3 |
| `docs/process/git-workflow.md`, `docs/process/release-versioning.md`, `docs/deployment/ci-cd/branch-protection.md`, `docs/deployment/ci-cd/cicd-and-deployment.md`, `docs/deployment/runbooks/add-new-environment.md`, `CLAUDE.md` | dual-channel model | single-trunk rewrite | 5 |

---

## 5. Phased execution

### Phase 0 — Sync & freeze *(no PR — actions on the repo)*

- [x] **0.1** ✅ **DONE (2026-07-07):** #863 dependabot actions bump squash-merged into `dev` (`ad67fa1d`); no other open PRs target dev. Gate confirmed: `main ⊆ dev`, clean (no divergence). — Merge/close the open dev-based PRs to drain the queue
- [x] **0.2** ✅ **DONE (2026-07-07):** final promotion PR [#869](https://github.com/nikunjmavani/core-be/pull/869) `chore(release): promote dev to main (2026-07-07)` merged (merge commit `f9279b2c`) — user-approved under main's old code-owner rule. 58 commits, clean. Matrix was green on `ad67fa1d` pre-merge. — Final `dev → main` promotion, existing flow, one last time
- [ ] **0.3** Confirm the main post-merge run is green end-to-end (including the stable release it cuts and its production deploy approval)
- [ ] **0.4** Announce the merge freeze — **the freeze holds until cutover step ④ (Phase 2 sync) completes**: after Phase 1, PR CI only listens to PRs→main, but the default base is still dev, so a PR opened in the window would collect zero checks
- [x] **0.5** ✅ **DONE (2026-07-07):** no open release-please PRs / `release-please--branches--dev--*` branches on remote (verified); dependabot #863 drained (0.1). dependabot already follows `main` (live default flipped) so no new dev-based bumps expected. Re-check at the moment of promotion. — Close any open release-please PR targeting dev and delete its branch; re-check freshly-opened dependabot PRs
- [x] **0.6** ✅ **DONE (2026-07-07):** repo squash settings PATCHed to `squash_merge_commit_title=PR_TITLE` + `squash_merge_commit_message=PR_BODY` (verified via `gh api`). `allow_merge_commit` left `true` until Phase 2. — Fix the repo squash-message settings **before squash-only activates in Phase 2** (done here because it is a zero-risk early flip): was `squash_merge_commit_title=COMMIT_OR_PR_TITLE` (a single-commit PR squashes to the raw *commit* title — bypassing the pr-governance title gate) and `squash_merge_commit_message=COMMIT_MESSAGES` (PR-*body* footers like `Release-As:` / `BREAKING CHANGE:` are **dropped**). Set `gh api -X PATCH repos/<repo> -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY` — PR title + body become the sole, governed source of every trunk commit. (Keep `allow_merge_commit=true` until Phase 2 — the final promotion *and the Phase 1 PR itself* merge via merge commit under main's current merge-only rule)

**Gate:** `git rev-list --count origin/main..origin/dev` = 0 · no open PRs target dev · no open release-please PRs · main post-merge green.

### Phase 1 — Single release channel + CI rewiring *(1 PR — atomic by design)*

> Branch `ci/trunk-single-release-channel` · PR title `ci(release): collapse to single-trunk release channel`.
> ⚠️ **v1.3 sequencing correction:** main's *current* ruleset allows `["merge"]` only — this PR
> **cannot be squash-merged** (squash-only arrives with Phase 2). It merges via the existing merge
> method, so individual commits land verbatim on main. Therefore the baseline rides an
> **empty commit inside the PR branch**: `git commit --allow-empty -m "chore: set release baseline" -m "Release-As: 4.10.0"`
> — method- and settings-independent (L3). Also note: this PR needs **1 code-owner approval with
> last-push approval** under main's current review params — plan for the second account or a
> temporary rule edit (D8 relaxes this in Phase 2).

*Release-please collapse*

- [ ] **1.1** Delete `.github/release-please/config.dev.json`
- [ ] **1.2** Delete `.github/release-please/manifest.dev.json`
- [ ] **1.3** Verify `config.json`: `prerelease: false`, `draft: false` (already true today)
- [ ] **1.4** Fold `CHANGELOG-dev.md` history into `CHANGELOG.md` **as a clearly-marked "archived prerelease history" section**, then delete `CHANGELOG-dev.md`. Known + accepted: the generated v4.10.0 notes will re-list the same work as the stable rollup — prerelease archive and stable rollup coexist
- [ ] **1.5** Leave `manifest.json` at `4.8.1` (L3)
- [ ] **1.6** Set `package.json` version → `4.10.0`

*post-merge-ci.yml rewrite*

- [ ] **1.7** Trigger: `push: branches: [main]`
- [ ] **1.8** Remove `CHANNEL_SUFFIX`; hardcode `config.json` / `manifest.json`; `target-branch: main`
- [ ] **1.9** release-please job `environment:` → `development` (D2); fix the stale "no protection rules" comment; keep the PAT tripwire
- [ ] **1.10** **Delete the `Enable auto-merge on release PRs` step** (D1). Keep the CHANGELOG lint-fix step (single changelog now)
- [ ] **1.11** post-merge deploy becomes **`deploy-development` only** (every merge; explicit `github_environment: development`) — production deploy moves OUT of post-merge (D7)
- [ ] **1.12** **New `.github/workflows/release-deploy.yml`** — `on: release: published` (fires because releases are created with the PAT; the PAT tripwire now also guards prod deploys): pin everything to the **release tag sha**; resolve the GHCR image for that sha via `image_override`, calling `reusable-docker-build-trivy` first *only* if the image is missing (queue-cancelled-run case); publish production docs (Postman/Scalar); deploy with `github_environment: production` (reviewer approval, D4); `concurrency: release-deploy-production`, no cancel
- [ ] **1.12b** 🧨 **Production env must admit tag refs** — a `release: published` run executes on `refs/tags/vX.Y.Z`, and `production.json`'s current `deploymentBranchPolicy: { protectedBranches: true }` only admits protected *branches* → the environment would **reject the very first release deploy**. Change to custom policies: branch `main` **+ tag pattern `v*`** (also cleanly admits future hotfix tags from `release/X.Y`). Verify the core-infra `validate:github-environments` checker and `github:sync` can express tag policies — if not, extend them, or use the documented fallback: post-merge dispatches `release-deploy` via `workflow_dispatch` on `ref: main` with the tag as input (branch ref satisfies the policy; the checkout stays tag-sha-pinned)
- [ ] **1.13** api-docs in post-merge: development docs every merge (production publish now lives in `release-deploy.yml`)
- [ ] **1.14** release-sbom: resolve the release by the exact `tag_name` output (drop the `isPrerelease` filter and `gh release list` ordering). Accepted edge: if the release-merge run itself was queue-cancelled, the SBOM attach is skipped for that release — re-runnable manually
- [ ] **1.15** ⚡ Un-serialize `matrix-tests`: drop `sbom` + `docker-build-push` from its `needs` — the suite is source-based (Postgres/Redis services, never the image), so today it waits out the whole docker build for nothing. Post-merge wall-clock shrinks by the full build duration; release-please still gates on tests, deploys still gate on docker
- [ ] **1.16** Delete the `dispatch-post-release-backmerge` job; update `notify-failure` needs/matrix

*Companion workflow edits (same PR)*

- [ ] **1.17** Delete `.github/workflows/post-release-backmerge.yml`
- [ ] **1.18** `scheduled-release-guards.yml`: delete the `branch-ancestry` job + its cron entry + notify-body row; keep env-drift + PAT canary
- [ ] **1.19** `reusable-railway-deploy.yml`: add optional `github_environment` workflow_call input taking precedence in `resolve-environment`; drop `dev` from dispatch choices
- [ ] **1.20** `rollback-deploy.yml`: both targets resolve from `main`
- [ ] **1.21** `scheduled-chaos.yml`: default target branch → `main`
- [ ] **1.22** Retarget triggers to `[main]`: `pr-ci.yml`, `pr-docs-lane.yml`, `codeql.yml`
- [ ] **1.23** Sweep dispatch `choice` inputs listing `dev` in the reusables — remove the option
- [ ] **1.24** 🧨 `tooling/openapi/breaking/check-breaking-changes.ts`: baseline spec is generated from a **hard-coded `origin/dev` worktree** (lines 63-65 + header comment) — repoint to `origin/main`, else `pnpm docs:breaking` dies with a fetch error the moment dev is deleted
- [ ] **1.25** `:latest` GHCR tag semantics: `reusable-docker-build-trivy.yml:256` tags `:latest` only when `TARGET_BRANCH=main` — today that means "promoted/production-bound"; after migration it means **"tip of trunk"**. Verified safe: deploys pin sha-tagged refs, `:latest` is a convenience alias only. Document the new meaning; a release-time `vX.Y.Z`/`stable` retag is item 6.2

*Config + generated identity + policy-test twins (v1.4 — MUST ride this same PR)*

- [ ] **1.26** 🧨 **Moved in from Phase 2**: `tooling/setup/setup.config.json` git block → `defaultBranch: "main"`, `protectedBranches: ["main"]`, development environment `branch: "main"`; then run **`pnpm tool:generate-project-identity`**. Why here: `post-merge-ci.policy.unit.test.ts:15` asserts the post-merge trigger equals `branches: [<setup.config protectedBranches>]` — the workflow edit (1.7) and the config are **test-coupled**; and `ci:quality` runs `tool:generate-project-identity:check`, so the regenerated `.github/actions/setup-project-identity/action.yml` + `src/shared/constants/project-identity.constants.ts` must move together. (Phase 2 keeps only the LIVE-side flip via `github:sync`)
- [ ] **1.27** 🧨 **Update the CI policy-test twins in this PR** — the repo unit-tests its own CI config (`src/tests/unit/ci/*.policy.unit.test.ts`); every workflow/config edit above has a mirror that would otherwise fail this PR's own gate:
  - `release-please-manifests.policy.unit.test.ts` — asserts `prerelease-type: 'dev'` **on the config file 1.1 deletes**; rewrite for single-channel (stable config, single manifest, dev files absent)
  - `post-merge-ci.policy.unit.test.ts` — trigger ↔ protected-branches coupling (satisfied by 1.26)
  - `supply-chain-sbom.policy.unit.test.ts`, `pr-unit-gate-full-suite.policy.unit.test.ts`, and `ls src/tests/unit/ci/` for the full set — re-run after the workflow rewrite; grep the suite for `backmerge` / `ancestry` (deleted workflow + job)
  - add a twin for the new `release-deploy.yml` (house culture: new workflow ⇒ new policy test)
- [ ] **1.28** Generated-constants semantics: `project-identity.constants.ts` regenerates with `GIT_DEFAULT_BRANCH='main'`, `PROTECTED_GIT_BRANCHES=['main']`, and `GIT_NON_PRODUCTION_BRANCH` collapsing to `'main'` (the "non-production branch" concept dies in single-trunk) — grep consumers of all three and adjust call sites/TSDoc where the *semantic*, not just the value, changed
- [ ] **1.29** `actionlint` + `pnpm ci:local` green on the PR (this now exercises the rewritten policy tests too)
- [ ] **1.30** Commit **this plan file** in the PR (it documents the change and ends the untracked-loss exposure; the docs-index entry follows in Phase 5). `SESSION.md` stays untracked — working file only

*Adaptive post-merge lanes — PR-gate authoritative (D10, user-approved 2026-07-07)*

> Replaces the piecemeal C1–C4 dedup with the structural fix. Because strict up-to-date (D9) + squash
> means the merge-commit tree == the tested PR tree, the PR gate becomes **authoritative** and the
> post-merge lane goes **fast** for the single-PR common case. §10 has the full workflow-graph trace.

- [ ] **1.31 Make the PR gate authoritative** — move the full DB-backed matrix (`--project e2e --project integration --project unit-db --project performance --project security`, PG+Redis) from post-merge onto `pr-ci.yml` so a PR proves the exact tree that squash-lands. Reuse `reusable-vitest-postgres-redis.yml` (already sharded) called from `pr-ci`. Keep `pr-ci` per-PR `cancel-in-progress` so only the tip push pays. This **subsumes C2 (unit) and C3 (RLS)** — they now run once, on the PR
- [ ] **1.32 Adaptive post-merge on `main`** — compute `N = commits in the push` (`git rev-list --count ${{ github.event.before }}..${{ github.sha }}`; fall back to full lane if `before` is all-zeroes/forced). **`N==1` FAST lane:** `docker-build-push` → `release-please` → `deploy-development` (no matrix — the PR already proved it). **`N>=2` FULL lane:** run the matrix first (combined tree of batched/merge-queue PRs was never tested together), then build → release → deploy. Gate the `matrix-tests` job on `if: N>=2`; ensure `release-please`/`deploy` `needs` tolerate a skipped matrix on the fast path (skipped ≠ failed)
- [ ] **1.33 CodeQL once (C1)** `codeql.yml`: keep `pull_request` + weekly `schedule`; **drop the `push` trigger** (today the ~30-min analysis runs on both PR head and merge commit). Update the codeql policy twin if one asserts the trigger set
- [ ] **1.34 Docker cache alignment (C4)** drop the `-pr` cache-scope suffix in `pr-ci.yml` `build-verify` (API + worker buildx) so the FAST-lane post-merge build is a warm cache hit, not a cold rebuild
- [ ] **1.35 Harden the flaky coverage gate** — `Matrix Tests / Coverage` (`validate-route-success-coverage`) failed on `main` while the *identical* tree passed on `dev` (capture-based: a route's observed record is dropped when its shard is flaky/slow). Make it deterministic (require all shard observed-artifacts present before judging, or make missing-artifact a hard error not a silent uncovered-count) so it can't intermittently skip `release-please`. Root-caused during Phase 0.3
- [ ] **1.36 Policy twins for the lane change** — update/add `src/tests/unit/ci/*.policy.unit.test.ts` for: the moved matrix on `pr-ci`, the `N`-gated post-merge lanes, the CodeQL trigger set. New behavior ⇒ new/updated twin (house culture)

**Deferred:** none from the CI set now — Option A (D10) folds the former C2 (item 6.8) into 1.31. 6.8 is retired.

**Gate:** after merge, the post-merge run on main is green and a Release PR
**`chore: release 4.10.0`** exists previewing the full changelog since v4.8.1 (~2 release-lines of
commits — GitHub may truncate the PR *body*; the `CHANGELOG.md` diff in the PR is the source of
truth). **Do not merge it yet.**

### Phase 2 — Retire dev, protect main *(1 PR + `pnpm github:sync`)*

> Branch `chore/retire-dev-branch` · squash title `chore(git): retire dev — main is the only long-lived branch`.

- [ ] **2.1** ~~setup.config.json git block + identity regen~~ → **done in Phase 1 (items 1.26–1.28, test-coupled)**. Here: verify only — `pnpm tool:generate-project-identity:check` green, committed config says main-only
- [ ] **2.2** Reconcile `main.json` (verified live params, not guesses):
  - `pull_request.allowed_merge_methods`: `["merge"]` → **`["squash"]`**
  - `pull_request` review params: adopt dev's profile per **D8** (`required_approving_review_count: 0`, `require_code_owner_review: false`, `require_last_push_approval: false`, `dismiss_stale_reviews_on_push: false`; keep `required_review_thread_resolution: true`) — main's current 1-approval + code-owner + last-push params are promotion-gate settings that would lock a solo maintainer out of every merge
  - `required_status_checks`: verify the context list matches dev.json's (they already look identical — confirm the tails); **keep `strict_required_status_checks_policy: true`** (D9)
  - add `required_linear_history`; keep signatures + non-fast-forward + deletion; then delete `dev.json`
  - 🧨 **update `pr-rls-security-gate.policy.unit.test.ts:59` in the SAME PR** — it runs `describe.each(['dev', 'main'])` over the committed rulesets; deleting `dev.json` without shrinking it to `['main']` fails this PR's own gate (v1.4)
  - align the `allowed_merge_methods` expectation in `tooling/setup/github/sync-config.ts` (line ~240 hardcodes `['squash','merge']` — another mirror)
  - flip the repo-level toggle `allow_merge_commit=false` (deferred from 0.6 — the final promotion and the Phase 1 PR needed it)
- [ ] **2.3** `.github/dependabot.yml`: fix the default-branch comment
- [ ] **2.4** `.husky/pre-push`: allowlist `main|claude/.*|<type>/.*` (drop `dev`); update help text
- [ ] **2.5** `agent-os/rules/git-branch-naming.mdc`: main is the only long-lived branch
- [ ] **2.6** Repoint agent-os commands to main: `open-pr`, `ship`, `merge-pr`, `build-requirement`, `README`; retire `release-dev-to-production` (leave a pointer: "merge the Release PR"). While touching them, verify every merge instruction says **squash** (`dependabot-auto-merge.yml` already uses `--squash` ✓) — and run the agent-os gates locally: **`pnpm agent-os:check && pnpm agent-os:triggers:strict && pnpm agent-os:generate:check`** (integrity/counts/adapters re-validate after the command deletion; only `commands/README.md` references it — grep-verified)
- [ ] **2.7** Merge the PR, then run `pnpm github:sync --check` → review → `pnpm github:sync` (pushes default branch, rulesets, environments)
- [ ] **2.7b** 🧨 **Manually delete the live "Protect dev" ruleset** — `tooling/setup/github/rulesets.ts` has **no delete path** (create/update only, grep-verified), so the orphaned live ruleset survives the sync… and its `deletion` rule **blocks removing the dev branch**. `gh api repos/<repo>/rulesets --jq '.[] | select(.name=="Protect dev") | .id'` → `gh api -X DELETE repos/<repo>/rulesets/<id>`. (The weekly drift guard only checks committed→live, so the orphan would never be flagged)
- [ ] **2.8** Verify no open PRs still target dev, then **archive/delete the `dev` branch** (unblocked by 2.7b)
- [ ] **2.9** Dispatch the env-drift guard (`workflow_dispatch`) — confirm rulesets/environments clean

**Gate:** default branch = main (`gh repo view`) · dev branch gone · drift guard green · a trial PR
merges to main via squash only.

### ★ First trunk release *(cutover step ⑥ — validates Lane 3 end-to-end)*

- [ ] **R.1** Merge the **`chore: release 4.10.0`** Release PR
- [ ] **R.2** Watch the post-merge run: tag `v4.10.0` + GitHub Release + SBOM attached
- [ ] **R.3** Confirm `release-deploy.yml` fired on the release event (proves the PAT path), then approve the production deployment (environment gate) → `/readyz` green
- [ ] **R.4** Confirm the deployed image digest equals the sha-tagged image from the merge build (D3)

**Gate:** `v4.10.0` live in production; release notes cover v4.8.1→v4.10.0.

### Phase 3 — Feature-flag operating model *(1 small PR — full deep dive in §8)*

> Branch `feat/feature-flag-lifecycle-gate` · squash title `feat(tooling): feature-flag registry + CI expiry gate`.

- [ ] **3.1** Adopt the `FEATURE_<NAME>_ENABLED` naming class for **release flags** (§8.2) — the prefix *is* the classification; the existing 42 ops/policy/mode flags keep their names, exempt from expiry
- [ ] **3.2** Create `tooling/feature-flags/feature-flag-registry.json` — `{ flag, owner, ticket, introduced, remove_by, status, description }` per release flag (§8.5)
- [ ] **3.3** Add `src/tests/global/feature-flag-lifecycle.global.test.ts` — the CI expiry gate (§8.5 rules; same family as the tsdoc/route-coverage ratchets)
- [ ] **3.4** Write `docs/process/feature-flags.md` — lifecycle + flip runbook (§8.4)
- [ ] **3.5** Process rule: every flag **flip** updates the registry `status` in a tiny PR — the git-tracked audit trail (values live in gitignored `.env.<environment>` / GitHub Environments)
- [ ] **3.6** Document `PERSONAL_ORGANIZATION_ENABLED` / `TEAM_ORGANIZATION_ENABLED` as **mode flags** (permanent, cross-flag `.refine`) — the exempt precedent

**Gate:** `pnpm test:global` green with the new gate active; an intentionally-expired fixture entry fails it.

### Phase 4 — Hotfix runbook *(runbook + two small affordances)*

- [ ] **4.1** Normal urgent fix: `fix:` PR → main → merge the Release PR → approve prod deploy. No extra branch
- [ ] **4.2** Old-version patch: `git switch -c release/X.Y vX.Y.0` (short-lived, **never merged back**; cherry-pick one-way)
- [ ] **4.3** CI affordance: post-merge-ci `workflow_dispatch` accepts a `release/X.Y` ref + release-please `target-branch` so it can cut `X.Y.(Z+1)` on that branch
- [ ] **4.4** Governance affordance: add `.github/rulesets/release.json` protecting `release/*` (branch-quality gates for hotfix work) + admit `release/.*` in `.husky/pre-push`. Note: the production env admits hotfix *deploys* via the `v*` **tag** policy from 1.12b — the ruleset here is about protecting the branch, not unblocking the deploy

**Gate:** dry-run documented (no live release/X.Y branch needed until a real hotfix).

### Phase 5 — Docs, rules, sweep *(1 PR)*

> Branch `docs/single-trunk-model` · squash title `docs(process): rewrite branching/release/CI docs for single trunk`.

- [ ] **5.1** Rewrite `docs/process/git-workflow.md` (single trunk, squash-only, flags-not-branches)
- [ ] **5.2** Rewrite `docs/process/release-versioning.md` (stable-only; Release PR = ship button)
- [ ] **5.3** Rewrite `docs/deployment/ci-cd/branch-protection.md` (main-only ruleset + required-check list) and `docs/deployment/ci-cd/cicd-and-deployment.md` (the §3 lane model)
- [ ] **5.4** Update `docs/deployment/runbooks/add-new-environment.md` (environment ≠ branch; explicit `github_environment` input)
- [ ] **5.5** Update `CLAUDE.md` branch/release/CI sections; publish the §7 cheat-sheet; cross-link `feature-flags.md`
- [ ] **5.6** Completeness sweep: `grep -rn '\bdev\b' .github/ agent-os/ docs/ tooling/ CLAUDE.md .husky/ README.md` — no stale mirror survives (change-completeness rule); this plan file graduates to a linked process doc
- [ ] **5.7** Cheat-sheet includes the **contributor local-clone migration snippet**: `git fetch --prune && git remote set-head origin -a && git switch main && git branch -D dev` (stale local `dev` otherwise lingers on every machine) — plus: rebase any in-flight feature branch onto `main` (`git rebase --onto origin/main origin/dev <branch>` if it was cut from dev)

**Gate:** sweep returns only intentional hits (e.g. "development environment") · docs index updated · `pnpm ci:local` green.

### Phase 6 — Post-cutover backlog *(optional, separate small PRs)*

- [ ] **6.1** Promote `RELEASE_PLEASE_TOKEN` to a repo-level secret; simplify the weekly canary (removes the D2 indirection — and stops the release-please job from stamping a spurious "development deployment" record on every trunk merge, which the `environment: development` PAT-read causes)
- [ ] **6.2** Retag the release image `ghcr.io/...:vX.Y.Z` (traceability alias for the sha tag) in a small post-release job
- [ ] **6.3** Revisit D4: drop the production reviewer gate once cadence-merge feels safe (one click per release instead of two)
- [ ] **6.4** GitHub merge queue when concurrent PR volume warrants (L4)
- [ ] **6.5** Tier-2 runtime flags (§8.1): only when a flag needs **percentage rollout or per-org targeting** — `posthog-node` (already a dependency) with local evaluation behind a small port; until then YAGNI
- [ ] **6.6** Monthly scheduled flag-age report (`FEATURE_*` + days-to-remove-by → ci-failure-style issue) — only if the CI gate alone proves too late-loud
- [ ] **6.7** Environment-keyed deploy concurrency: `reusable-railway-deploy.yml`'s group includes the sha (`railway-deploy-<branch>-<sha>`), so two dispatches can race on one Railway environment. Post-merge runs are already serialized per-ref, so exposure is manual-dispatch-only — re-key to `railway-deploy-<environment>` (no cancel) as cheap hardening
- [x] **6.8 (C2) — SUPERSEDED by D10.** The duplicated `unit`+`global` run is eliminated structurally by the adaptive-lanes model (item 1.31 moves the authoritative suite to the PR gate; the post-merge FAST lane runs no tests). No separate work item remains

---

## 6. Cutover order (each step reversible)

```text
 ⓪  PRE-STAGE  build + review the Phase 1 branch DAYS BEFORE the freeze     [v1.4 ⚡]
               (it is the big PR: workflows + config + identity + policy tests;
                rebase onto main after the promotion — the freeze then only
                covers promote → merge → flip, hours not days)
 ①  Phase 0    drain dev PRs → final dev→main promotion → freeze
 ②  Phase 1    merge the CI/release PR (Release-As rides its empty commit)
 ③  verify     Release PR "chore: release 4.10.0" appears, previews v4.8.1→4.10.0
 ④  Phase 2    PR + pnpm github:sync → default branch = main
 ⑤  Phase 2    delete live "Protect dev" ruleset (2.7b) → archive the dev branch
 ⑥  RELEASE    merge the 4.10.0 Release PR → release-deploy.yml fires →
               approve production deploy    ★ first trunk release = the
               end-to-end validation of Lane 3
 ⑦  Phase 3    flag registry + expiry gate
 ⑧  Phase 4/5  hotfix affordances + docs sweep
```

## 7. Risks & rollback

| Risk | Mitigation |
| --- | --- |
| In-flight dev work stranded | Phase 0 drain + final promotion first (gate: `rev-list` count = 0) |
| Every merge deploys production by accident | Lane split is explicit: prod deploy `if: releases_created` **+** env reviewer approval — D1 and D4 must *both* fail for an accident |
| Release-PR refresh blocked by prod env approval | D2 (release-please reads the PAT via `environment: development`) — verified against committed `production.json` |
| Version discontinuity | `Release-As: 4.10.0` on the in-branch empty commit (L3, Phase 1 header) — merge-method- and squash-setting-independent |
| Ruleset/env drift after cutover | Weekly drift guard retained + manual dispatch at 2.9 |
| Muscle memory targets dev | Phase 2 repoints commands/hooks; the branch is archived so pushes fail loudly; Phase 5 docs |
| Hotfix deploy refused by env branch policy | Phase 4.4 `release/*` ruleset (found during planning — the protected-branches deploy policy only admits protected branches) |
| PR opened in the Phase 1→2 window gets zero CI (base=dev, pr-ci listens to main) | Freeze explicitly holds until cutover step ④ (item 0.4) |
| `pnpm docs:breaking` breaks when dev is deleted | Item 1.24 — baseline worktree repointed from hard-coded `origin/dev` to `origin/main` |
| Stale generated identity gates GHCR pushes wrongly | Item 2.1b — regenerate `setup-project-identity` after editing `setup.config.json` |
| Release processed on a *later* run than the release merge (post-merge queue cancels intermediate pending runs) | D7 — `release-deploy.yml` on `release: published`, pinned to the tag sha; resolves-or-builds the tag image |
| PR-body footers (`Release-As:` / `BREAKING CHANGE:`) dropped at squash; single-commit PRs squash to ungoverned commit titles | Item 0.6 — repo squash settings → `PR_TITLE` + `PR_BODY` before squash-only activates |
| Solo maintainer locked out of merging (main requires code-owner approval + last-push approval) | D8 + 2.2 — adopt dev's 0-approval review profile at cutover; Phase 1 PR itself still needs one pass under the old rule (planned in the Phase 1 header) |
| First release deploy rejected by the production environment (tag ref vs protected-branches policy) | 1.12b — env deploy policy → branch `main` + tag `v*` (fallback: dispatch-on-main) |
| Update-branch treadmill under concurrent PRs (strict checks kept, D9) | Accepted serialization cost at current team size; the treadmill is the explicit trigger for the merge queue (6.4) |
| Phase 1/2 PRs fail their own CI (the repo unit-tests its CI config) | v1.4: policy-test twins updated in the same PRs (1.27, 2.2); config+identity moved into Phase 1 (1.26) to satisfy the coupling test |
| dev branch cannot be deleted (live ruleset `deletion` rule; sync never deletes rulesets) | 2.7b — hand-delete the live "Protect dev" ruleset first |
| Plan/SESSION files lost before commit (both are **untracked**; `git clean -fd` destroys them) | Commit this plan file with the Phase 1 PR (it documents the change); avoid `git clean` until then; the agent-memory entry preserves the pointer + key decisions |
| Dead flags accumulate (trunk-based debt) | §8.5 CI expiry gate — an overdue flag **fails the build**, not a ticket queue |
| Half-shipped feature exposed in production | Release flags default `'false'` statically — production is OFF **by omission** |
| Anything else | All config-as-code: revert the Phase 1/2 PRs + re-run `github:sync` to restore dual-channel |

---

## 8. Feature flags — trunk-based operating model (deep dive)

Trunk-based development moves incomplete work out of branches and behind flags — which makes
flag hygiene the load-bearing discipline. This section is grounded in what the repo already has:
**42 `booleanString` env flags**, the **env-schema-add** skill, `pnpm tool:sync-env-example`,
`pnpm github:sync`, and the deploy workflow's **GitHub-Environment→Railway variable mirror**
(`reusable-railway-deploy.yml` "Set Railway service variables"). The design adds **no new
dependencies and no new services** — one JSON file, one global test, one doc.

### 8.1 Tiering — why env-var flags, and when to graduate

| Option | Verdict | Rationale |
| --- | --- | --- |
| **Tier 1 — env-var `booleanString` flags** | ✅ **now** (all migration-era release gating) | Zero new deps. Boot-validated by Zod with a **static production-safe default** (`'false'`) — prod is dark by omission. Whole value chain already automated (§8.3). Flip = config-only redeploy, ~minutes (§8.4). Limitation accepted: per-environment all-or-nothing, needs a service restart |
| **Tier 2 — PostHog feature flags** (`posthog-node ^5.39.4` is *already* a dependency) | ⏳ later, trigger-gated (item 6.5) | Only when a flag needs **percentage rollout, per-org/per-user targeting, or flip-without-restart**. Local evaluation (polled definitions) keeps the hot path off the network. Wrap behind a tiny port so swapping a Tier-1 flag to Tier-2 changes one seam |
| LaunchDarkly / Unleash / Flagsmith / GrowthBook | ❌ rejected | New vendor + SDK + failure mode for a need PostHog already covers |
| DB/Redis-backed runtime flag table | ❌ rejected | Builds a second config system; Postgres is the source of truth for *domain* data, not deploy config; adds cache/consistency machinery for no current requirement |

### 8.2 Taxonomy — the prefix is the classification

```text
FEATURE_<NAME>_ENABLED          RELEASE FLAG   short-lived · booleanString('false')
                                               registry entry REQUIRED · expiry ENFORCED
everything else                 OPS / POLICY / MODE FLAG   permanent · exempt
(the existing 42: DLQ_AUTO_RETRY_ENABLED, METRICS_ENABLED, COOKIE_SECURE,
 PERSONAL_ORGANIZATION_ENABLED, ENABLE_MCP_SERVER, …)
```

- **Release flag** — hides an incomplete or unrolled feature so trunk stays releasable. Born with a
  `remove_by` date; *designed to die*.
- **Ops kill-switch / policy / mode flag** — permanent operational surface (existing pattern,
  unchanged). E.g. `PERSONAL_ORGANIZATION_ENABLED` + `TEAM_ORGANIZATION_ENABLED` are **mode flags**
  (deployment configuration with a cross-flag `.refine`) — not release flags, never expired.

One grep (`FEATURE_`) separates the classes — the expiry gate needs zero per-flag configuration
to know what it governs, and the 42 existing flags generate zero false positives.

### 8.3 The value chain (how a flag value reaches a running service — all existing rails)

```text
 src/shared/config/env-schema.ts      FEATURE_X_ENABLED: booleanString('false')
        │  gate: pnpm tool:sync-env-example (schema ⇄ template drift fails CI)
 .env.example                         dev value ACTIVE:  FEATURE_X_ENABLED=true
        │  operator copies into gitignored per-env files
 .env.development / .env.production   (root-only, gitignored)
        │  pnpm github:sync            classifyKey() → GitHub *Variable* (flags aren't secrets)
 GitHub Environment {development | production}
        │  deploy workflow step "Set Railway service variables"
        │  (mirrors the ENTIRE GitHub Environment → API + worker services)
 Railway service variables ──► process.env at boot ──► Zod parse ──► envConfig.FEATURE_X_ENABLED
```

Two properties fall out of this chain:

1. **Prod-safe by omission** — the static `'false'` default means an unset production value is OFF;
   nobody has to remember to disable anything.
2. **Flip ≙ config-only redeploy** — changing a GitHub Environment variable and re-running the
   deploy (same image, `image_override`/sha) restarts the service with the new value. **No rebuild,
   no release, no code change.**

### 8.4 Lifecycle — stages, exact mechanics, and who clicks what

```text
 CREATE ──► DARK SHIP ──► BAKE dev ──► FLIP PROD ──► BAKE prod ──► DELETE
 (in the    (merge PR;    (dev env ON   (config-only  (1–2          (removal PR
 feature    prod OFF by   via trunk     redeploy +    releases;     before
 PR)        omission)     deploys)      env approval) kill-switch   remove_by)
                                                      ready)
```

| Stage | Actions (all existing commands) |
| --- | --- |
| **CREATE** (same PR as the first slice) | ① `env-schema-add` skill: `FEATURE_X_ENABLED: booleanString('false')` in `env-schema.ts` ② registry entry (`status: dark`, `remove_by` = introduced + 60d default) ③ `.env.example`: `FEATURE_X_ENABLED=true` ACTIVE in the policy-flags section (dev boxes get the feature) ④ `src/tests/setup.ts` `??=` if tests exercise the ON path ⑤ **one guard seam** (below) |
| **DARK SHIP** | Squash-merge to main. Production: OFF (static default — no action). Development env: set `FEATURE_X_ENABLED=true` in `.env.development` → `pnpm github:sync` → the **next trunk merge's dev deploy mirrors it in** (or dispatch a deploy to apply now) |
| **BAKE dev** | Feature live in the development environment on every trunk deploy; e2e/api-smoke exercise it (test harness runs dev values) |
| **FLIP PROD** | ① `gh variable set FEATURE_X_ENABLED --env production --body true` *(or edit `.env.production` + `pnpm github:sync`)* ② dispatch `reusable-railway-deploy` → `target: production`, current release image → **environment reviewer approves** (D4) → variables mirrored, service restarts ③ tiny PR: registry `status: production-on` (audit trail) |
| **BAKE prod** | 1–2 releases. **Kill-switch:** flip the variable back + same config-only redeploy — rollback in minutes, no `git revert`, no release |
| **DELETE** | Removal PR before `remove_by` — recipe in §8.6. CI enforces the deadline (§8.5) |

**Guard-seam conventions** — gate at *composition points*, never scattered per-request `if`s:

| Seam | Pattern (house example) |
| --- | --- |
| Route registration | `if (envConfig.FEATURE_X_ENABLED) await app.register(xRoutes)` — cf. the `ENABLE_MCP_SERVER` dynamic-import gate in `src/app.ts` |
| Container wiring | swap/no-op a service implementation in `<domain>.container.ts` |
| Worker/scheduler registration | register the processor or repeatable job conditionally in `queue/bootstrap.ts` / `scheduler.ts` |
| Behavior fork inside a service | pass the flag as a constructor/options value — the service stays testable with both values |

One flag ⇒ **one primary seam**. If a flag needs guards in 4+ places, the slice is cut wrong —
re-slice the feature, don't multiply guards.

### 8.5 Registry + CI expiry gate — flags that fail the build instead of rotting

`tooling/feature-flags/feature-flag-registry.json` (same family as `tooling/tsdoc-coverage/budget.json`
and `tooling/route-coverage/route-success-coverage-budget.json`):

```json
{
  "flags": [
    {
      "flag": "FEATURE_X_ENABLED",
      "owner": "nikunjmavani",
      "ticket": "#<issue>",
      "introduced": "2026-07-15",
      "remove_by": "2026-09-15",
      "status": "dark",
      "description": "Gates the X feature until org-targeting slice lands"
    }
  ]
}
```

`src/tests/global/feature-flag-lifecycle.global.test.ts` asserts:

| # | Rule | Failure means |
| --- | --- | --- |
| 1 | Every `FEATURE_*` key in `env-schema.ts` has a registry entry — and every entry has a schema key | Unregistered flag / ghost entry |
| 2 | Release-flag default is `'false'` | Not prod-safe by omission |
| 3 | `.env.example` carries the dev value ACTIVE | Dev boxes silently diverge |
| 4 | `today < remove_by` | **Flag is overdue — the build stays red until the removal PR (§8.6) or a justified `remove_by` extension (itself a reviewable diff)** |
| 5 | `status` ∈ `dark · development-on · production-on · removing` | Audit trail intact |
| 6 | Soft warning at `remove_by − 14d` | Two-week runway before rule 4 bites |

This converts the classic trunk-based failure mode ("we'll clean the flag up later") from a ticket
nobody reads into a **red CI that names the flag, the owner, and the recipe**.

### 8.6 Deletion recipe — one PR: `refactor(flags): remove FEATURE_X_ENABLED`

1. **Code**: inline the ON path; delete the OFF branches, the seam guard, and OFF-path tests
2. **Schema**: remove the key from `env-schema.ts` (+ any `.refine` touching it) — the
   env-schema-add skill's *remove* flow covers 2–4
3. **Template**: remove from `.env.example` (`pnpm tool:sync-env-example` verifies)
4. **Registry**: remove the entry (gate rule 1 verifies no ghost)
5. **Environments**: delete from `.env.development` / `.env.production`, then
   `gh variable delete FEATURE_X_ENABLED --env development` / `--env production`
6. **Railway**: nothing required — the schema no longer reads the key, so a stale mirrored variable
   is inert; prune opportunistically
7. **Tests/docs sweep**: `grep -rn FEATURE_X_ENABLED src/ docs/ tooling/ .env.example` → zero hits

### 8.7 Why this shape is the efficient one

- **Zero new infrastructure** — every stage rides a rail that already exists and is already gated
  (`booleanString` + `.refine`, `tool:sync-env-example`, `github:sync`, the deploy-time variable
  mirror, the global-test culture)
- **Flips are minutes, not releases** — same scanned image, config-only redeploy, env approval as
  the safety valve; **rollback is a flip, not a revert**
- **Safety is structural** — prod-dark-by-omission (static default) + boot-time Zod validation
  (typo'd value fails startup loudly, not silently)
- **Cleanup is enforced, not aspirational** — the registry + expiry gate is the mechanical answer to
  "dead flags are the one real trunk-based debt"
- **Total new artifacts: 3** — one JSON registry, one global test, one runbook doc

---

## 9. Second-order impact audit — everything else that touches the branch name, version shape, or merge method

Systematic sweep of consumers the phases didn't originally cover. Two buckets: **fixes folded into
the plan** (each now has an item) and **verified safe** (checked against the actual file — no action).

### 9.1 Fixes folded in (v1.1)

| Found | Blast radius if missed | Fixed by |
| --- | --- | --- |
| **Post-merge queue race**: the concurrency group keeps one running + the *newest* pending run — intermediate pending runs are cancelled. If the release-merge run is cancelled, a later run's release-please tags the release, `releases_created` fires with a `github.sha` **beyond the tag**, and the tag sha's image may never have been built | Production deploys untagged commits — or has no image to deploy | D7 + 1.12 (`release-deploy.yml`, tag-sha-pinned, resolve-or-build) |
| **Repo squash settings** (verified live): `squash_merge_commit_message=COMMIT_MESSAGES` drops PR-*body* footers (`Release-As:`, `BREAKING CHANGE:`); `squash_merge_commit_title=COMMIT_OR_PR_TITLE` lets a single-commit PR squash to its raw commit title, bypassing pr-governance | The Phase 1 `Release-As: 4.10.0` footer silently vanishes → wrong baseline; breaking-change majors silently missed; ungoverned commit titles on trunk | 0.6 (`PR_TITLE` + `PR_BODY`) + 2.2 (`allow_merge_commit=false` after the last promotion) |
| **main's ruleset is merge-only today** (`allowed_merge_methods: ["merge"]`) | The plan's original "squash-merge Phase 1 with the Release-As footer" is *impossible* — the merge button wouldn't offer squash | Phase 1 header rewritten: merge via the current method; `Release-As` rides an **empty commit in the PR branch** (method-independent) |
| **main's review params lock out a solo maintainer** (1 approval + code-owner review + `require_last_push_approval`, CODEOWNERS exists) | After cutover, *no PR can merge* — you cannot approve your own last push; the Release PR stalls too | D8 + 2.2 (adopt dev's 0-approval profile; re-tighten when a second reviewer exists) |
| **production env branch policy rejects tag refs** (`protectedBranches: true`) | The v1.2 `release-deploy.yml` (runs on `refs/tags/vX.Y.Z`) is blocked by the environment on the **first release** | 1.12b (custom policy: branch `main` + tag `v*`; dispatch-on-main fallback documented) |
| `sync-config.ts` hardcodes `allowed_merge_methods: ['squash','merge']` as the expected ruleset shape | Consistency checker drifts from the squash-only ruleset | 2.2 (align the mirror) |
| **The repo unit-tests its own CI config** (`src/tests/unit/ci/*.policy.unit.test.ts`): `release-please-manifests` asserts `prerelease-type: 'dev'` on the file Phase 1 deletes; `post-merge-ci` couples the trigger to `setup.config.json`; `pr-rls-security-gate` iterates `['dev','main']` rulesets | **Phase 1 and Phase 2 PRs fail their own PR gate** — the migration is blocked by the repo's change-completeness culture itself | 1.26–1.28 (config+identity into Phase 1) + 1.27 + 2.2 (test twins updated in-PR) |
| Generated runtime constants (`project-identity.constants.ts`): `GIT_DEFAULT_BRANCH='dev'`, `GIT_NON_PRODUCTION_BRANCH='dev'`, `PROTECTED_GIT_BRANCHES=['dev','main']`; drift-gated by `tool:generate-project-identity:check` in `ci:quality` | Stale constants in `src/`; "non-production branch" concept silently loses meaning | 1.26 + 1.28 |
| `github:sync` rulesets have **create/update only — no delete** (grep-verified); weekly drift guard checks committed→live only | Orphaned live "Protect dev" ruleset survives forever and its `deletion` rule **blocks archiving the dev branch** | 2.7b (hand-delete via `gh api -X DELETE`) |
| Phase 1 PR is large and was scheduled *inside* the freeze | Freeze balloons from hours to days | Cutover step ⓪ ⚡ — pre-stage + review the branch before the freeze; rebase after promotion |
| `check-breaking-changes.ts` hard-fetches `origin/dev` for the oasdiff baseline | `pnpm docs:breaking` (local mirror of the CI gate) dies with a git fetch error the moment dev is deleted | 1.24 |
| `setup-project-identity/action.yml` is *generated* and bakes `PROTECTED_BRANCHES_JSON=["dev","main"]` (gates GHCR pushes) | Stale generated mirror after the setup.config.json edit — works by accident, drifts silently | 2.1b |
| `matrix-tests` needlessly serialized behind the docker build + sbom (`needs:`) though it never consumes the image | Every trunk merge pays the full docker-build duration before tests even start — slower release-PR refresh, slower dev deploys | ⚡ 1.15 (parallelize) |
| `:latest` GHCR tag changes meaning (promoted build → tip of trunk) | Anything pulling `:latest` expecting production-grade gets trunk tip | 1.25 (document) + 6.2 (release retag) |
| Phase 1→2 window: PRs default to base=dev while pr-ci listens to main only | A PR opened in the window collects zero checks | 0.4 (freeze holds through step ④) |
| Open dev-channel release-please PR / stale `release-please--branches--dev--*` branch at cutover | Orphaned auto-merge PR against a dying branch | 0.5 |
| CHANGELOG fold + v4.10.0 regeneration list the same work twice | Confusing duplicate-looking changelog | 1.4 (archive section framing, accepted) |
| Contributor clones keep a dead local `dev` | Daily `git pull` friction on every machine | 5.7 (cheat-sheet snippet) |
| Agent-os command docs may instruct non-squash merges | Ruleset rejects the merge method | 2.6 (verify while repointing) |

### 9.2 Verified safe — checked, no action needed

| Consumer | Why it survives |
| --- | --- |
| **Sentry** | `release` = `RAILWAY_GIT_COMMIT_SHA` (commit sha, **not** the package version — version-shape change irrelevant); `environment` = `SENTRY_ENVIRONMENT ?? NODE_ENV` distinguishes dev/prod deploys of the same version |
| **dependabot-auto-merge** | already `gh pr merge --auto --squash` — compatible with squash-only rules |
| **dependabot targeting** | no `target-branch` override → follows the default branch → auto-repoints on the flip |
| **README badges** | no CI/branch-pinned badges (shields are static: Node/TS/pnpm/Fastify/License) |
| **SonarQube (local gate)** | `sonar-project.properties` has no branch/new-code reference configuration |
| **Scheduled workflows** (k6, restore drills, stryker, cleanups, codeql cron) | `schedule:` runs on the default branch → auto-repoint on the flip; no hard-coded dev refs (grep-verified) |
| **Production deploys** | pin sha-tagged GHCR refs via `image_override`/deploy tooling — never `:latest` |
| **GHA cache scopes / cleanup-cache / cleanup-ghcr** | keyed by image/scope names from project identity, not branch names (grep-verified) |
| **pr-governance** | base-ref logic already falls back to `main` |
| **Old `-dev.N` tags + prerelease GitHub Releases** | inert history; release-sbom now resolves by exact `tag_name` (1.13), never scans the prerelease list |
| **Neon / Railway / S3 / Resend / Stripe** | all environment-keyed (GitHub Environment → variable mirror), zero branch awareness |
| **Version-string as build identifier** | `/healthz` deliberately hides version/sha (sec-C4 minimal body); deployed-build identification is already **sha-based** — Sentry `release` = `RAILWAY_GIT_COMMIT_SHA`, plus Railway deploy metadata. Dev env reporting the last stable version between releases loses nothing |
| **Release-PR refresh CI storms** (every trunk merge force-pushes the Release PR → PR CI re-runs) | `pr-ci` concurrency is per-PR with `cancel-in-progress: true` — refresh runs collapse to the latest, which must be green to merge anyway |
| **Post-merge "latest-wins" queueing** (intermediate pending runs cancelled) | Intentional efficiency: testing is cumulative (run N+1 covers run N's commits), release-please recomputes from all unreleased commits — and D7 removes the one thing that *couldn't* tolerate it (prod deploy) |
| **CODEOWNERS file** | Branch-agnostic content; its *enforcement* came from main's `require_code_owner_review` param, which D8 turns off — the file stays as documentation/review-routing |
| **`strict` up-to-date checks + the Release PR** | release-please force-pushes the Release PR on every trunk merge, so it is always current — strict mode never stalls it |
| **Commitlint (`.husky/commit-msg`)** | Local-commit hygiene only; the governed surface is the PR title/body (0.6 + pr-governance) — no conflict, keep it |

### 9.3 Out-of-repo coordination (not plan items — heads-up list)

- **core-fe**: no API URL changes (environments survive) — but any core-fe automation/doc referencing the core-be `dev` *branch* (PR templates, contribution docs) needs a one-line update; its own branching model is a separate decision.
- **Claude Code web environments / agent tooling docs** (`docs/integrations/claude-code-web-environment.md`): cloud sessions branch from the default branch — auto-correct after the flip; sweep 5.6 catches the doc text.
- **Agent session memory** (Claude/Cursor): stored workflow facts like "PRs always target dev" must be refreshed post-cutover so agents don't open PRs against a deleted branch.
