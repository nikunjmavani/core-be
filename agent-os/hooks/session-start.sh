#!/usr/bin/env bash
# Claude Code SessionStart hook for core-be.
#
# Two jobs:
#   1. (web) Make the env usable: verify Node, switch to a new-enough Node when
#      needed (pinned for the session via $CLAUDE_ENV_FILE), and install deps so
#      `pnpm validate` / tests / linters work.
#   2. Inject session context: the agent-os skill-trigger routing map plus a
#      short env/commands summary, as SessionStart additionalContext.
#
#   stderr -> install logs / diagnostics (NOT added to context)
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT" || exit 0

# --- Required Node major (from .nvmrc, fallback 24) --------------------------
required_major="24"
if [ -f .nvmrc ]; then
  parsed="$(tr -dc '0-9.' < .nvmrc | cut -d. -f1)"
  [ -n "$parsed" ] && required_major="$parsed"
fi
current_major="$(node -v 2>/dev/null | tr -dc '0-9.' | cut -d. -f1)"
[ -z "$current_major" ] && current_major="0"
node_ok="yes"; [ "$current_major" -lt "$required_major" ] 2>/dev/null && node_ok="no"

# --- If Node is too old, find a new-enough one and pin it for the session ----
if [ "$node_ok" = "no" ]; then
  for candidate in \
    "/opt/node${required_major}/bin" \
    /opt/node"${required_major}"*/bin \
    "${HOME}/.nvm/versions/node/v${required_major}"*/bin \
    /usr/local/node"${required_major}"*/bin; do
    [ -x "${candidate}/node" ] || continue
    cand_major="$("${candidate}/node" -v 2>/dev/null | tr -dc '0-9.' | cut -d. -f1)"
    if [ -n "$cand_major" ] && [ "$cand_major" -ge "$required_major" ] 2>/dev/null; then
      export PATH="${candidate}:${PATH}"
      [ -n "${CLAUDE_ENV_FILE:-}" ] && printf 'export PATH=%s:$PATH\n' "$candidate" >> "$CLAUDE_ENV_FILE"
      current_major="$cand_major"; node_ok="yes"
      echo "session-start: switched to $(node -v) at ${candidate} (persisted for the session)." >&2
      break
    fi
  done
fi

# --- Install deps on remote (web) sessions when Node is adequate -------------
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  if [ "$node_ok" = "no" ]; then
    echo "session-start: Node $(node -v 2>/dev/null) is below required v${required_major} (.nvmrc) — skipping pnpm install." >&2
  elif [ ! -x node_modules/.bin/biome ]; then
    echo "session-start: installing dependencies (pnpm install)…" >&2
    corepack enable >/dev/null 2>&1 || true
    pnpm install --prefer-offline >&2 || pnpm install >&2 || echo "session-start: pnpm install failed (see log above)." >&2
  else
    echo "session-start: dependencies already present — skipping install." >&2
  fi
fi

# --- Start Docker daemon (opt-in via START_DOCKER=1) -------------------------
# The cached Setup script's processes do not persist, so a per-session daemon
# must (re)start here. Off by default to keep startup light. Image pulls also
# require `production.cloudfront.docker.com` on the network allowlist; without
# it `docker compose up` 403s on layer downloads. Fail-open: never blocks.
docker_status="absent"
if command -v docker >/dev/null 2>&1; then
  docker_status="stopped"
  if docker info >/dev/null 2>&1; then
    docker_status="running"
  elif [ "${START_DOCKER:-}" = "1" ] && command -v dockerd >/dev/null 2>&1; then
    echo "session-start: starting dockerd (START_DOCKER=1)…" >&2
    (dockerd >/tmp/dockerd.log 2>&1 &)
    for _ in $(seq 1 20); do
      docker info >/dev/null 2>&1 && { docker_status="running"; break; }
      sleep 1
    done
    [ "$docker_status" = "running" ] || echo "session-start: dockerd not ready (see /tmp/dockerd.log)." >&2
  fi
fi

# --- Readiness check: agent-os integrity only (fast, no DB) ------------------
# The ONLY gate at startup. Heavy work (compose:up, db:migrate, db:seed, tests,
# pnpm dev) is intentionally left to run on demand per prompt — not bootstrapped
# here. Fail-open: never blocks the session; output goes to stderr (diagnostics).
agent_os_status="skipped"
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && [ -x node_modules/.bin/biome ]; then
  if pnpm agent-os:check >&2; then
    agent_os_status="passed"
  else
    agent_os_status="see: pnpm agent-os:check"
  fi
fi

# --- Build session context: skill routing map + env/commands summary --------
node_version="$(node -v 2>/dev/null || echo unknown)"
deps="missing"; [ -x node_modules/.bin/biome ] && deps="installed"
codegraph="absent"; [ -f .codegraph/codegraph.db ] && codegraph="present"
gh_cli="absent"; command -v gh >/dev/null 2>&1 && gh_cli="$(gh --version 2>/dev/null | head -1 | awk '{print $3}')"
[ -n "$gh_cli" ] || gh_cli="absent"
# "provisioned" = the cached toolchain the Setup script builds (Node >=required + installed deps) is live in this session.
provisioned="no"; { [ "$node_ok" = "yes" ] && [ "$deps" = "installed" ]; } && provisioned="yes"
node_note=""; [ "$node_ok" = "no" ] && node_note="  (switch to Node >=${required_major} from .nvmrc, then pnpm install)"

map_file="$ROOT/agent-os/docs/skill-triggers.md"
map_section=""
[ -f "$map_file" ] && map_section="$(cat "$map_file")"

context="$(printf 'core-be session ready — environment provisioned: %s.\n- Node %s (need >=%s) · deps %s · gh %s · docker %s · codegraph %s · agent-os %s%s\n- Startup is light: Node + deps + agent-os:check only — run compose:up / db:migrate / db:seed / tests on demand per prompt.\n- Gates: pnpm validate · pnpm ci:local   (pre-commit: pnpm guard:pre-commit)\n- Custom commands: /validate · /ci-local · /new-domain · /routes-sync\n\nagent-os skill routing — consult skill-index FIRST, then run the listed skill(s) for the files you change:\n\n%s' \
  "$provisioned" "$node_version" "$required_major" "$deps" "$gh_cli" "$docker_status" "$codegraph" "$agent_os_status" "$node_note" "$map_section")"

# Prefer the structured additionalContext envelope; fall back to plain stdout
# (also injected as context) when jq is unavailable. Fail-open either way.
if command -v jq >/dev/null 2>&1; then
  jq -cn --arg c "$context" '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$c}}'
else
  printf '%s\n' "$context"
fi
