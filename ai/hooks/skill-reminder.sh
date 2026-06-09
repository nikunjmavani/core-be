#!/usr/bin/env bash
# Claude Code PostToolUse hook.
# Reads Edit/Write tool JSON from stdin, extracts the edited file path,
# prints relevant skill reminders based on file pattern matching.

INPUT=$(cat)
FILE=$(echo "$INPUT" | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('file_path',''))" \
  2>/dev/null || echo "")

[[ -z "$FILE" ]] && exit 0

REMINDERS=()

[[ "$FILE" == *".routes.ts" ]] && \
  REMINDERS+=("routes → route-schema-doc-guard + route-catalog + seed-maintainer")

[[ "$FILE" == *".schema.ts" ]] && \
  REMINDERS+=("schema → sql-design-guard + db-migration-maintainer")

[[ "$FILE" == *"env-schema.ts"* || "$FILE" == *".env.example"* ]] && \
  REMINDERS+=("env → env-schema-add")

[[ "$FILE" == *"/locales/"*".json" ]] && \
  REMINDERS+=("i18n → i18n-message-guard")

[[ "$FILE" == *".validator.ts" || "$FILE" == *".serializer.ts" ]] && \
  REMINDERS+=("validator/serializer → test-generator")

[[ "$FILE" == *"/events/"*".ts" || "$FILE" == *"/workers/"*".ts" || \
   "$FILE" == *"/queues/"*".ts" ]] && \
  REMINDERS+=("events/workers/queues → workers-events skill")

[[ "$FILE" == *".container.ts" ]] && \
  REMINDERS+=("container → domain-generator (check DI wiring)")

if [[ "${#REMINDERS[@]}" -gt 0 ]]; then
  echo ""
  echo "⚡ Skill reminders for $(basename "$FILE"):"
  for r in "${REMINDERS[@]}"; do
    echo "  • $r"
  done
  echo "  Full map: ai/docs/skill-triggers.md"
fi

exit 0
