#!/usr/bin/env bash
set -euo pipefail
STEP_NUM=$1
STEP_TOTAL=$2
LABEL=$3
shift 3
echo "▶ Step ${STEP_NUM}/${STEP_TOTAL}: ${LABEL}"
if "$@"; then
  echo "✓ ${LABEL}"
else
  CODE=$?
  echo "✗ FAILED at step ${STEP_NUM}/${STEP_TOTAL}: ${LABEL} (exit ${CODE})" >&2
  exit "${CODE}"
fi
