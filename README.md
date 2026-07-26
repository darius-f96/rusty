# Axiom IDE

An AI-assisted coding IDE built with Tauri, React, and TypeScript. Axiom runs a
local agent sidecar that talks to multiple coding-agent backends (Anthropic's
Claude Agent SDK, GitHub Copilot, OpenAI Codex, and the Pi agent stack) and
gives them a structured task/reconciliation workflow instead of a single chat
window: delegate work to subagents, watch a live task graph, review generated
diffs, and reconcile results back into your working tree.

## Install (macOS)

Apple Silicon only, for now.

```bash
brew install --cask traian18/axiom/axiom-ide
```

The app is signed with a Developer ID certificate and notarized by Apple.

## Development

See [BUILD.md](BUILD.md) for prerequisites and build instructions across
macOS, Windows, and Linux, and [THEMING.md](THEMING.md) for the color/theming
system.

```bash
npm install
cd agent-sidecar && npm install && cd ..
npm run tauri dev
```

## Releasing

Pushing a tag matching `v*.*.*` triggers `.github/workflows/release.yml`,
which builds, signs, and notarizes the macOS app, publishes a GitHub release
with the DMG attached, and updates the
[Homebrew tap](https://github.com/traian18/homebrew-axiom) automatically.

```bash
# bump "version" in src-tauri/tauri.conf.json, commit it, then:
git tag vX.Y.Z
git push origin vX.Y.Z
```
