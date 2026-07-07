# Release versioning (conventional commits → release-please)

How a version number is chosen and a release is cut in core-be. You never set the version by hand: the
**conventional-commit prefix** on each squash-merged PR decides the bump, and
**[release-please](https://github.com/googleapis/release-please)** does the math and keeps one Release PR
open. **Merging that PR cuts the release.**

Single-trunk model: one stable channel on `main` (no `-dev.N` prereleases, no dual manifest). For
branch naming and the PR flow see [trunk-based-workflow.md](trunk-based-workflow.md); for CI/CD see
[cicd-and-deployment.md](../deployment/ci-cd/cicd-and-deployment.md).

---

## The version bump

Each squash commit's conventional prefix (the PR title) drives the next version:

| Prefix | Bump | Example |
| --- | --- | --- |
| `fix:` | patch | 4.10.0 → 4.10.1 |
| `feat:` | minor | 4.10.0 → 4.11.0 |
| `feat!:` / `fix!:` / `BREAKING CHANGE:` footer | major | 4.10.0 → 5.0.0 |
| `chore:` / `ci:` / `docs:` / `test:` / `build:` / `style:` | none | (rolls into the next release's changelog) |

To force a specific version, put a `Release-As: X.Y.Z` footer in the PR body (the squash settings are
`PR_TITLE` + `PR_BODY`, so the footer survives).

## The single config

| File | Role |
| --- | --- |
| [`.github/release-please/config.json`](../../.github/release-please/config.json) | stable channel (`prerelease: false`, `draft: false`) |
| [`.github/release-please/manifest.json`](../../.github/release-please/manifest.json) | last released version (release-please's source of truth) |
| [`CHANGELOG.md`](../../CHANGELOG.md) | the single changelog (the old `-dev.N` history is archived at the bottom) |

## The flow

1. PRs squash-merge into `main`. On each merge, post-merge CI's `release-please` job (which reads its
   PAT via the **development** GitHub Environment) refreshes one open **`chore: release X.Y.Z` Release
   PR** whose diff previews the version bump + changelog. It is **not** auto-merged.
2. **Merge the Release PR** — the ship button. release-please tags `vX.Y.Z`, publishes a GitHub Release
   (created with the PAT so it triggers the next workflow), and attaches the SBOM.
3. The published release fires [`release-deploy.yml`](../../.github/workflows/release-deploy.yml):
   tag-SHA-pinned, it deploys production behind the environment reviewer approval and publishes
   production docs.

There is no promotion and no back-merge — the version shape is `X.Y.Z` only; environments (not the
version) distinguish development from production.
