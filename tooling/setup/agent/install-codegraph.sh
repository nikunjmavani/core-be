#!/usr/bin/env bash
# Install the CodeGraph CLI + build its semantic index for Claude Code on the web
# (cloud agent) sessions. CodeGraph (@colbymchenry/codegraph) builds a local SQLite
# knowledge graph of the repo under .codegraph/ and exposes it to AI agents over an
# MCP server, so they query a pre-built index instead of grep + read loops. See
# docs/integrations/codegraph.md.
#
# Usage: paste into the environment's *Setup script* field (runs as root, cached),
# AFTER install-node.sh (needs node/npm on PATH):
#
#     bash tooling/setup/agent/install-node.sh
#     bash tooling/setup/agent/install-codegraph.sh
#
# Network: needs registry.npmjs.org (in the default Trusted allowlist) for the
# global npm install — no extra allowlist entry required.
#
# IMPORTANT (MCP): installing the CLI + index does NOT auto-connect the codegraph
# MCP tools in a running session. In Claude Code on the web the live MCP server set
# is loaded by the platform at session start from your account/environment MCP
# settings — NOT the repo .mcp.json this writes. Configure the `codegraph` server
# in the web UI MCP settings (command `codegraph serve --mcp`) for the tools to
# appear, then start a fresh session. The CLI (`codegraph query/context/status`)
# works immediately regardless.
#
# Idempotent and best-effort: never hard-fails the setup chain. Diagnostics → stderr.
set -uo pipefail

readonly CODEGRAPH_PACKAGE="@colbymchenry/codegraph"

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${repository_root}" || exit 0

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "install-codegraph: node/npm not on PATH — run install-node.sh first (non-fatal)." >&2
  exit 0
fi

if ! command -v codegraph >/dev/null 2>&1; then
  echo "install-codegraph: installing ${CODEGRAPH_PACKAGE}…" >&2
  if ! npm install -g "${CODEGRAPH_PACKAGE}" >&2 2>&1; then
    echo "install-codegraph: global install failed — run \`npm i -g ${CODEGRAPH_PACKAGE}\` manually (non-fatal)." >&2
    exit 0
  fi
fi

if [ -f .codegraph/codegraph.db ] && [ -f .mcp.json ]; then
  echo "install-codegraph: index present — refreshing (codegraph sync)…" >&2
  codegraph sync >&2 2>&1 || echo "install-codegraph: sync failed (non-fatal)." >&2
else
  echo "install-codegraph: building index + writing Claude MCP config…" >&2
  codegraph install --target=claude --location=local --yes >&2 2>&1 \
    || echo "install-codegraph: index build failed (non-fatal)." >&2
fi

echo "install-codegraph: done ($(codegraph --version 2>/dev/null || echo 'cli unavailable'))." >&2
exit 0
