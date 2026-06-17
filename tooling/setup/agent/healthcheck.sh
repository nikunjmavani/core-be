#!/usr/bin/env bash
# Health-check the running core-be app after the stack is live — the last step of a
# Claude Code on the web (cloud agent) bring-up. Probes the two public health
# endpoints and fails loudly if the app or any dependency is unhealthy:
#
#   GET /livez  — liveness: process/event loop responsive (200; 503 only while draining)
#   GET /readyz — readiness: Postgres + Redis + BullMQ reachable (200, or 503 if any down)
#
# This starts nothing itself — run it AFTER the stack and app are up in-session:
#
#     pnpm compose:up && pnpm compose:wait
#     pnpm db:migrate && pnpm db:seed
#     pnpm dev &                                    # (or pnpm dev:worker, with WORKER_HEALTH_PORT)
#     bash tooling/setup/agent/healthcheck.sh
#
# It does NOT belong in the environment *Setup script* field: that runs as root
# before the session, when no app is listening, so /readyz would always fail.
#
# Config (env):
#   HEALTHCHECK_URL          base URL (default http://127.0.0.1:${PORT:-3000})
#   HEALTHCHECK_RETRIES      liveness attempts before giving up (default 45)
#   HEALTHCHECK_RETRY_DELAY  seconds between attempts (default 1)
#
# Exits 0 only when /livez AND /readyz both return 200 (the app returns 503 from
# /readyz if any dependency is unreachable), so it works as a bring-up / CI gate.
set -uo pipefail

readonly BASE_URL="${HEALTHCHECK_URL:-http://127.0.0.1:${PORT:-3000}}"
readonly RETRIES="${HEALTHCHECK_RETRIES:-45}"
readonly RETRY_DELAY="${HEALTHCHECK_RETRY_DELAY:-1}"

fail() {
  echo "healthcheck: FAIL — $*" >&2
  exit 1
}

# 1) Liveness — wait (bounded) for the server to accept connections and return 200.
code="000"
for _ in $(seq 1 "${RETRIES}"); do
  code="$(curl -sS -m 5 -o /dev/null -w '%{http_code}' "${BASE_URL}/livez" 2>/dev/null)"
  [ -n "${code}" ] || code="000"
  [ "${code}" = "200" ] && break
  sleep "${RETRY_DELAY}"
done
[ "${code}" = "200" ] || fail "GET ${BASE_URL}/livez returned ${code} after ${RETRIES} attempts — is the app running?"
echo "healthcheck: /livez 200 (live)" >&2

# 2) Readiness — 200 means Postgres + Redis + BullMQ all reachable; 503 otherwise.
body_file="$(mktemp)"
code="$(curl -sS -m 8 -o "${body_file}" -w '%{http_code}' "${BASE_URL}/readyz" 2>/dev/null)"
[ -n "${code}" ] || code="000"
body="$(cat "${body_file}" 2>/dev/null)"
rm -f "${body_file}"
[ "${code}" = "200" ] || fail "GET ${BASE_URL}/readyz returned ${code} — body: ${body:-<empty>}"

# Report each dependency from the body (informational — the 200 above is the gate).
for dep in database redis bullmq; do
  if command -v jq >/dev/null 2>&1; then
    state="$(printf '%s' "${body}" | jq -r --arg d "${dep}" '.[$d] // "n/a"' 2>/dev/null)"
  else
    state="$(printf '%s' "${body}" | grep -oE "\"${dep}\":\"[^\"]*\"" | head -1 | sed 's/.*://; s/"//g')"
  fi
  echo "healthcheck: /readyz ${dep}=${state:-n/a}" >&2
done

echo "healthcheck: OK — ${BASE_URL} live & ready." >&2
echo "${body}"
exit 0
