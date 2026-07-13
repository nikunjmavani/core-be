#!/usr/bin/env bash
# Wait until docker compose Postgres is accepting connections, or exit non-zero.
#
# Uses credentials from docker-compose.yml (user/database: core).
#
# Env:
#   WAIT_FOR_POSTGRES_ATTEMPTS (default 60) — retry count
#   WAIT_FOR_POSTGRES_INTERVAL_SECONDS (default 1) — sleep between attempts
#
# Usage (from repo root): pnpm compose:wait  (canonical: pnpm compose:wait)
set -euo pipefail

readonly MAXIMUM_ATTEMPTS="${WAIT_FOR_POSTGRES_ATTEMPTS:-60}"
readonly INTERVAL_SECONDS="${WAIT_FOR_POSTGRES_INTERVAL_SECONDS:-1}"

for ((attempt_index = 1; attempt_index <= MAXIMUM_ATTEMPTS; attempt_index++)); do
  set +e
  readiness_output="$(docker compose exec -T postgres pg_isready -U core -d core 2>&1)"
  readiness_exit_code=$?
  set -e

  if [[ "${readiness_exit_code}" -eq 0 ]]; then
    echo "Postgres is accepting connections."
    exit 0
  fi

  if [[ "${readiness_output}" == *"not running"* ]]; then
    echo "Postgres service is not running. Start it with: docker compose up -d postgres" >&2
    echo "${readiness_output}" >&2
    exit 1
  fi

  sleep "${INTERVAL_SECONDS}"
done

echo "Postgres did not become ready within $((MAXIMUM_ATTEMPTS * INTERVAL_SECONDS)) seconds." >&2
echo "--- docker compose logs postgres (tail 80) ---" >&2
docker compose logs postgres --tail 80 >&2 || true
exit 1
