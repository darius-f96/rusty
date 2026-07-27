#!/bin/bash
# Recursively codesigns every Mach-O binary under the sidecar resource tree
# (native .node addons, vendored CLIs, and any nested .app bundles) with the
# Developer ID identity, hardened runtime, and a secure timestamp. Required
# for notarization: Apple rejects the app if any embedded executable is
# unsigned, ad-hoc signed, or missing the hardened runtime / timestamp.
set -euo pipefail

TARGET_DIR="$1"
IDENTITY="$2"
RUNTIME_ENTITLEMENTS="${3:-}"

if [ -z "$TARGET_DIR" ] || [ -z "$IDENTITY" ]; then
  echo "usage: sign-sidecar-binaries.sh <target-dir> <signing-identity> [runtime-entitlements]" >&2
  exit 1
fi

if [ -n "$RUNTIME_ENTITLEMENTS" ] && [ ! -f "$RUNTIME_ENTITLEMENTS" ]; then
  echo "runtime entitlements not found: $RUNTIME_ENTITLEMENTS" >&2
  exit 1
fi

needs_runtime_entitlements() {
  case "$1" in
    */@anthropic-ai/claude-agent-sdk-darwin-*/claude | \
    */@github/copilot-darwin-*/copilot)
      return 0
      ;;
  esac
  return 1
}

run_codesign() {
  if [ "$IDENTITY" = "-" ]; then
    # Ad-hoc signatures cannot carry a secure timestamp. Supporting them keeps
    # the signing logic locally testable without a Developer ID certificate.
    codesign "$@"
  else
    codesign --timestamp "$@"
  fi
}

sign() {
  if [ -n "$RUNTIME_ENTITLEMENTS" ] && needs_runtime_entitlements "$1"; then
    run_codesign \
      --force \
      --options runtime \
      --entitlements "$RUNTIME_ENTITLEMENTS" \
      --sign "$IDENTITY" \
      "$1"
    return
  fi

  # npm's bundled V8/Bun executables arrive with the JIT entitlements they
  # require. Keep those entitlements when staging the sidecar instead of
  # silently stripping them during the first signing pass.
  if codesign --display "$1" >/dev/null 2>&1; then
    run_codesign \
      --force \
      --options runtime \
      --preserve-metadata=entitlements \
      --sign "$IDENTITY" \
      "$1"
  else
    run_codesign \
      --force \
      --options runtime \
      --sign "$IDENTITY" \
      "$1"
  fi
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
  done < <(find "$app" -type f \( -perm -111 -o -name "*.node" -o -name "*.dylib" -o -name "*.so" \) -print0)
  sign "$app"
done < <(find "$TARGET_DIR" -type d -name "*.app" -print0 | sort -zr)

# Loose Mach-O files (native addons, vendored binaries) outside any .app bundle.
while IFS= read -r -d '' f; do
  relative_path="${f#"$TARGET_DIR"/}"
  case "$relative_path" in
    *.app/*) continue ;;
  esac
  if is_macho "$f"; then
    sign "$f"
  fi
done < <(find "$TARGET_DIR" -type f \( -perm -111 -o -name "*.node" -o -name "*.dylib" -o -name "*.so" \) -print0)

echo "[sign-sidecar-binaries] done."
