#!/usr/bin/env bash
# Neon PITR branch helpers for the monthly restore drill workflow.
# Requires: MONTHLY_DATABASE_RESTORE_DRILL_NEON_API_KEY, MONTHLY_DATABASE_RESTORE_DRILL_NEON_PROJECT_ID,
#           RESTORE_DRILL_PARENT_BRANCH_NAME (GitHub ref name for the workflow run), jq, curl

set -euo pipefail

NEON_API_BASE="${NEON_API_BASE:-https://console.neon.tech/api/v2}"
PITR_LOOKBACK_MINUTES="${PITR_LOOKBACK_MINUTES:-15}"
BRANCH_TTL_HOURS="${BRANCH_TTL_HOURS:-2}"
OPERATION_POLL_INTERVAL_SECONDS="${OPERATION_POLL_INTERVAL_SECONDS:-2}"
OPERATION_POLL_TIMEOUT_SECONDS="${OPERATION_POLL_TIMEOUT_SECONDS:-300}"

neon_api_key() {
  printf '%s' "${MONTHLY_DATABASE_RESTORE_DRILL_NEON_API_KEY:?MONTHLY_DATABASE_RESTORE_DRILL_NEON_API_KEY is required}"
}

neon_project_id() {
  printf '%s' "${MONTHLY_DATABASE_RESTORE_DRILL_NEON_PROJECT_ID:?MONTHLY_DATABASE_RESTORE_DRILL_NEON_PROJECT_ID is required}"
}

neon_request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local response_file
  response_file="$(mktemp)"
  local status
  if [ -n "$body" ]; then
    status="$(curl -sS -o "$response_file" -w '%{http_code}' -X "$method" \
      "${NEON_API_BASE}${path}" \
      -H "Authorization: Bearer $(neon_api_key)" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json" \
      --data "$body")"
  else
    status="$(curl -sS -o "$response_file" -w '%{http_code}' -X "$method" \
      "${NEON_API_BASE}${path}" \
      -H "Authorization: Bearer $(neon_api_key)" \
      -H "Accept: application/json")"
  fi
  if [ "$status" -lt 200 ] || [ "$status" -ge 300 ]; then
    echo "::error::Neon API ${method} ${path} failed with HTTP ${status}: $(cat "$response_file")"
    rm -f "$response_file"
    exit 1
  fi
  cat "$response_file"
  rm -f "$response_file"
}

wait_for_neon_operations() {
  local project_id
  project_id="$(neon_project_id)"
  local deadline=$(( $(date +%s) + OPERATION_POLL_TIMEOUT_SECONDS ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    local operations_json
    operations_json="$(neon_request GET "/projects/${project_id}/operations")"
    local pending_count
    pending_count="$(printf '%s' "$operations_json" | jq '[.operations[]? | select(.status != "finished" and .status != "failed" and .status != "error" and .status != "skipped")] | length')"
    if [ "$pending_count" -eq 0 ]; then
      return 0
    fi
    sleep "$OPERATION_POLL_INTERVAL_SECONDS"
  done
  echo "::error::Timed out waiting for Neon operations on project ${project_id}"
  exit 1
}

resolve_parent_branch_id() {
  local parent_branch_name="${RESTORE_DRILL_PARENT_BRANCH_NAME:?RESTORE_DRILL_PARENT_BRANCH_NAME is required}"
  local project_id
  project_id="$(neon_project_id)"
  local branches_json
  branches_json="$(neon_request GET "/projects/${project_id}/branches")"
  local parent_branch_id
  parent_branch_id="$(printf '%s' "$branches_json" | jq -r --arg name "$parent_branch_name" '.branches[]? | select(.name == $name) | .id' | head -n 1)"
  if [ -z "$parent_branch_id" ]; then
    echo "::error::Could not resolve Neon parent branch named ${parent_branch_name} (workflow ref ${RESTORE_DRILL_PARENT_BRANCH_NAME})"
    exit 1
  fi
  printf '%s' "$parent_branch_id"
}

create_restore_drill_branch() {
  : "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

  local project_id restore_start_epoch parent_timestamp expires_at parent_branch_id parent_branch_name branch_name create_body create_json
  project_id="$(neon_project_id)"
  parent_branch_name="${RESTORE_DRILL_PARENT_BRANCH_NAME:?RESTORE_DRILL_PARENT_BRANCH_NAME is required}"
  restore_start_epoch="$(date +%s)"
  parent_timestamp="$(date -u -d "${PITR_LOOKBACK_MINUTES} minutes ago" +%Y-%m-%dT%H:%M:%SZ)"
  expires_at="$(date -u -d "+${BRANCH_TTL_HOURS} hours" +%Y-%m-%dT%H:%M:%SZ)"
  parent_branch_id="$(resolve_parent_branch_id)"
  branch_name="restore-drill-${GITHUB_RUN_ID:-local}"

  create_body="$(jq -n \
    --arg name "$branch_name" \
    --arg parent_id "$parent_branch_id" \
    --arg parent_timestamp "$parent_timestamp" \
    --arg expires_at "$expires_at" \
    '{
      branch: {
        name: $name,
        parent_id: $parent_id,
        parent_timestamp: $parent_timestamp,
        expires_at: $expires_at
      },
      endpoints: [{ type: "read_write" }]
    }')"

  echo "Creating Neon restore drill branch ${branch_name} from parent ${parent_branch_name} at ${parent_timestamp}"
  create_json="$(neon_request POST "/projects/${project_id}/branches" "$create_body")"
  wait_for_neon_operations

  local branch_id database_url
  branch_id="$(printf '%s' "$create_json" | jq -r '.branch.id')"
  database_url="$(printf '%s' "$create_json" | jq -r '.connection_uris[0].connection_uri // empty')"
  if [ -z "$database_url" ]; then
    database_url="$(neon_request GET "/projects/${project_id}/connection_uri?branch_id=${branch_id}&database_name=neondb&role_name=neondb_owner&pooled=true" | jq -r '.uri')"
  fi
  if [ -z "$database_url" ] || [ "$database_url" = "null" ]; then
    echo "::error::Neon did not return a connection URI for branch ${branch_id}"
    exit 1
  fi

  {
    echo "database_url=${database_url}"
    echo "branch_id=${branch_id}"
    echo "restore_start_epoch=${restore_start_epoch}"
    echo "restore_source=neon_pitr_branch"
    echo "parent_branch_name=${parent_branch_name}"
    echo "parent_timestamp=${parent_timestamp}"
  } >> "$GITHUB_OUTPUT"
}

delete_restore_drill_branch() {
  if [ -z "${DRILL_BRANCH_ID:-}" ]; then
    echo "No DRILL_BRANCH_ID set; skipping Neon branch cleanup."
    return 0
  fi
  local project_id
  project_id="$(neon_project_id)"
  echo "Deleting Neon restore drill branch ${DRILL_BRANCH_ID}"
  neon_request DELETE "/projects/${project_id}/branches/${DRILL_BRANCH_ID}" >/dev/null || true
}

case "${1:-}" in
  create) create_restore_drill_branch ;;
  delete) delete_restore_drill_branch ;;
  *)
    echo "Usage: $0 create|delete" >&2
    exit 1
    ;;
esac
