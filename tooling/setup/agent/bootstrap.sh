#!/usr/bin/env bash
# One-shot cloud-session bring-up for core-be on Claude Code on the web.
#
# Runs every agent setup helper in order — Node, gh, Docker CLI/Compose, Docker
# daemon, Docker images (registry mirror), CodeGraph, Headroom, gitleaks — scaffolds a
# self-contained `.env.local` (`pnpm setup:local --only-env`), then brings up
# the local Docker stack (Postgres + Redis), migrates, seeds, and verifies the
# app is healthy (/livez + /readyz). A single command to make a cloud session
# "same as local", with a progress log after each step so anyone watching the
# session sees live status.
#
#   bash tooling/setup/agent/bootstrap.sh
#
# Steps 1-6 (tool installs) are best-effort and log ✓/skip without aborting; the
# env scaffold, DB bring-up, migrate, seed, and healthcheck are HARD gates
# (non-zero exit on failure). Leaves Postgres + Redis running. The app is started
# only transiently for the healthcheck and then stopped — set KEEP_APP=1 to leave
# `pnpm dev` up.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../../.." || exit 1
readonly AGENT_DIR="tooling/setup/agent"
readonly TOTAL=11
readonly DOCKERD_AGENT_MODE_FILE="${DOCKERD_AGENT_MODE_FILE:-/tmp/dockerd-agent-mode}"
start_ts=$(date +%s)

step() { echo ""; echo "▶ $*"; }
ok()   { echo "✓ $*"; }
skip() { echo "• $*"; }
die()  { echo "✗ $*" >&2; exit 1; }

# Stop any transiently-started dev server (pnpm -> tsx watch -> node), skipping
# this shell. Reliable across the orphaned-node case where pnpm/tsx exit first.
stop_app() {
  local self=$$ pid cmd
  for p in /proc/[0-9]*; do
    pid=${p#/proc/}
    [ "$pid" = "$self" ] && continue
    cmd=$(tr '\0' ' ' <"$p/cmdline" 2>/dev/null) || continue
    case "$cmd" in
      *tsx*watch*|*node*src/index*) kill -TERM "$pid" 2>/dev/null ;;
    esac
  done
}

echo "core-be cloud bring-up — $(date -u '+%Y-%m-%d %H:%M:%SZ')"

# 1) Node runtime ------------------------------------------------------------
step "[1/${TOTAL}] Node runtime"
bash "${AGENT_DIR}/install-node.sh" >&2 || skip "install-node best-effort (using session Node)"

# install-node.sh drops the pinned Node into <prefix>/node<major>, but it runs
# in a child process and so cannot change THIS shell's PATH. Activate it here so
# every pnpm step below runs on the pinned Node; otherwise the image default
# (e.g. Node 22) trips pnpm's engineStrict gate at the compose:up step. The
# SessionStart hook (agent-os/hooks/session-start.sh) does the same switch for
# interactive sessions, but does not run when bootstrap.sh is the Setup script.
required_major="24"
[ -f .nvmrc ] && required_major="$(tr -dc '0-9.' < .nvmrc | cut -d. -f1)"
current_major="$(node -v 2>/dev/null | tr -dc '0-9.' | cut -d. -f1)"
current_major="${current_major:-0}"
if [ "${current_major}" -lt "${required_major}" ] 2>/dev/null; then
  node_prefix="${NODE_INSTALL_PREFIX:-/opt}"
  for candidate in \
    "${node_prefix}/node${required_major}/bin" \
    /opt/node"${required_major}"*/bin \
    "${HOME}/.nvm/versions/node/v${required_major}"*/bin \
    /usr/local/node"${required_major}"*/bin; do
    [ -x "${candidate}/node" ] || continue
    export PATH="${candidate}:${PATH}"
    [ -n "${CLAUDE_ENV_FILE:-}" ] && printf 'export PATH=%s:$PATH\n' "${candidate}" >> "${CLAUDE_ENV_FILE}"
    echo "bootstrap: switched to Node $("${candidate}/node" -v) at ${candidate} (was v${current_major}.x)." >&2
    break
  done
fi

node -v >/dev/null 2>&1 || die "Node not available"
if [ "$(node -v 2>/dev/null | tr -dc '0-9.' | cut -d. -f1)" -lt "${required_major}" ] 2>/dev/null; then
  skip "[1/${TOTAL}] Node $(node -v) < required v${required_major} — pnpm will self-provision it via useNodeVersion (slower, but unblocks the run)"
else
  ok "[1/${TOTAL}] Node $(node -v)"
fi

# 2) GitHub CLI --------------------------------------------------------------
step "[2/${TOTAL}] GitHub CLI (gh)"
bash "${AGENT_DIR}/install-gh.sh" || true
if command -v gh >/dev/null 2>&1; then ok "[2/${TOTAL}] $(gh --version | head -1)"; else skip "[2/${TOTAL}] gh unavailable (non-fatal)"; fi

