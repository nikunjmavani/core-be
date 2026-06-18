#!/usr/bin/env bash
#
# One command to run the comprehensive journey load test from scratch:
# front-load every prerequisite (setup-loadtest.sh) -> run k6 -> leave the rig up.
#
#   pnpm load:journey                                  # 100 VU, 10 workers, 60s
#   VUS=200 WORKERS=10 DURATION=90s pnpm load:journey  # override any knob
#
# Re-run fast (rig already up, skips setup):
#   RUN=$(date +%s) VUS=100 DURATION=60s k6 run src/tests/load/k6/scenarios/comprehensive-journey.js
# Tear down when done:
#   pnpm load:journey:down
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

VUS="${VUS:-100}"
WORKERS="${WORKERS:-10}"
DURATION="${DURATION:-60s}"

# 1. Front-load every prerequisite + verify (env, Postgres sizing, asset copy, Redis
#    port-forward heal, seed, cleanup, cluster). Aborts here if any prerequisite fails.
bash src/tests/load/k6/setup-loadtest.sh "$VUS" "$WORKERS"

# 2. Run the journey.
echo
echo "==> comprehensive journey: $VUS VU for $DURATION"
RUN="$(date +%s)" VUS="$VUS" DURATION="$DURATION" \
  k6 run src/tests/load/k6/scenarios/comprehensive-journey.js

# 3. Leave the rig up so the next run is instant (re-run the k6 line above).
echo
echo "==> done. Rig left running for fast re-runs."
echo "    re-run:    VUS=$VUS DURATION=$DURATION RUN=\$(date +%s) k6 run src/tests/load/k6/scenarios/comprehensive-journey.js"
echo "    teardown:  pnpm load:journey:down"
