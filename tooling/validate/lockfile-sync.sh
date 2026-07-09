#!/usr/bin/env sh
# Lockfile ↔ package.json / pnpm-workspace.yaml sync gate.
#
# A change to package.json dependencies — or to the `overrides` block in
# pnpm-workspace.yaml — that does NOT regenerate pnpm-lock.yaml produces
# ERR_PNPM_LOCKFILE_CONFIG_MISMATCH and fails EVERY frozen-install CI job,
# including the release-please PR, whose branch inherits the mismatch and goes
# all-red until the lockfile is regenerated.
#
# `pnpm install --frozen-lockfile` is exactly what CI runs: it errors immediately
# on any lockfile/config mismatch (before network work), so we run it locally as a
# pre-commit shift-left. Gated on staged package.json / pnpm-lock.yaml /
# pnpm-workspace.yaml by src/scripts/tooling/run-pre-commit-guard.ts, so ordinary
# commits stay fast.
set -e

cd "$(dirname "$0")/../.."

if pnpm install --frozen-lockfile --prefer-offline --ignore-scripts >/dev/null 2>&1; then
  echo "[validate-lockfile] OK: pnpm-lock.yaml is in sync with package.json / pnpm-workspace.yaml."
  exit 0
fi

echo "[validate-lockfile] ERROR: pnpm-lock.yaml is out of sync."
echo "  A dependency (package.json) or pnpm.overrides (pnpm-workspace.yaml) changed"
echo "  without regenerating the lockfile."
echo "  Fix: run 'pnpm install', then commit the lockfile alongside the change."
echo "  A desynced lockfile breaks every frozen-install CI job and must never reach main."
echo ""
echo "  pnpm error:"
pnpm install --frozen-lockfile --prefer-offline --ignore-scripts 2>&1 | sed 's/^/    /'
exit 1
