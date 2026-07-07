#!/usr/bin/env bash
# Claude Code PostToolUse hook (Edit | Write).
#
# Auto-formats the file Claude just edited with the project's Biome config, so a
# stray indent / quote / trailing comma never reaches the `pnpm validate` gate.
# Scope is deliberately identical to `pnpm format` (biome.json includes:
# src/** + tooling/**), so the hook only ever touches files Biome already owns —
# never docs, generated JSON, or anything outside the formatter's remit.
#
# Format-only (not `biome check --write`): no lint autofixes or import reordering,
# so the change stays minimal and predictable. Lint still runs at pre-commit / CI.
#
# Fails OPEN: a missing jq / biome, a non-repo path, or any error leaves the file
# untouched and exits 0. A formatter hook must never block or fail an edit.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_telemetry.sh"
telemetry_init "format-edits" "PostToolUse"

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null || echo "")
[[ -z "$FILE" ]] && exit 0

# Normalise to an absolute path under the repo root.
case "$FILE" in
  /*) ABS="$FILE" ;;
  *) ABS="$ROOT/$FILE" ;;
esac
[[ -f "$ABS" ]] || exit 0

# Only format what `pnpm format` formats: files under src/ or tooling/ …
case "$ABS" in
  "$ROOT"/src/* | "$ROOT"/tooling/*) ;;
  *) exit 0 ;;
esac

# … and only Biome-supported file types.
case "$ABS" in
  *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs | *.json | *.jsonc) ;;
  *) exit 0 ;;
esac

biome_bin="$ROOT/node_modules/.bin/biome"
[[ -x "$biome_bin" ]] || exit 0

# Format in place, quietly. Never let a formatter hiccup fail the edit.
telemetry_fired
"$biome_bin" format --write "$ABS" >/dev/null 2>&1 || true
exit 0
