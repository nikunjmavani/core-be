#!/usr/bin/env bash
# Ensure the Docker daemon is reachable before running docker compose.
#
# Cloud agent images can have the Docker CLI installed while dockerd is stopped.
# This helper starts dockerd when possible, waits for the socket, and prints
# useful diagnostics when the platform does not permit nested Docker.
set -uo pipefail

readonly LOG_FILE="${DOCKERD_AGENT_LOG:-/tmp/dockerd-agent.log}"
readonly MODE_FILE="${DOCKERD_AGENT_MODE_FILE:-/tmp/dockerd-agent-mode}"

log() {
  printf 'ensure-docker-daemon: %s\n' "$*" >&2
}

wait_for_docker() {
  for _ in $(seq 1 "${DOCKERD_WAIT_SECONDS:-30}"); do
    docker info >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

start_dockerd() {
  local mode="$1"
  shift

  log "starting dockerd ${mode}; log: ${LOG_FILE}"
  : >"${LOG_FILE}"
  if [ "${#sudo_cmd[@]}" -gt 0 ]; then
    setsid "${sudo_cmd[@]}" dockerd "$@" >"${LOG_FILE}" 2>&1 </dev/null &
  else
    setsid dockerd "$@" >"${LOG_FILE}" 2>&1 </dev/null &
  fi
}

sudo_cmd=()
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    sudo_cmd=(sudo -n)
  fi
fi

if ! command -v docker >/dev/null 2>&1; then
  log "docker CLI is not installed."
  exit 1
fi

if docker info >/dev/null 2>&1; then
  log "Docker daemon already reachable."
  rm -f "${MODE_FILE}" 2>/dev/null || true
  exit 0
fi

log "Docker daemon is not reachable; attempting to start it."

if command -v service >/dev/null 2>&1; then
  if [ "${#sudo_cmd[@]}" -gt 0 ]; then
    "${sudo_cmd[@]}" service docker start >/dev/null 2>&1 || true
  else
    service docker start >/dev/null 2>&1 || true
  fi
fi

if ! wait_for_docker && command -v systemctl >/dev/null 2>&1; then
  if [ "${#sudo_cmd[@]}" -gt 0 ]; then
    "${sudo_cmd[@]}" systemctl start docker >/dev/null 2>&1 || true
  else
    systemctl start docker >/dev/null 2>&1 || true
  fi
fi

if ! wait_for_docker && command -v dockerd >/dev/null 2>&1; then
  start_dockerd "directly"
fi

if wait_for_docker; then
  log "Docker daemon is reachable."
  rm -f "${MODE_FILE}" 2>/dev/null || true
  exit 0
fi

# Some ephemeral cloud images start dockerd with a root-owned socket that the
# current user cannot access until a fresh login. Relax only this ephemeral
# socket when passwordless sudo is available; compose must run as this user.
if [ -S /var/run/docker.sock ] && [ "${#sudo_cmd[@]}" -gt 0 ]; then
  "${sudo_cmd[@]}" chmod a+rw /var/run/docker.sock >/dev/null 2>&1 || true
fi

if wait_for_docker; then
  log "Docker daemon is reachable after socket permission repair."
  rm -f "${MODE_FILE}" 2>/dev/null || true
  exit 0
fi

# Codex Cloud setup containers can run as root but still lack the kernel
# capability Docker needs to program iptables/NAT for the default bridge:
# "failed to create NAT chain DOCKER ... Permission denied". In that case,
# start dockerd without bridge/NAT; bootstrap.sh detects this marker and uses a
# host-network compose override for Postgres + Redis.
if command -v dockerd >/dev/null 2>&1; then
  start_dockerd "with restricted networking fallback" \
    --iptables=false \
    --ip-masq=false \
    --ip-forward=false \
    --bridge=none
fi

if wait_for_docker; then
  printf 'restricted\n' >"${MODE_FILE}"
  log "Docker daemon is reachable with restricted networking fallback."
  exit 0
fi

log "Docker daemon still unreachable."
log "docker: $(docker --version 2>/dev/null || printf 'unavailable')"
log "dockerd: $(command -v dockerd 2>/dev/null || printf 'not found')"
if [ -e /var/run/docker.sock ]; then
  ls -l /var/run/docker.sock >&2 2>/dev/null || true
fi
if [ -s "${LOG_FILE}" ]; then
  log "dockerd log tail:"
  tail -50 "${LOG_FILE}" >&2 || true
fi
exit 1
