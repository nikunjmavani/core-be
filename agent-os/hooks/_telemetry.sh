#!/usr/bin/env bash
# shellcheck shell=bash
# Shared hook telemetry — appends one CSV line per hook run to the gitignored
# agent-os/hooks/.telemetry.log so `pnpm agent-os:hooks:report` can show which
# hooks actually fire, how often, and when they last did. A hook that stays
# silent for 30 days is a pruning candidate (see agent-os/hooks/README.md).
#
# Fail-open by construction: every path is wrapped so a logging error can never
# block or fail the hook that sourced it.
#
# Usage in a hook (right after `set -uo pipefail`, before any `cd`):
#   source "$(dirname "${BASH_SOURCE[0]}")/_telemetry.sh"
#   telemetry_init "<hook-id>" "<Event>"
#   ...    # at the point the hook actually acts (emits output / blocks / formats):
#   telemetry_fired
# On exit (any path) the EXIT trap records `fired` or the default `silent`.

# Resolve the log path once, at init time (before the hook may `cd` elsewhere).
telemetry_init() {
  TELEMETRY_HOOK_ID="${1:-unknown}"
  TELEMETRY_EVENT="${2:-unknown}"
  TELEMETRY_STATUS="silent"
  local root="${CLAUDE_PROJECT_DIR:-}"
  if [ -z "$root" ]; then
    root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)"
  fi
  TELEMETRY_LOG="${root}/agent-os/hooks/.telemetry.log"
  # shellcheck disable=SC2064
  trap 'agent_os_record_telemetry' EXIT
}

# Mark this run as having acted (produced output / blocked / formatted).
# Optional $1: a short measurement detail (e.g. "bytes=31204") appended as a 5th
# CSV column so reports can quantify what the hook flagged. Commas/newlines are
# stripped to keep the CSV shape; readers that only take 4 columns ignore it.
telemetry_fired() {
  TELEMETRY_STATUS="fired"
  [ -n "${1:-}" ] && TELEMETRY_DETAIL="$(printf '%s' "$1" | tr -d ',\n')"
}

# Append the CSV row. Never errors (all failures swallowed).
agent_os_record_telemetry() {
  {
    local timestamp
    timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo '?')"
    if [ -n "${TELEMETRY_DETAIL:-}" ]; then
      printf '%s,%s,%s,%s,%s\n' \
        "$timestamp" "${TELEMETRY_HOOK_ID:-unknown}" "${TELEMETRY_EVENT:-unknown}" "${TELEMETRY_STATUS:-silent}" "$TELEMETRY_DETAIL" \
        >>"${TELEMETRY_LOG:-/dev/null}"
    else
      printf '%s,%s,%s,%s\n' \
        "$timestamp" "${TELEMETRY_HOOK_ID:-unknown}" "${TELEMETRY_EVENT:-unknown}" "${TELEMETRY_STATUS:-silent}" \
        >>"${TELEMETRY_LOG:-/dev/null}"
    fi
  } 2>/dev/null || true
}
