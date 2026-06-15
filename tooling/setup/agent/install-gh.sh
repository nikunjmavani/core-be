#!/usr/bin/env bash
# Install the GitHub CLI (gh) for Claude Code on the web (cloud agent) sessions.
#
# Why: gives an in-session GitHub fallback — read Actions logs, check CI, merge —
# alongside the GitHub MCP tools (which already cover this). Paste into the
# environment's *Setup script* field (runs as root, cached), AFTER install-node.sh:
#
#     bash tooling/setup/agent/install-node.sh
#     bash tooling/setup/agent/install-gh.sh
#
# Auth: set GH_TOKEN in the environment's *Variables* — gh reads it automatically,
# no `gh auth login` needed. Use a least-privilege token (repo: contents +
# pull_requests + actions:read is enough to read logs and merge). Environment
# variables are visible to anyone who can edit the environment — there is no
# secrets store.
#
# Idempotent and best-effort: never hard-fails the setup chain over an optional
# tool. Output goes to stderr (diagnostics).
set -uo pipefail

if command -v gh >/dev/null 2>&1; then
  echo "install-gh: $(gh --version | head -1) already present — nothing to do." >&2
  exit 0
fi

# 1) Distro package first — present on the cloud image; needs only the Ubuntu
#    mirrors (in the default Trusted allowlist).
if apt-get update >/dev/null 2>&1 && apt-get install -y gh >/dev/null 2>&1; then
  echo "install-gh: installed $(gh --version | head -1) via apt." >&2
  exit 0
fi

# 2) Fallback — official GitHub CLI apt repo (needs cli.github.com on the
#    network allowlist; add it under Custom access if Trusted blocks it).
echo "install-gh: gh not in base repos — adding the official GitHub CLI apt repo." >&2
keyring=/etc/apt/keyrings/githubcli-archive-keyring.gpg
install -m 0755 -d /etc/apt/keyrings
if curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o "$keyring"; then
  chmod go+r "$keyring"
  printf 'deb [arch=%s signed-by=%s] https://cli.github.com/packages stable main\n' \
    "$(dpkg --print-architecture)" "$keyring" > /etc/apt/sources.list.d/github-cli.list
  if apt-get update >/dev/null 2>&1 && apt-get install -y gh >/dev/null 2>&1; then
    echo "install-gh: installed $(gh --version | head -1) via cli.github.com." >&2
    exit 0
  fi
fi

echo "install-gh: could not install gh — check that cli.github.com is on the network allowlist." >&2
exit 0
