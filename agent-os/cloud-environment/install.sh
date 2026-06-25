#!/usr/bin/env bash
# Cached cloud-agent install — idempotent; safe to run on every VM boot/update.
#
# Installs toolchain + pulls compose images. Does NOT run bootstrap.sh (migrate,
# seed, healthcheck) — those are on-demand so a Docker failure does not mark the
# whole environment as failed. See agent-os/cloud-environment/agents-cloud.md.
#
# Usage (Cursor environment.json install field or dashboard Setup script):
#   bash agent-os/cloud-environment/install.sh
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${repository_root}"

readonly agent_dir="tooling/setup/agent"
readonly node_bin="/opt/node24/bin"

log() { printf 'cloud-install: %s\n' "$*" >&2; }

# Node 24 (engines gate) — may need sudo when install runs as root in Setup script.
if [ "$(id -u)" -eq 0 ]; then
  NODE_INSTALL_PREFIX=/opt bash "${agent_dir}/install-node.sh" || true
else
  bash "${agent_dir}/install-node.sh" || true
fi

export PATH="${node_bin}:${HOME}/.local/bin:${PATH}"
corepack enable --install-directory "${node_bin}" 2>/dev/null || corepack enable || true

log "pnpm install"
PATH="${node_bin}:${PATH}" pnpm install --frozen-lockfile

# Best-effort tool chain (never abort the install script).
bash "${agent_dir}/install-gh.sh" || true
bash "${agent_dir}/install-docker.sh" || true
bash "${agent_dir}/install-docker-images.sh" || true
bash "${agent_dir}/install-codegraph.sh" || true
bash "${agent_dir}/install-headroom.sh" || true
bash "${agent_dir}/install-gitleaks.sh" || true

# Scaffold .env.local for later bootstrap (no compose/migrate here).
log "scaffold .env.local"
PATH="${node_bin}:${PATH}" pnpm setup:local --only-env

log "done — run bash tooling/setup/agent/bootstrap.sh when you need Postgres + API"
