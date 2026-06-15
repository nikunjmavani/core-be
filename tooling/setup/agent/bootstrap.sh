#!/usr/bin/env bash
# One-shot cloud-session bring-up for core-be on Claude Code on the web.
#
# Runs every agent setup helper in order — Node, gh, Docker images (registry
# mirror), CodeGraph — then brings up the local Docker stack (Postgres + Redis),
# migrates, seeds, and verifies the app is healthy (/livez + /readyz). A single
# command to make a cloud session "same as local", with a progress log after
# each step so anyone watching the session sees live status.
#
#   bash tooling/setup/agent/bootstrap.sh
#
# Steps 1-4 (tool installs) are best-effort and log ✓/skip without aborting; the
# DB bring-up, migrate, seed, and healthcheck are HARD gates (non-zero exit on
# failure). Leaves Postgres + Redis running. The app is started only transiently
# for the healthcheck and then stopped — set KEEP_APP=1 to leave `pnpm dev` up.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../../.." || exit 1
readonly AGENT_DIR="tooling/setup/agent"
readonly TOTAL=8
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
node -v >/dev/null 2>&1 || die "Node not available"
ok "[1/${TOTAL}] Node $(node -v)"

# 2) GitHub CLI --------------------------------------------------------------
step "[2/${TOTAL}] GitHub CLI (gh)"
bash "${AGENT_DIR}/install-gh.sh" || true
if command -v gh >/dev/null 2>&1; then ok "[2/${TOTAL}] $(gh --version | head -1)"; else skip "[2/${TOTAL}] gh unavailable (non-fatal)"; fi

# 3) Docker images via registry mirror --------------------------------------
step "[3/${TOTAL}] Docker images (mirror + pull)"
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

# 5) Postgres + Redis (docker compose) --------------------------------------
step "[5/${TOTAL}] Postgres + Redis (docker compose)"
SONAR=0 pnpm compose:up >&2 || die "compose:up failed (is dockerd running? see step 3)"
pnpm compose:wait >&2 || die "Postgres did not become ready"
ok "[5/${TOTAL}] Postgres + Redis healthy"

# 6) Migrations --------------------------------------------------------------
step "[6/${TOTAL}] Database migrations"
pnpm db:migrate >&2 || die "db:migrate failed"
ok "[6/${TOTAL}] migrations applied"

# 7) Seed --------------------------------------------------------------------
step "[7/${TOTAL}] Seed (minimal reference data)"
pnpm db:seed >&2 || die "db:seed failed"
ok "[7/${TOTAL}] seed complete"

# 8) App health (/livez + /readyz) ------------------------------------------
step "[8/${TOTAL}] App health (/livez + /readyz)"
app_log="$(mktemp)"
pnpm dev >"${app_log}" 2>&1 &
if bash "${AGENT_DIR}/healthcheck.sh"; then
  ok "[8/${TOTAL}] app live & ready"
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
