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

# Node 24 (engines gate). It must land in /opt/node<major> — where node_bin above,
# environment.json, the session-start hook, bootstrap.sh, and the cloud terminals all
# expect it. Writing under /opt needs root, but Cursor Cloud runs this update script as
# a non-root user, so use passwordless sudo when available and then hand /opt/node<major>
# to the invoking user so corepack/pnpm can manage shims without sudo. Best-effort: fall
# back to the session Node so static/unit-only tasks still proceed if every path fails.
install_pinned_node() {
  if [ "$(id -u)" -eq 0 ]; then
    NODE_INSTALL_PREFIX=/opt bash "${agent_dir}/install-node.sh"
  elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    sudo -n env NODE_INSTALL_PREFIX=/opt bash "${agent_dir}/install-node.sh"
    sudo -n chown -R "$(id -u):$(id -g)" "${node_bin%/bin}" 2>/dev/null || true
  else
    log "cannot write /opt without root and passwordless sudo is unavailable — using session Node"
    return 1
  fi
}
install_pinned_node || log "install-node best-effort failed (continuing on session Node)"

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

# Default MCP pair (codegraph + headroom) — same as bootstrap / pnpm setup:local.
# install-headroom.sh also merges .mcp.default.json via jq; this is the canonical
# TypeScript path and keeps Cursor / local clients in sync with the committed template.
log "scaffold MCP default pair (.mcp.json)"
PATH="${node_bin}:${PATH}" pnpm mcp:setup:default || true

# Scaffold .env.local for later bootstrap (no compose/migrate here).
log "scaffold .env.local"
PATH="${node_bin}:${PATH}" pnpm setup:local --only-env

log "done — run bash tooling/setup/agent/bootstrap.sh when you need Postgres + API"
