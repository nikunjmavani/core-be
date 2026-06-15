#!/usr/bin/env bash
# Claude Code SessionStart hook for core-be.
#
# On Claude Code on the web (remote) it ensures dependencies are installed so
# `pnpm validate` / tests / linters work, then prints a short environment
# check plus the skill-trigger map as session context.
#
#   stdout -> injected into the session as additionalContext (keep it short)
#   stderr -> install logs / diagnostics (NOT added to context)
set -uo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$PROJECT_DIR" || exit 0

# --- Required Node major (from .nvmrc, fallback to 24) ------------------------
required_major="24"
if [ -f .nvmrc ]; then
  parsed="$(tr -dc '0-9.' < .nvmrc | cut -d. -f1)"
  [ -n "$parsed" ] && required_major="$parsed"
fi
current_major="$(node -v 2>/dev/null | tr -dc '0-9.' | cut -d. -f1)"
[ -z "$current_major" ] && current_major="0"

node_ok="yes"
if [ "$current_major" -lt "$required_major" ] 2>/dev/null; then
  node_ok="no"
fi

# --- If Node is too old, find a new-enough one and pin it for the session -----
# Persisting to $CLAUDE_ENV_FILE makes the corrected PATH apply to every command
# the agent runs afterwards, not just this hook.
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
      current_major="$cand_major"
      node_ok="yes"
      echo "session-start: switched to $(node -v) at ${candidate} (persisted for the session)." >&2
      break
    fi
  done
fi

# --- Install dependencies on remote (web) sessions when Node is adequate ------
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  if [ "$node_ok" = "no" ]; then
    echo "session-start: Node $(node -v 2>/dev/null) is below required v${required_major} (.nvmrc) — skipping pnpm install; it would fail the engines check." >&2
  elif [ ! -x node_modules/.bin/biome ]; then
    echo "session-start: installing dependencies (pnpm install)…" >&2
    corepack enable >/dev/null 2>&1 || true
    pnpm install --prefer-offline >&2 || pnpm install >&2 || echo "session-start: pnpm install failed (see log above)." >&2
  else
    echo "session-start: dependencies already present — skipping install." >&2
  fi
fi

# --- Verify + remind (stdout becomes session context) ------------------------
node_version="$(node -v 2>/dev/null || echo unknown)"
deps="missing"; [ -x node_modules/.bin/biome ] && deps="installed"
codegraph="absent"; [ -f .codegraph/codegraph.db ] && codegraph="present"
node_note=""
[ "$node_ok" = "no" ] && node_note="  ⚠️ switch to Node >=${required_major} (.nvmrc), then run pnpm install"

cat <<EOF
core-be session ready.
- Node ${node_version} (need >=${required_major}) · deps ${deps} · codegraph ${codegraph}${node_note}
- Gates: pnpm validate · pnpm ci:local   (pre-commit: pnpm guard:pre-commit)
- Pick the skill for a change: agent-os/docs/skill-triggers.md
- Custom commands: /validate · /ci-local · /new-domain · /routes-sync
EOF
