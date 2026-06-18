#!/usr/bin/env bash
# Codex Cloud setup / maintenance script for core-be.
#
# Codex runs this script with internet access before the agent phase. The agent
# phase commonly runs without egress, so install the pinned runtime and npm
# dependencies here, while the network is available. Mirror the Claude Cloud
# setup helper list by default: Node, gh, Docker CLI/Compose, Docker image
# pre-pull, CodeGraph, Headroom, and gitleaks. Keep database/app startup out of
# the default path; start services explicitly from the task.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../../.." || exit 1

readonly AGENT_DIR="tooling/setup/agent"
readonly REQUIRED_MAJOR="$(tr -dc '0-9.' < .nvmrc 2>/dev/null | cut -d. -f1 || true)"
readonly NODE_MAJOR="${REQUIRED_MAJOR:-24}"
readonly NODE_BIN_DIR="${NODE_INSTALL_PREFIX:-/opt}/node${NODE_MAJOR}/bin"
readonly INSTALL_AGENT_TOOLS="${CODEX_SETUP_AGENT_TOOLS:-1}"
readonly PREPULL_DOCKER_IMAGES="${CODEX_SETUP_PREPULL_DOCKER:-1}"

log() {
  printf '\n==> %s\n' "$*"
}

warn() {
  printf 'codex-setup: %s\n' "$*" >&2
}

run_best_effort() {
  local label="$1"
  shift

  log "${label}"
  if "$@"; then
    printf 'ok: %s\n' "${label}"
  else
    warn "${label} failed; continuing because this step is optional"
  fi
}

log "Installing pinned Node runtime"
bash "${AGENT_DIR}/install-node.sh"

if [ -x "${NODE_BIN_DIR}/node" ]; then
  export PATH="${NODE_BIN_DIR}:${PATH}"
else
  warn "expected Node at ${NODE_BIN_DIR}; falling back to current PATH"
fi

# Setup scripts run in a separate shell from the agent phase. Persist Node by
# putting stable symlinks in /usr/local/bin when the image permits it, and also
# append PATH to ~/.bashrc as a harmless fallback for shells that source it.
if [ -x "${NODE_BIN_DIR}/node" ]; then
  mkdir -p /usr/local/bin 2>/dev/null || true
  ln -sf "${NODE_BIN_DIR}/node" /usr/local/bin/node 2>/dev/null || true
  ln -sf "${NODE_BIN_DIR}/npm" /usr/local/bin/npm 2>/dev/null || true
  ln -sf "${NODE_BIN_DIR}/npx" /usr/local/bin/npx 2>/dev/null || true
  if ! grep -qs "${NODE_BIN_DIR}" "${HOME}/.bashrc"; then
    printf '\n# core-be Codex Cloud Node runtime\nexport PATH="%s:$PATH"\n' "${NODE_BIN_DIR}" >> "${HOME}/.bashrc" 2>/dev/null || true
  fi
fi

log "Installing npm dependencies"
node --version
corepack enable
pnpm install --frozen-lockfile

if [ "${INSTALL_AGENT_TOOLS}" = "1" ]; then
  run_best_effort "Installing GitHub CLI" bash "${AGENT_DIR}/install-gh.sh"
  if [ "${PREPULL_DOCKER_IMAGES}" = "1" ]; then
    run_best_effort "Installing Docker CLI and Compose when missing" bash "${AGENT_DIR}/install-docker.sh"
    run_best_effort "Configuring Docker mirror and pre-pulling DB images" bash "${AGENT_DIR}/install-docker-images.sh"
  else
    warn "skipping Docker image pre-pull because CODEX_SETUP_PREPULL_DOCKER=${PREPULL_DOCKER_IMAGES}"
  fi
  run_best_effort "Installing CodeGraph" bash "${AGENT_DIR}/install-codegraph.sh"
  run_best_effort "Installing Headroom" bash "${AGENT_DIR}/install-headroom.sh"
  run_best_effort "Installing gitleaks" bash "${AGENT_DIR}/install-gitleaks.sh"
else
  warn "skipping optional agent tools because CODEX_SETUP_AGENT_TOOLS=${INSTALL_AGENT_TOOLS}"
fi

log "Codex Cloud setup complete"
printf 'Node: %s\n' "$(node --version)"
printf 'pnpm: %s\n' "$(pnpm --version)"