# 3) Docker + images via registry mirror ------------------------------------
step "[3/${TOTAL}] Docker CLI/Compose + images (mirror + pull)"
bash "${AGENT_DIR}/install-docker.sh" || true
bash "${AGENT_DIR}/install-docker-images.sh" || true
if docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -qE '^postgres:|^redis:'; then
  ok "[3/${TOTAL}] compose images present: $(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^postgres:|^redis:' | paste -sd' ')"
else
  skip "[3/${TOTAL}] images not pre-pulled (compose will pull via mirror)"
fi

# 4) CodeGraph CLI + index ---------------------------------------------------
step "[4/${TOTAL}] CodeGraph CLI + index"
bash "${AGENT_DIR}/install-codegraph.sh" || true
if command -v codegraph >/dev/null 2>&1; then ok "[4/${TOTAL}] codegraph $(codegraph --version 2>/dev/null)"; else skip "[4/${TOTAL}] codegraph unavailable (non-fatal)"; fi

# 5) Headroom CLI + MCP register (context compression) ----------------------
step "[5/${TOTAL}] Headroom CLI (context compression)"
bash "${AGENT_DIR}/install-headroom.sh" || true
if command -v headroom >/dev/null 2>&1; then ok "[5/${TOTAL}] headroom $(headroom --version 2>/dev/null)"; else skip "[5/${TOTAL}] headroom unavailable (non-fatal)"; fi

# 6) gitleaks (pre-commit secret scan) --------------------------------------
step "[6/${TOTAL}] gitleaks (secret scan)"
bash "${AGENT_DIR}/install-gitleaks.sh" || true
if command -v gitleaks >/dev/null 2>&1; then ok "[6/${TOTAL}] gitleaks $(gitleaks version 2>/dev/null)"; else skip "[6/${TOTAL}] gitleaks unavailable — pre-commit secret scan will fail (non-fatal)"; fi

# 7) Environment files (.env.local) -----------------------------------------
step "[7/${TOTAL}] Environment (.env.local)"
pnpm setup:local --only-env >&2 || die "env scaffold failed (pnpm setup:local --only-env)"
ok "[7/${TOTAL}] .env.local ready"

# 8) Postgres + Redis (docker compose) --------------------------------------
step "[8/${TOTAL}] Postgres + Redis (docker compose)"
bash "${AGENT_DIR}/ensure-docker-daemon.sh" >&2 || die "Docker daemon is not reachable (see ensure-docker-daemon diagnostics above)"
if [ "$(cat "${DOCKERD_AGENT_MODE_FILE}" 2>/dev/null)" = "restricted" ]; then
  echo "bootstrap: Docker daemon is in restricted networking mode; using Codex Cloud host-network compose override." >&2
  docker compose -f docker-compose.yml -f "${AGENT_DIR}/docker-compose.codex-cloud.yml" up -d postgres redis >&2 \
    || die "compose:up failed with Codex Cloud restricted Docker override"
else
  SONAR=0 pnpm compose:up >&2 || die "compose:up failed (Docker daemon was reachable before compose; inspect docker compose output above)"
fi
pnpm compose:wait >&2 || die "Postgres did not become ready"
ok "[8/${TOTAL}] Postgres + Redis healthy"

# 9) Migrations --------------------------------------------------------------
step "[9/${TOTAL}] Database migrations"
pnpm db:migrate >&2 || die "db:migrate failed"
ok "[9/${TOTAL}] migrations applied"

# 10) Seed -------------------------------------------------------------------
step "[10/${TOTAL}] Seed (minimal reference data)"
pnpm db:seed >&2 || die "db:seed failed"
ok "[10/${TOTAL}] seed complete"

# 11) App health (/livez + /readyz) -----------------------------------------
step "[11/${TOTAL}] App health (/livez + /readyz)"
app_log="$(mktemp)"
pnpm dev >"${app_log}" 2>&1 &
if bash "${AGENT_DIR}/healthcheck.sh"; then
  ok "[11/${TOTAL}] app live & ready"
  app_ok=1
else
  echo "---- pnpm dev log (tail) ----" >&2
  tail -20 "${app_log}" >&2
  app_ok=0
fi

if [ "${KEEP_APP:-0}" = "1" ] && [ "${app_ok}" = "1" ]; then
  echo "  KEEP_APP=1 — leaving \`pnpm dev\` running on :${PORT:-3000}." >&2
else
  stop_app
  echo "  stopped transient app (Postgres + Redis stay up)." >&2
fi
rm -f "${app_log}"
[ "${app_ok}" = "1" ] || die "healthcheck failed"

echo ""
echo "✓ bring-up complete in $(( $(date +%s) - start_ts ))s — session matches local. Postgres + Redis are up; run \`pnpm dev\` when you need the app."
