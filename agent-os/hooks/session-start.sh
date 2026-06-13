#!/usr/bin/env bash
# Claude Code SessionStart hook.
#
# Injects the agent-os routing map into the model's context at session start, so
# every session begins already knowing which skill to run for a given change —
# baking in CLAUDE.md's "consult skill-index FIRST" mandate instead of hoping the
# model reads it. Emitted as additionalContext (the channel the model actually
# sees), not stdout.
#
# Fails OPEN: missing map or missing jq → no context, never an error.

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
MAP="$ROOT/agent-os/docs/skill-triggers.md"

[[ -f "$MAP" ]] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

CONTEXT=$(printf 'agent-os skill routing — consult skill-index FIRST, then run the listed skill(s) for the files you change:\n\n%s' "$(cat "$MAP")")

jq -cn --arg c "$CONTEXT" \
  '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$c}}'
