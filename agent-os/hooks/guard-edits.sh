#!/usr/bin/env bash
# Claude Code PreToolUse hook (Edit | Write | MultiEdit).
#
# BLOCKS edits that introduce a hard-rule violation documented in CLAUDE.md and
# already enforced by global tests / CI — moving enforcement left from "you find
# out at pre-commit/CI" to an instant denial at the keystroke.
#
# Rules (deliberately conservative — only unambiguous, mechanically-checkable
# violations, so a normal edit is never blocked):
#   R1  getRequestDatabase() inside *.worker.ts | *.processor.ts
#   R2  a `../` relative import/require added under src/
#   R3  hand-editing a generated / do-not-edit file
#
# Fails OPEN: any parsing hiccup, or a missing `jq`, allows the edit. A hook bug
# must never be able to brick a session.

INPUT=$(cat)
command -v jq >/dev/null 2>&1 || exit 0

FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null || echo "")
[[ -z "$FILE" ]] && exit 0

# The text being written: Write.content, Edit.new_string, MultiEdit.edits[].new_string.
CONTENT=$(printf '%s' "$INPUT" | jq -r '
  [ .tool_input.content, .tool_input.new_string, ( .tool_input.edits // [] | .[].new_string ) ]
  | map(select(. != null)) | join("\n")' 2>/dev/null || echo "")

base=${FILE##*/}

deny() {
  jq -cn --arg r "$1" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

# R3 — generated / do-not-edit files (change the source + run the generator instead).
case "$FILE" in
  *pnpm-lock.yaml | */docs/routes.txt | */docs/openapi/openapi*.json | */docs/postman-collection.json | *project-identity.constants.ts | */docs/database/core-be.dbml)
    deny "'$base' is generated — do not hand-edit it. Change the source and run the generator (see agent-os/docs/skill-triggers.md / CLAUDE.md)." ;;
esac

# R1 — workers/processors must not call getRequestDatabase() (it returns the GUC-less pool and
# throws in worker runtime). Importing DB-handle types / setLocalDatabaseConfig from
# request-database.context is allowed — workers bind their handle via a context wrapper, matching
# no-direct-db-in-services.global.test.ts (which only forbids getRequestDatabase / database / sql).
case "$FILE" in
  *.worker.ts | *.processor.ts)
    if printf '%s' "$CONTENT" | grep -Eq 'getRequestDatabase'; then
      deny "Workers/processors must not call getRequestDatabase() (RLS — it returns the GUC-less pool). Bind a handle via a context wrapper — withOrganizationContext / runTenantScopedWorkerJob (CLAUDE.md → Organization context / RLS; enforced by global tests)."
    fi ;;
esac

# R2 — no `../` parent-relative imports under src/ (use the @/ alias).
case "$FILE" in
  */src/*.ts | */src/*.tsx | src/*.ts | src/*.tsx)
    if printf '%s' "$CONTENT" | grep -Eq "(from|require|import)[[:space:]]*\(?[[:space:]]*['\"]\.\./"; then
      deny "Relative parent import ('../') is banned under src/ — use the '@/' alias (import-paths.mdc; enforced by import-paths.global.test.ts)."
    fi ;;
esac

exit 0
