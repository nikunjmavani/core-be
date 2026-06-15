#!/usr/bin/env bash
# Claude Code UserPromptSubmit hook.
#
# When a prompt looks like a NEW REQUIREMENT (new domain, route, schema, worker,
# queue, event, or seed), inject a short reminder to follow the intake workflow —
# consult skill-index first, propose one Plan, then run the matching skills — so
# the agent does not skip straight to editing. Pure context injection; never blocks.
#
# stdout / additionalContext on a UserPromptSubmit hook is added to Claude's
# context (exit 0). When the prompt shows no new-requirement signal, it stays silent.
#
# Fails OPEN: a missing jq, an empty prompt, or any error injects nothing and exits 0.
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat)
PROMPT=$(printf '%s' "$INPUT" | jq -r '.prompt // empty' 2>/dev/null || echo "")
[[ -z "$PROMPT" ]] && exit 0

# Conservative signal: a build verb (or leading "new") immediately before a
# requirement noun, plus a few standalone phrases. A plain question that merely
# mentions a noun ("how does the worker queue work?") must NOT trigger.
signal_pattern='(add|adding|create|creating|implement|implementing|build|building|scaffold|scaffolding|introduce|introducing|new)[[:space:]]+((a|an|the|new|another)[[:space:]]+)*(sub-?domain|domain|route|endpoint|table|column|schema|migration|worker|queue|event|background[[:space:]]+job|cron|seed)|new requirement|requirement intake|port[[:space:]].*supabase'

shopt -s nocasematch
if [[ ! "$PROMPT" =~ $signal_pattern ]]; then
  exit 0
fi
shopt -u nocasematch

context="$(
  cat <<'EOF'
📋 This prompt looks like a NEW REQUIREMENT (domain / route / schema / worker / queue / seed).
Before editing code, follow docs/getting-started/requirement-intake.md:
  1. Consult agent-os/skills/skill-index/SKILL.md FIRST to choose the skill(s) for what you change.
  2. Apply the intake defaults, then propose ONE Plan (requirement type, files, ordered skills, verification).
  3. After "go", run the matching skills in order; .cursor rules auto-attach by file glob.
Skill routing map: agent-os/docs/skill-triggers.md
EOF
)"

jq -cn --arg c "$context" \
  '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:$c}}'
exit 0
