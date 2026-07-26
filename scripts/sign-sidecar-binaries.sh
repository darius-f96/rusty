#!/bin/bash
# Recursively codesigns every Mach-O binary under the sidecar resource tree
# (native .node addons, vendored CLIs, and any nested .app bundles) with the
# Developer ID identity, hardened runtime, and a secure timestamp. Required
# for notarization: Apple rejects the app if any embedded executable is
# unsigned, ad-hoc signed, or missing the hardened runtime / timestamp.
set -euo pipefail

TARGET_DIR="$1"
IDENTITY="$2"

if [ -z "$TARGET_DIR" ] || [ -z "$IDENTITY" ]; then
  echo "usage: sign-sidecar-binaries.sh <target-dir> <signing-identity>" >&2
  exit 1
fi

sign() {
  codesign --force --options runtime --timestamp --sign "$IDENTITY" "$1"
}

is_macho() {
  file -b "$1" | grep -q "Mach-O"
}

# Nested .app bundles (e.g. GitHub Copilot's "Computer Use" helper) must be
# signed inside-out: their own binaries first, then the bundle itself.
while IFS= read -r -d '' app; do
  while IFS= read -r -d '' bin; do
    if is_macho "$bin"; then
      sign "$bin"
    fi
  done < <(find "$app" -type f -print0)
  sign "$app"
done < <(find "$TARGET_DIR" -type d -name "*.app" -print0 | sort -zr)

# Loose Mach-O files (native addons, vendored binaries) outside any .app bundle.
while IFS= read -r -d '' f; do
  case "$f" in
    *.app/*) continue ;;
  esac
  if is_macho "$f"; then
    sign "$f"
  fi
done < <(find "$TARGET_DIR" -type f -print0)

echo "[sign-sidecar-binaries] done."
