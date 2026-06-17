#!/usr/bin/env bash
# Install the Headroom CLI + register its MCP server for Claude Code on the web
# (cloud agent) sessions. Headroom (headroom-ai) is a local context-compression
# layer: its MCP server exposes headroom_compress / headroom_retrieve /
# headroom_stats so agents shrink large tool output, logs, files, and RAG chunks
# before they reach the model. See agent-os/rules/headroom-context-compression.mdc
# and docs/integrations/agentic-third-party-tooling.md.
#
# Usage: paste into the environment's *Setup script* field (runs as root, cached),
# or run standalone:
#
#     bash tooling/setup/agent/install-headroom.sh
#
# Network: needs pypi.org + files.pythonhosted.org (PyPI) for the install.
#
# IMPORTANT (MCP): installing the CLI does NOT auto-connect the headroom MCP tools
# in a running session. In Claude Code on the web the live MCP server set is loaded
# by the platform at session start from your account/environment MCP settings — NOT
# the repo .mcp.json. Configure the `headroom` server (command `headroom mcp serve`)
# in the web UI MCP settings for the tools to appear, then start a fresh session.
# `headroom mcp install` (run below, best-effort) wires it for LOCAL clients.
#
# Idempotent and best-effort: never hard-fails the setup chain. Diagnostics → stderr.
set -uo pipefail

# Lightweight MCP-only extra; use headroom-ai[all] for the full embedder runtime.
readonly HEADROOM_PACKAGE="headroom-ai[mcp]"

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${repository_root}" || exit 0

# Put the user-local bin (where uv / pipx / pip --user drop console scripts) on
# PATH, both for this process and — when running as the cached Setup script — for
# every later session via CLAUDE_ENV_FILE. Mirrors the PATH handling in
# install-node.sh / install-codegraph.sh.
user_bin="${HOME}/.local/bin"
case ":${PATH}:" in
  *":${user_bin}:"*) : ;;
  *)
    export PATH="${user_bin}:${PATH}"
    [ -n "${CLAUDE_ENV_FILE:-}" ] && printf 'export PATH=%s:$PATH\n' "${user_bin}" >> "${CLAUDE_ENV_FILE}"
    ;;
esac

if command -v headroom >/dev/null 2>&1; then
  echo "install-headroom: headroom already installed ($(headroom --version 2>/dev/null || echo present)) — skipping install." >&2
else
  # Prefer uv (already the repo's Python tool runner for MCP servers); fall back to
  # pipx, then pip --user. The PEP 668 "externally-managed" marker on system Python
  # blocks a bare system pip install, so isolated installers (uv / pipx) come first.
  installed=0
  if command -v uv >/dev/null 2>&1; then
    echo "install-headroom: installing '${HEADROOM_PACKAGE}' via \`uv tool install\`…" >&2
    uv tool install "${HEADROOM_PACKAGE}" >&2 2>&1 && installed=1
  fi
  if [ "${installed}" -eq 0 ] && command -v pipx >/dev/null 2>&1; then
    echo "install-headroom: installing '${HEADROOM_PACKAGE}' via \`pipx install\`…" >&2
    pipx install "${HEADROOM_PACKAGE}" >&2 2>&1 && installed=1
  fi
  if [ "${installed}" -eq 0 ] && command -v python3 >/dev/null 2>&1; then
    echo "install-headroom: installing '${HEADROOM_PACKAGE}' via \`pip install --user\`…" >&2
    if python3 -m pip install --user "${HEADROOM_PACKAGE}" >&2 2>&1 \
      || python3 -m pip install --user --break-system-packages "${HEADROOM_PACKAGE}" >&2 2>&1; then
      installed=1
    fi
  fi
  if [ "${installed}" -eq 0 ]; then
    echo "install-headroom: install failed — install \`uv\` (or pipx) and run \`uv tool install '${HEADROOM_PACKAGE}'\` manually (non-fatal)." >&2
    exit 0
  fi
fi

# uv may have just created ${user_bin}; refresh the command hash table so the new
# `headroom` console script resolves in this shell.
hash -r 2>/dev/null || true

if command -v headroom >/dev/null 2>&1; then
  # Best-effort, non-interactive (stdin closed so any prompt gets EOF instead of
  # blocking the cached Setup script).
  echo "install-headroom: registering MCP server (headroom mcp install)…" >&2
  headroom mcp install </dev/null >&2 2>&1 \
    || echo "install-headroom: \`headroom mcp install\` failed — configure the MCP \`headroom\` server manually (non-fatal)." >&2
  echo "install-headroom: done ($(headroom --version 2>/dev/null || echo 'cli unavailable'))." >&2
else
  echo "install-headroom: headroom CLI not on PATH after install (check ${user_bin}) — non-fatal." >&2
fi
exit 0
