#!/bin/bash
# Re-sign the completed Tauri app inside-out. Tauri's bundle signing pass
# re-signs nested Mach-O executables without their original JIT entitlements,
# which makes the bundled Claude (Bun) and Copilot (V8) runtimes crash.
set -euo pipefail

APP="$1"
IDENTITY="$2"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SIDECAR_DIR="$APP/Contents/Resources/resources/sidecar"
NODE_BIN="$APP/Contents/MacOS/node"
RUNTIME_ENTITLEMENTS="$ROOT_DIR/src-tauri/runtime-entitlements.plist"
APP_ENTITLEMENTS="$ROOT_DIR/src-tauri/entitlements.plist"

if [ ! -d "$APP" ]; then
  echo "app bundle not found: $APP" >&2
  exit 1
fi

if [ ! -d "$SIDECAR_DIR" ]; then
  echo "bundled sidecar not found: $SIDECAR_DIR" >&2
  exit 1
fi

if [ ! -f "$NODE_BIN" ]; then
  echo "bundled Node runtime not found: $NODE_BIN" >&2
  exit 1
fi

run_codesign() {
  if [ "$IDENTITY" = "-" ]; then
    codesign "$@"
  else
    codesign --timestamp "$@"
  fi
}

"$ROOT_DIR/scripts/sign-sidecar-binaries.sh" \
  "$SIDECAR_DIR" \
  "$IDENTITY" \
  "$RUNTIME_ENTITLEMENTS"

run_codesign \
  --force \
  --options runtime \
  --entitlements "$RUNTIME_ENTITLEMENTS" \
  --sign "$IDENTITY" \
  "$NODE_BIN"

# Re-seal the outer bundle after every nested executable has its final
# signature. This must be the last signing operation before notarization.
run_codesign \
  --force \
  --options runtime \
  --entitlements "$APP_ENTITLEMENTS" \
  --sign "$IDENTITY" \
  "$APP"

codesign --verify --deep --strict --verbose=4 "$APP"

echo "[sign-macos-app] signed and verified $APP"
