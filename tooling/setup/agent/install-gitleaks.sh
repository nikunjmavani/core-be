#!/usr/bin/env bash
# Install gitleaks for Claude Code on the web (cloud agent) sessions.
#
# Why: the pre-commit guard's "Staged secrets scan" step
# ([`src/scripts/tooling/run-pre-commit-guard.ts`](../../../src/scripts/tooling/run-pre-commit-guard.ts))
# shells out to `gitleaks protect --staged …` and hard-errors when the binary is
# missing; the CI `security-secrets` job runs `gitleaks detect` too. The cloud
# image does not ship gitleaks, so a cloud session cannot commit (the guard fails)
# until it is installed. Adding it here makes the in-session secret scan work the
# same as local. Paste into the environment's *Setup script* field (runs as root,
# cached), AFTER install-node.sh:
#
#     bash tooling/setup/agent/install-node.sh
#     bash tooling/setup/agent/install-gitleaks.sh
#
# Network: the github.com release binary (primary path) is reachable on the
# default Trusted allowlist — no extra allowlist entry required. The `go install`
# fallback needs Go on PATH plus the Go module proxy (proxy.golang.org); it only
# runs when the release download fails.
#
# Version is pinned to match the CI `security-secrets` job in
# `.github/workflows/pr-ci.yml` — keep the two in sync.
#
# Idempotent and best-effort: never hard-fails the setup chain over an optional
# tool. Output goes to stderr (diagnostics).
set -uo pipefail

readonly GITLEAKS_VERSION="8.30.1"
readonly DESTINATION="/usr/local/bin"

if command -v gitleaks >/dev/null 2>&1; then
  echo "install-gitleaks: gitleaks $(gitleaks version 2>/dev/null) already present — nothing to do." >&2
  exit 0
fi

# gitleaks release assets name amd64 "x64" and arm64 "arm64".
case "$(dpkg --print-architecture 2>/dev/null || uname -m)" in
  amd64 | x86_64) asset_arch="x64" ;;
  arm64 | aarch64) asset_arch="arm64" ;;
  *) asset_arch="x64" ;;
esac

# 1) Official release binary from github.com (in the default Trusted allowlist).
#    Pinned to the CI version so in-session scans match CI exactly. No compile.
tarball="gitleaks_${GITLEAKS_VERSION}_linux_${asset_arch}.tar.gz"
url="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${tarball}"
tmpdir="$(mktemp -d)"
if curl -fsSL "${url}" -o "${tmpdir}/${tarball}" 2>/dev/null \
  && tar -xzf "${tmpdir}/${tarball}" -C "${tmpdir}" gitleaks 2>/dev/null; then
  install -m 0755 "${tmpdir}/gitleaks" "${DESTINATION}/gitleaks"
  rm -rf "${tmpdir}"
  echo "install-gitleaks: installed gitleaks $(gitleaks version 2>/dev/null) from github.com release binary." >&2
  exit 0
fi
rm -rf "${tmpdir}"
echo "install-gitleaks: github.com release binary unavailable — trying \`go install\`." >&2

# 2) Fallback — build from source with Go (present on the cloud image). gitleaks
#    still declares its legacy module path in go.mod, so `go install` MUST use
#    github.com/zricethezav/gitleaks (NOT the current github.com/gitleaks repo
#    path, which fails the module-path check). GOBIN drops it straight on PATH.
if command -v go >/dev/null 2>&1; then
  if GOBIN="${DESTINATION}" go install \
       "github.com/zricethezav/gitleaks/v8@v${GITLEAKS_VERSION}" >&2 2>&1; then
    echo "install-gitleaks: installed gitleaks via \`go install\` (v${GITLEAKS_VERSION})." >&2
    exit 0
  fi
  echo "install-gitleaks: \`go install\` failed — install gitleaks manually (non-fatal)." >&2
else
  echo "install-gitleaks: Go not on PATH for the fallback — install gitleaks manually (non-fatal)." >&2
fi

exit 0
