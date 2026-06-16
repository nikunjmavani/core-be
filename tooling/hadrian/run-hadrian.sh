#!/usr/bin/env bash
# Run Hadrian REST authorization tests against a core-be environment.
#
# Usage:
#   tooling/hadrian/run-hadrian.sh local [extra hadrian flags...]
#   tooling/hadrian/run-hadrian.sh dev   [extra hadrian flags...]
#   tooling/hadrian/run-hadrian.sh local --dry-run    # preview the plan, no requests
#
# Notes (verified against Hadrian v1.0.0):
#  - REST has NO --base-url flag: the target comes from the OpenAPI `servers` block,
#    so this script patches servers[0].url per environment.
#  - core-be's generated spec must be SANITIZED for strict (Go/RE2) parsers: it sets
#    `example`+`examples` together (OpenAPI-invalid) and uses PCRE lookahead `pattern`s
#    that RE2 cannot compile. Hadrian needs none of these, so we strip them.
#  - Hadrian's REST templates ship in the Go module cache; we copy them to a
#    gitignored local dir and pass --template-dir.
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

# 1. Generate the OpenAPI spec from route schemas (no DB/env required).
echo "==> generating OpenAPI spec"
( cd "$ROOT" && pnpm docs:generate )

SPEC_SRC="$ROOT/docs/openapi/openapi.json"
SPEC_OUT="$HERE/.spec.$ENVIRONMENT.json"

# 2. Set the target server + sanitize fields strict parsers reject (see header).
echo "==> targeting $BASE_URL (+ sanitizing spec for strict parser)"
node -e '
  const fs = require("node:fs");
  const spec = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  spec.servers = [{ url: process.argv[2] }];
  let stripped = 0;
  (function strip(node) {
    if (Array.isArray(node)) return node.forEach(strip);
    if (node && typeof node === "object") {
      for (const k of ["example", "examples", "pattern"]) if (k in node) { delete node[k]; stripped++; }
      for (const k of Object.keys(node)) strip(node[k]);
    }
  })(spec);
  fs.writeFileSync(process.argv[3], JSON.stringify(spec));
  console.error(`    sanitized ${stripped} example/examples/pattern keys`);
' "$SPEC_SRC" "$BASE_URL" "$SPEC_OUT"

# 3. Resolve Hadrian's REST templates from the installed module cache (gitignored copy).
TPL_DIR="$HERE/templates/rest"
if [ ! -d "$TPL_DIR" ] || [ -z "$(ls -A "$TPL_DIR" 2>/dev/null)" ]; then
  TPL_SRC="$(ls -d "$(go env GOPATH 2>/dev/null)/pkg/mod/github.com/praetorian-inc/hadrian@"*/templates/rest 2>/dev/null | sort -V | tail -1 || true)"
  if [ -n "${TPL_SRC:-}" ]; then
    echo "==> vendoring templates from $TPL_SRC"
    mkdir -p "$HERE/templates"; cp -r "$TPL_SRC" "$HERE/templates/"; chmod -R u+w "$HERE/templates"
  else
    echo "WARN: could not locate Hadrian REST templates in the module cache." >&2
  fi
fi

# 4. Load per-role tokens (gitignored). See README.md to populate.
if [ -f "$HERE/.tokens.env" ]; then
  set -a; . "$HERE/.tokens.env"; set +a
else
  echo "WARN: $HERE/.tokens.env not found — only the anonymous role will authenticate." >&2
fi

# 5. Run Hadrian (markdown report; v1.0.0 has no SARIF output).
echo "==> running hadrian against $ENVIRONMENT"
"$HADRIAN" test rest \
  --api "$SPEC_OUT" \
  --auth "$HERE/auth.yaml" \
  --roles "$HERE/roles.yaml" \
  --template-dir "$TPL_DIR" \
  --output markdown \
  --output-file "$HERE/report.$ENVIRONMENT.md" \
  --rate-limit 5 \
  --no-banner \
  "$@"

echo "==> report written to $HERE/report.$ENVIRONMENT.md"
