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

# Activate the repo's pinned Node (.nvmrc) on PATH before the global install, so
# the codegraph CLI is installed under the pinned Node — not the image default —
# even when this runs as a standalone Setup-script line rather than via
# bootstrap.sh. install-node.sh drops the pinned Node into <prefix>/node<major>
# but runs in a child process and cannot change THIS shell's PATH; mirror the
# candidate search in agent-os/hooks/session-start.sh (honors NODE_INSTALL_PREFIX).
required_major="24"
[ -f .nvmrc ] && required_major="$(tr -dc '0-9.' < .nvmrc | cut -d. -f1)"
current_major="$(node -v 2>/dev/null | tr -dc '0-9.' | cut -d. -f1)"
current_major="${current_major:-0}"
if [ "${current_major}" -lt "${required_major}" ] 2>/dev/null; then
  node_prefix="${NODE_INSTALL_PREFIX:-/opt}"
  for candidate in \
    "${node_prefix}/node${required_major}/bin" \
    /opt/node"${required_major}"*/bin \
    "${HOME}/.nvm/versions/node/v${required_major}"*/bin \
    /usr/local/node"${required_major}"*/bin; do
    [ -x "${candidate}/node" ] || continue
    export PATH="${candidate}:${PATH}"
    [ -n "${CLAUDE_ENV_FILE:-}" ] && printf 'export PATH=%s:$PATH\n' "${candidate}" >> "${CLAUDE_ENV_FILE}"
    echo "install-codegraph: switched to Node $("${candidate}/node" -v) at ${candidate}." >&2
    break
  done
fi

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
