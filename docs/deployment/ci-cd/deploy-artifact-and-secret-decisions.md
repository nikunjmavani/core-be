# Deploy artifact & secret decisions

Two standing decisions about how core-be ships. Recorded here so the *why* is not
implicit in the workflow YAML. See [cicd-and-deployment.md](cicd-and-deployment.md)
for the full pipeline and [branch-protection.md](branch-protection.md) for the merge gate.

---

## D-1 — The release PAT is a GitHub **Environment** secret, not a repository secret

`RELEASE_PLEASE_TOKEN` (a PAT with `repo` + `workflow` scope, used by release-please to
create GitHub Releases/tags — which in turn trigger the production deploy) is stored as a
**GitHub Environment secret**, never a bare repository-level secret.

**Why environment-scoped wins:**

| | Repository secret | Environment secret ✅ |
| --- | --- | --- |
| Exposure | Readable by **every** workflow/job in the repo (including every PR workflow) | Only a job that declares `environment: <name>` **and** passes that environment's protection |
| Blast radius | Broad — one misconfigured workflow can exfiltrate it | Least-privilege, scoped per environment |
| Audit / rotation | Repo-wide | Per-environment, auditable, rotatable independently |

For a token that can create releases and *transitively trigger the production deploy*,
least-privilege scoping matters.

**How it works here:**

- The `release-please` job in [post-merge-ci.yml](../../../.github/workflows/post-merge-ci.yml)
  declares `environment: development` and reads `secrets.RELEASE_PLEASE_TOKEN` from it.
- It is read from the **development** environment because the **production** environment has a
  required-reviewer gate that would otherwise block the Release-PR refresh on every merge.
- `pnpm github:sync` provisions the token into **both** the **development** and **production**
  environments; the weekly canary in
  [scheduled-release-guards.yml](../../../.github/workflows/scheduled-release-guards.yml) probes
  the **development** copy for expiry, and the release-please job actively probes it (fails on
  `401`) at use time.

---

## D-2 — Build-once-promote: one scanned image, **development** → **production**

The container image is built **once**, tagged by commit SHA, scanned once (Trivy), and the
**identical bytes** are deployed to every environment. Environment differences come from
**runtime configuration** (env vars injected per GitHub Environment), never from rebuilding.

**Why:**

- The artifact that passed security scanning and the artifact running in **production** are
  provably the same image digest — no "it built differently for production" risk.
- Faster/cheaper: **production** pulls the already-built, already-scanned image; no rebuild.
- Reproducible + auditable: the running revision is a known digest tied to a SHA/tag.

**How it works here:**

- [post-merge-ci.yml](../../../.github/workflows/post-merge-ci.yml) builds + pushes
  `…/api:<github.sha>` to GHCR and deploys it to **development**.
- [release-deploy.yml](../../../.github/workflows/release-deploy.yml) resolves that exact
  tag-SHA image and, if present in GHCR, **skips the build** ("Image present — build-once") and
  deploys the identical image to **production** via `image_override`. Only a queue-cancelled
  build (no image for the tag SHA) triggers a rebuild of the same SHA.

**Contrast (why this is a backend property):** a Vite frontend bakes `VITE_*` values into the
bundle at build time, so its **development** and **production** bundles genuinely differ — there
is no single artifact to promote. A backend reads config from the environment at runtime, so one
image serves both. Build-once-promote is therefore available to core-be and not to a static
frontend build.
