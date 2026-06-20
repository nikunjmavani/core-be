#!/usr/bin/env bash
# Ensure Docker CLI + Compose v2 are available for cloud agent sessions.
#
# Claude Code web images usually preinstall Docker, while other cloud agent
# images may not. This helper is intentionally idempotent: when `docker compose`
# already works, it exits without changing the image; otherwise it tries the
# distro packages available from the setup-phase apt mirrors.
#
# Best-effort: setup should still complete for static/unit-only tasks even when
# the platform does not allow package installation or nested Docker.
set -uo pipefail

log() {
  printf 'install-docker: %s\n' "$*" >&2
}

has_docker_compose() {
  command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1
}

if has_docker_compose; then
  log "$(docker --version 2>/dev/null) with $(docker compose version 2>/dev/null) already present — nothing to do."
  exit 0
fi

if ! command -v apt-get >/dev/null 2>&1; then
  log "apt-get unavailable — cannot install Docker on this image."
  exit 0
fi

sudo_cmd=()
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    sudo_cmd=(sudo -n)
  else
    log "not root and passwordless sudo unavailable — cannot install Docker."
    exit 0
  fi
fi

log "installing Docker packages via apt."
"${sudo_cmd[@]}" apt-get update >/dev/null 2>&1 || {
  log "apt-get update failed."
  exit 0
}

if ! "${sudo_cmd[@]}" apt-get install -y docker.io docker-compose-plugin >/dev/null 2>&1; then
  if ! "${sudo_cmd[@]}" apt-get install -y docker.io docker-compose-v2 >/dev/null 2>&1; then
    log "could not install Docker Compose v2 packages."
    exit 0
  fi
fi

if has_docker_compose; then
  log "installed $(docker --version 2>/dev/null) with $(docker compose version 2>/dev/null)."
else
  log "Docker package installed, but `docker compose` is still unavailable."
fi

exit 0
