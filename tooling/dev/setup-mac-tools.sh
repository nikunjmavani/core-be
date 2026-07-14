#!/usr/bin/env bash
# Non-interactive macOS external-tool installer for `pnpm setup:local`.
#
# The tool list is data-driven from `setup-prerequisites-mac-tools.manifest` (the
# single source of truth) — remove a line there and that tool is dropped from
# setup; add a line and it is included. This script only bootstraps Homebrew (the
# install mechanism) and dispatches each manifest entry to the matching handler.
#
# Installs-or-UPGRADES every external tool the project needs that `pnpm install`
# cannot provide, from AUTHENTICATED sources only (Homebrew official formulae, the
# npm registry, PyPI) and with NO prompts/pauses, so setup runs fully hands-off.
# Already-present tools are upgraded (or left as-is for Node/Docker); missing ones
# are installed. macOS only for now — a no-op on other platforms.
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

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
MANIFEST="${SCRIPT_DIR}/setup-prerequisites-mac-tools.manifest"
if [ ! -f "$MANIFEST" ]; then
  log "manifest not found: ${MANIFEST}"
  exit 1
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

# ---------------------------------------------------------------------------
# Per-method handlers. Each reports already-installed (→ upgrade) vs installing.
# ---------------------------------------------------------------------------

# install-or-upgrade a Homebrew formula.
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

# Node.js — match the pinned .nvmrc major; only install if missing/older so an
# existing nvm/fnm/volta Node is left alone. pnpm is provided by corepack.
node_ensure() {
  required_major="$(sed -E 's/^v?([0-9]+).*/\1/' "${REPO_ROOT}/.nvmrc" 2>/dev/null || echo 24)"
  current_major=0
  if command -v node >/dev/null 2>&1; then
    current_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  fi
  if [ "${current_major:-0}" -lt "$required_major" ] 2>/dev/null; then
    log "node: not present or older than ${required_major} (have: ${current_major:-none}) — installing node@${required_major}."
    if brew info "node@${required_major}" >/dev/null 2>&1; then
      brew_ensure "node@${required_major}"
      run brew link --overwrite --force "node@${required_major}" || true
    else
      brew_ensure node
    fi
  else
    log "node: already installed ($(node -v 2>/dev/null)) (>= ${required_major}) — leaving it as-is."
  fi
  if command -v corepack >/dev/null 2>&1; then run corepack enable || true; fi
}

# Docker — install a headless runtime only if none is present (respect an existing
# OrbStack / Docker Desktop). $1 = runtime formula (e.g. colima).
docker_ensure() {
  runtime="${1:-colima}"
  if command -v docker >/dev/null 2>&1; then
    log "docker: runtime already present ($(command -v docker)) — leaving it as-is."
    return 0
  fi
  log "docker: no runtime — installing ${runtime} (headless) + docker CLI."
  brew_ensure "$runtime"
  brew_ensure docker
  brew_ensure docker-compose
  if [ "$runtime" = "colima" ]; then run colima start || true; fi
}

# npm global — install-or-upgrade. $1 = package@version (e.g. @scope/name@latest).
npm_ensure() {
  pkg="$1"
  base="$(printf '%s' "$pkg" | sed -E 's/@[^@]*$//')" # strip trailing @version
  if ! command -v npm >/dev/null 2>&1; then
    log "npm: not on PATH — skipping ${base} (run pnpm setup:local so Node is present)."
    return 0
  fi
  if npm ls -g --depth=0 "$base" >/dev/null 2>&1; then
    log "${base}: already installed — upgrading to latest (npm)."
  else
    log "${base}: not present — installing (npm)."
  fi
  run npm install -g "$pkg"
}

# pipx — install-or-upgrade. $1 = package[extras] (e.g. headroom-ai[mcp]).
pipx_ensure() {
  pkg="$1"
  base="${pkg%%[*}" # strip [extras]
  if ! command -v pipx >/dev/null 2>&1; then
    log "pipx: not on PATH — skipping ${base} (retry after a fresh shell)."
    return 0
  fi
  run pipx ensurepath >/dev/null 2>&1 || true
  if pipx list 2>/dev/null | grep -q "$base"; then
    log "${base}: already installed — upgrading (pipx)."
    run pipx upgrade "$base" || true
  else
    log "${base}: not present — installing (pipx)."
    run pipx install "$pkg"
  fi
}

# ---------------------------------------------------------------------------
# Drive every tool from the manifest (blank lines and `#` comments ignored).
# ---------------------------------------------------------------------------
while IFS='|' read -r method spec _note || [ -n "$method" ]; do
  method="$(printf '%s' "$method" | tr -d '[:space:]')"
  case "$method" in
    '' | \#*) continue ;;
    node) node_ensure ;;
    brew) brew_ensure "$spec" ;;
    docker) docker_ensure "$spec" ;;
    npm) npm_ensure "$spec" ;;
    pipx) pipx_ensure "$spec" ;;
    *) log "unknown method '${method}' in manifest — skipping." ;;
  esac
done <"$MANIFEST"

log "done."
