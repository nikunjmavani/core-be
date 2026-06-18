#!/usr/bin/env bash
# Claude Code SessionEnd hook for core-be.
#
# When the session ends, surface anything that would be lost: uncommitted
# working-tree changes (the cloud env is ephemeral — uncommitted work is
# discarded when the container is reclaimed) and any in-progress autonomous
# build under docs/builds/. Informational only; fail-open (always exits 0).
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT" 2>/dev/null || exit 0

changed="$(git status --porcelain 2>/dev/null)" || changed=""
echo ""
if [ -n "$changed" ]; then
  count="$(printf '%s\n' "$changed" | wc -l | tr -d ' ')"
  echo "⚠ Session ending with ${count} uncommitted change(s). The cloud env is ephemeral —"
  echo "  commit + push to preserve: git add -A && git commit && git push -u origin \"\$(git branch --show-current)\"."
else
  echo "✓ Session ending — working tree clean."
fi
build_dir="$(ls -dt docs/builds/*/ 2>/dev/null | head -1)"
[ -n "$build_dir" ] && echo "  In-progress build: ${build_dir} (resume from its build-manifest)."
exit 0
