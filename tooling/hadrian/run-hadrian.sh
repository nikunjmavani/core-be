#!/usr/bin/env bash
# Run Hadrian REST authorization tests against a core-be environment.
#
# Usage:
#   tooling/hadrian/run-hadrian.sh local [extra hadrian flags...]
#   tooling/hadrian/run-hadrian.sh dev   [extra hadrian flags...]
#   tooling/hadrian/run-hadrian.sh local --dry-run    # preview the test plan, no requests
#
# Hadrian REST has NO --base-url flag: the target comes from the OpenAPI `servers`
# block, so this script generates the spec and patches servers[0].url per environment.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
ENVIRONMENT="${1:-local}"
shift || true
HADRIAN="${HADRIAN_BIN:-$HOME/go/bin/hadrian}"

case "$ENVIRONMENT" in
  local) BASE_URL="${CORE_BE_LOCAL_URL:-http://localhost:10000}" ;;
  dev)   BASE_URL="${CORE_BE_DEV_URL:?Set CORE_BE_DEV_URL to the deployed dev base URL}" ;;
  *) echo "usage: run-hadrian.sh [local|dev] [hadrian flags...]" >&2; exit 2 ;;
esac

command -v "$HADRIAN" >/dev/null 2>&1 || {
  echo "hadrian not found at $HADRIAN — install: go install github.com/praetorian-inc/hadrian/cmd/hadrian@latest" >&2
  exit 1
}

# 1. Generate the OpenAPI spec from route schemas.
echo "==> generating OpenAPI spec"
( cd "$ROOT" && pnpm docs:generate )

SPEC_SRC="$ROOT/docs/openapi/openapi.json"
SPEC_OUT="$HERE/.spec.$ENVIRONMENT.json"

# 2. Patch servers[0].url to the target environment.
echo "==> targeting $BASE_URL"
node -e '
  const fs = require("node:fs");
  const spec = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  spec.servers = [{ url: process.argv[2] }];
  fs.writeFileSync(process.argv[3], JSON.stringify(spec, null, 2));
' "$SPEC_SRC" "$BASE_URL" "$SPEC_OUT"

# 3. Load per-role tokens (gitignored). See README.md to populate.
if [ -f "$HERE/.tokens.env" ]; then
  set -a; . "$HERE/.tokens.env"; set +a
else
  echo "WARN: $HERE/.tokens.env not found — only the anonymous role will authenticate." >&2
fi

# 4. Run Hadrian (markdown report; v1.0.0 has no SARIF output).
echo "==> running hadrian against $ENVIRONMENT"
"$HADRIAN" test rest \
  --api "$SPEC_OUT" \
  --auth "$HERE/auth.yaml" \
  --roles "$HERE/roles.yaml" \
  --output markdown \
  --output-file "$HERE/report.$ENVIRONMENT.md" \
  --rate-limit 5 \
  --no-banner \
  "$@"

echo "==> report written to $HERE/report.$ENVIRONMENT.md"
