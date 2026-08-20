#!/usr/bin/env bash
#
# Build Rue for Linux and/or Windows inside the electronuserland/builder:wine
# container so the host's node_modules (Mac-native better-sqlite3 binding) is
# not clobbered.
#
# Strategy:
#   - Copy the workspace into a clean directory inside the container.
#   - Run `pnpm install` + `electron-builder` inside that copy.
#   - Copy only the resulting `release/<version>/` back to the host.
#
# Named docker volumes persist Electron + electron-builder binary caches across
# runs so subsequent builds skip the multi-hundred-MB downloads.
#
# Usage:
#   scripts/docker-build.sh linux       # AppImage
#   scripts/docker-build.sh win         # NSIS .exe
#   scripts/docker-build.sh linux win   # both
#
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "Usage: $0 [linux] [win]" >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
PKG_REL_PATH="packages/apps/rue/desktop"
IMAGE="electronuserland/builder:wine"

# Apple Silicon: image is x86_64 only — Docker will run it via Rosetta.
PLATFORM_FLAG=""
if [[ "$(uname -m)" == "arm64" ]]; then
  PLATFORM_FLAG="--platform=linux/amd64"
fi

TARGETS=""
for arg in "$@"; do
  case "$arg" in
    linux|win) TARGETS+=" $arg" ;;
    *) echo "Unknown target: $arg" >&2; exit 1 ;;
  esac
done

# Build the inner script that runs inside the container. We sync the workspace
# into /work (a tmpfs-backed scratch dir), install, build, then sync `release`
# back via a writable bind mount.
INNER_SCRIPT=$(cat <<'EOSH'
set -euo pipefail
corepack enable
# Copy host workspace into scratch dir; exclude node_modules and prior release/.
rsync -a --delete \
  --exclude='**/node_modules' \
  --exclude='**/dist' \
  --exclude='**/release' \
  --exclude='**/.next' \
  --exclude='**/.cache' \
  /host/ /work/
cd /work
pnpm install --frozen-lockfile=false
cd /work/__PKG_REL_PATH__
__BUILD_COMMANDS__
mkdir -p /host/__PKG_REL_PATH__/release
rsync -a --delete /work/__PKG_REL_PATH__/release/ /host/__PKG_REL_PATH__/release/
EOSH
)

BUILD_COMMANDS=""
for t in $TARGETS; do
  BUILD_COMMANDS+="pnpm run build:${t}"$'\n'
done

INNER_SCRIPT="${INNER_SCRIPT//__PKG_REL_PATH__/$PKG_REL_PATH}"
INNER_SCRIPT="${INNER_SCRIPT//__BUILD_COMMANDS__/$BUILD_COMMANDS}"

exec docker run --rm \
  $PLATFORM_FLAG \
  -v "${REPO_ROOT}:/host" \
  -v rue-build-electron-cache:/root/.cache/electron \
  -v rue-build-builder-cache:/root/.cache/electron-builder \
  "$IMAGE" \
  bash -c "$INNER_SCRIPT"
