#!/usr/bin/env bash
# Install the repo's pinned Node.js into /opt/node<major> for Claude Code on the
# web (cloud agent) sessions.
#
# Why this exists: the cloud image ships Node 20/21/22 (under /opt/nodeXX via
# nvm), but core-be requires the version pinned in .nvmrc (>=24). This installs
# that version into /opt/node<major> — the same layout the image uses and exactly
# where agent-os/hooks/session-start.sh looks — so the SessionStart hook switches
# PATH to it and runs `pnpm install` automatically. No repo changes required.
#
# Usage: paste into the environment's *Setup script* field
#   (Claude Code web -> environment settings; runs as root before the session):
#
#     bash tooling/setup/agent/install-node.sh
#
# Network: the Setup script needs egress to nodejs.org, which is NOT in the
# default "Trusted" allowlist. Set Network access to "Custom", add `nodejs.org`,
# and keep "Also include default list of common package managers" checked.
#
# Env:
#   NODE_INSTALL_PREFIX (default /opt) — parent dir for node<major>
#
# Fails FAST (set -euo pipefail): a setup-time install error should surface, not
# leave a half-broken toolchain. Idempotent: re-running is a no-op once the
# pinned version is present (Setup scripts re-run on cache rebuilds).
set -euo pipefail

readonly DEFAULT_VERSION="24.13.0"
readonly INSTALL_PREFIX="${NODE_INSTALL_PREFIX:-/opt}"

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

# Resolve the pinned version from .nvmrc (e.g. 24.13.0); fall back when it is
# missing or not a full x.y.z (the dist tarball URL needs the full version).
version="${DEFAULT_VERSION}"
if [ -f "${repository_root}/.nvmrc" ]; then
  parsed="$(tr -dc '0-9.' < "${repository_root}/.nvmrc")"
  case "${parsed}" in
    *.*.*) version="${parsed}" ;;
  esac
fi
readonly version
major="${version%%.*}"
readonly target_dir="${INSTALL_PREFIX}/node${major}"

# Idempotent: skip the download when the target already has this exact version.
if [ -x "${target_dir}/bin/node" ] && [ "$("${target_dir}/bin/node" -v 2>/dev/null)" = "v${version}" ]; then
  echo "install-node: Node v${version} already present at ${target_dir} — nothing to do."
  exit 0
fi

case "$(uname -m)" in
  x86_64) arch="x64" ;;
  aarch64 | arm64) arch="arm64" ;;
  *)
    echo "install-node: unsupported architecture '$(uname -m)'." >&2
    exit 1
    ;;
esac

readonly tarball="node-v${version}-linux-${arch}.tar.xz"
readonly url="https://nodejs.org/dist/v${version}/${tarball}"

echo "install-node: downloading ${url}"
temporary_directory="$(mktemp -d)"
curl -fsSL "${url}" -o "${temporary_directory}/${tarball}"

mkdir -p "${target_dir}"
tar -xJf "${temporary_directory}/${tarball}" -C "${target_dir}" --strip-components=1
rm -r "${temporary_directory}"

echo "install-node: installed Node $("${target_dir}/bin/node" -v) at ${target_dir}"
