#!/usr/bin/env bash
# Lint markdown files that have changed vs the target branch.
#
# Mirrors the GitHub Actions "Markdown lint + links" job in
# .github/workflows/pr-docs-lane.yml so contributors can reproduce CI
# locally before pushing. Pre-push hook (.husky/pre-push) calls this
# script when the push contains markdown changes.
#
# Usage:
#   tooling/ci/lint-changed-markdown.sh                # vs origin/dev (default)
#   LINT_BASE=origin/main tooling/ci/lint-changed-markdown.sh
#
# Exits 0 when no markdown files changed or all changed files lint clean.
# Compatible with bash 3.2 (default macOS shell).

set -eu

target="${LINT_BASE:-origin/dev}"
base_ref="${target#origin/}"

if ! git rev-parse --verify --quiet "${target}" >/dev/null; then
  if git fetch origin "${base_ref}" --quiet 2>/dev/null; then
    :
  else
    echo "Skipping changed-markdown lint: cannot resolve ${target} (no network or unknown branch)."
    exit 0
  fi
fi

changed_files_raw="$(git diff --name-only --diff-filter=ACMRT "${target}"..HEAD -- '*.md')"

# Auto-generated DOCS.md files are owned by `pnpm features:generate`
# (regenerated from sources, not hand-edited). Exclude them — they're already
# gated by `pnpm features:check:strict`, not by markdown lint.
changed_files="$(printf '%s\n' "${changed_files_raw}" | grep -v -E '(^|/)DOCS\.md$' || true)"

if [ -z "${changed_files}" ]; then
  echo "No changed markdown files vs ${target} (after excluding auto-generated DOCS.md)."
  exit 0
fi

count="$(printf '%s\n' "${changed_files}" | wc -l | tr -d ' ')"
echo "Linting ${count} changed markdown file(s) vs ${target}:"
printf '  - %s\n' ${changed_files}

# shellcheck disable=SC2086
pnpm exec markdownlint-cli2 --config .markdownlint.json ${changed_files}
