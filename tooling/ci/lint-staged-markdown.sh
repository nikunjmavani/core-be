#!/usr/bin/env bash
# Wrapper for lint-staged: runs markdownlint-cli2 --fix on staged *.md files,
# excluding auto-generated DOCS.md (owned by feature-doc-maintainer / regenerated
# by `pnpm features:generate`) and other pre-existing ignores.
#
# lint-staged passes file paths as arguments. We filter the list, then invoke
# markdownlint-cli2 only when at least one file remains.
set -euo pipefail

filtered=()
for path in "$@"; do
  case "$path" in
    */DOCS.md|*/node_modules/*|.claude/*|.github/PULL_REQUEST_TEMPLATE.md|CHANGELOG.md|CHANGELOG-dev.md)
      ;;
    *)
      filtered+=("$path")
      ;;
  esac
done

if [ "${#filtered[@]}" -eq 0 ]; then
  exit 0
fi

exec pnpm exec markdownlint-cli2 --config .markdownlint.json --fix "${filtered[@]}"
