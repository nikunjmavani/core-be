#!/usr/bin/env bash
# Non-interactive macOS external-tool installer for `pnpm setup:local`.
#
# Installs-or-UPGRADES every external tool the project uses that `pnpm install`
# cannot provide, from AUTHENTICATED sources only and with NO prompts/pauses, so
# setup runs fully hands-off:
#   - Homebrew (official installer, NONINTERACTIVE) → then all brew formulae
#   - Node.js (the .nvmrc-pinned major) via Homebrew — only if missing/older; an
#     existing nvm/fnm-managed Node is left alone. pnpm comes via corepack.
#   - gitleaks, gh, jq, uv, pipx         via Homebrew (checksummed official formulae)
#   - a headless Docker runtime (colima)  via Homebrew — only if none is present
#   - codegraph  (@colbymchenry/codegraph) via the npm registry (latest)
#   - headroom   (headroom-ai[mcp])        via PyPI through pipx
#
# macOS only for now — a no-op on other platforms. Idempotent: present tools are
# upgraded, missing tools installed. No tool is a prerequisite; Homebrew itself is
# bootstrapped if absent.
#
#   --check / --dry-run : report what WOULD be installed/upgraded; change nothing.

set -uo pipefail

DRY_RUN=0
case "${1:-}" in
  --check | --dry-run) DRY_RUN=1 ;;
esac

log() { printf 'setup-mac-tools: %s\n' "$*" >&2; }

# macOS only for now.
if [ "$(uname -s)" != "Darwin" ]; then
  log "not macOS — skipping (mac-only for now)."
  exit 0
fi

# Run a command, or in dry-run mode just print it.
run() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '  would run: %s\n' "$*" >&2
  else
    "$@"
  fi
}

# --- Homebrew: bootstrap non-interactively from the official installer if absent ---
ensure_brew_on_path() {
  command -v brew >/dev/null 2>&1 && return 0
  if [ -x /opt/homebrew/bin/brew ]; then eval "$(/opt/homebrew/bin/brew shellenv)"; fi
  if ! command -v brew >/dev/null 2>&1 && [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
  command -v brew >/dev/null 2>&1
}

if ! ensure_brew_on_path; then
  log "Homebrew not found — installing (official installer, non-interactive)…"
  if [ "$DRY_RUN" = "1" ]; then
    printf '  would run: NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"\n' >&2
  else
    NONINTERACTIVE=1 /bin/bash -c \
      "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" \
      || { log "Homebrew install failed."; exit 1; }
    ensure_brew_on_path || { log "Homebrew installed but not on PATH."; exit 1; }
  fi
fi

# Quiet, non-interactive brew (no auto-update churn, no confirmation prompts).
export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALL_CLEANUP=1
export HOMEBREW_NO_ENV_HINTS=1

# install-or-upgrade a brew formula, reporting which happened.
brew_ensure() {
  formula="$1"
  if brew list --formula "$formula" >/dev/null 2>&1; then
    log "${formula}: already installed — upgrading if outdated."
    run brew upgrade "$formula" || true
  else
    log "${formula}: not present — installing."
    run brew install "$formula"
  fi
}

# --- Node.js: match the pinned .nvmrc major. Only install when missing or older
# than required, so an existing nvm/fnm/volta-managed Node is left alone. pnpm is
# provided by corepack (ships with Node) — never installed globally here. ---
required_node_major="$(sed -E 's/^v?([0-9]+).*/\1/' .nvmrc 2>/dev/null || echo 24)"
current_node_major=0
if command -v node >/dev/null 2>&1; then
  current_node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
fi
if [ "${current_node_major:-0}" -lt "$required_node_major" ] 2>/dev/null; then
  log "Node ${required_node_major}+ not found (have: ${current_node_major:-none}) — installing node@${required_node_major} via Homebrew…"
  if brew info "node@${required_node_major}" >/dev/null 2>&1; then
    brew_ensure "node@${required_node_major}"
    run brew link --overwrite --force "node@${required_node_major}" || true
  else
    brew_ensure node
  fi
else
  log "Node $(node -v 2>/dev/null) present (>= ${required_node_major}) — leaving it as-is."
fi
if command -v corepack >/dev/null 2>&1; then
  run corepack enable || true
fi

# --- CLI tools + secret scanner + Python launchers (Homebrew) ---
for formula in gitleaks gh jq uv pipx; do
  brew_ensure "$formula"
done

# --- Docker runtime: only if none is present (respect an existing OrbStack / Docker Desktop) ---
if command -v docker >/dev/null 2>&1; then
  log "docker runtime already present ($(command -v docker)) — leaving it as-is."
else
  log "no docker runtime — installing colima (headless, no GUI/pause)…"
  brew_ensure colima
  brew_ensure docker
  brew_ensure docker-compose
  run colima start || true
fi

# --- codegraph (npm registry, pinned to latest) ---
if command -v npm >/dev/null 2>&1; then
  if command -v codegraph >/dev/null 2>&1; then
    log "codegraph: already installed ($(codegraph --version 2>/dev/null || echo present)) — upgrading to latest."
  else
    log "codegraph: not present — installing."
  fi
  run npm install -g @colbymchenry/codegraph@latest
else
  log "npm not on PATH — skipping codegraph (run pnpm setup:local so Node is present)."
fi

# --- headroom (PyPI via pipx) ---
if command -v pipx >/dev/null 2>&1; then
  run pipx ensurepath >/dev/null 2>&1 || true
  if pipx list 2>/dev/null | grep -q 'headroom-ai'; then
    log "headroom: already installed — upgrading."
    run pipx upgrade headroom-ai || true
  else
    log "headroom: not present — installing."
    run pipx install 'headroom-ai[mcp]'
  fi
else
  log "pipx not on PATH — skipping headroom (retry after a fresh shell)."
fi

log "done."
