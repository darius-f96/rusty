/**
 * LSP Registry — vendored package recipes.
 *
 * Inspired by mason-org/mason-registry's package.yaml schema, adapted to a
 * typed TypeScript registry. Each entry describes how to detect, download,
 * and link a language server binary. Versions are resolved to "latest" at
 * install time via each spec's resolveLatest() implementation.
 *
 * Supported purl types (install strategies live in lspInstaller.ts):
 *   - npm      : npm install --prefix <cache> <pkg>@<ver> [extraPackages]
 *   - github   : download release asset for current platform, unpack (tar.gz/gz/zip)
 *   - golang   : GOBIN=<cache>/bin go install <pkg>@latest
 *   - gem      : gem install --install-dir <cache> <pkg>
 *   - dotnet   : dotnet tool install --tool-path <cache> <pkg>
 *   - generic  : HTTP download one or more URLs, unpack
 */

export type Target =
  | "darwin_arm64"
  | "darwin_x64"
  | "linux_x64_gnu"
  | "linux_arm64_gnu"
  | "linux_x64_musl"
  | "win_x64"
  | "win_arm64";

export type PlatformGroup = Target | "unix" | "win" | "linux";

export type PurlType =
  | "npm"
  | "github"
  | "golang"
  | "gem"
  | "dotnet"
  | "generic";

export type ArchiveFormat = "tar.gz" | "gz" | "zip" | "none";

export interface RuntimeRequirement {
  /** Binary that must exist on PATH (or via env var) before install proceeds. */
  binary: string;
  /** Optional environment variable override to locate the binary (e.g. JAVA_HOME). */
  envVar?: string;
  /** Minimum major version required (parsed from `--version` output). */
  minMajor?: number;
  /** Human-readable error shown to the user when the runtime is missing. */
  message: string;
}

export interface AssetSpec {
  /** Platform targets this asset applies to. First match wins. */
  targets: PlatformGroup[];
  /** Asset URL. May be a function of (version, target) for templated URLs. */
  url: string | ((version: string, target: Target) => string);
  /** Archive format of the downloaded file. */
  archive: ArchiveFormat;
  /** tar --strip-components value (only relevant for tar.gz). */
  stripComponents?: number;
}

export type BinResolution =
  | { kind: "npm"; pkg: string }
  | { kind: "golang"; pkg: string }
  | { kind: "gem"; pkg: string }
  | { kind: "dotnet"; pkg: string }
  | { kind: "asset"; path: string }
  | { kind: "launcher"; path: string };

export interface PackageSpec {
  /** Axiom language key (matches lspSettings.servers keys). */
  language: string;
  /** Canonical package name. */
  name: string;
  description: string;
  homepage: string;
  purlType: PurlType;
  /** purl identifier (without version), e.g. "npm/pyright" or "github/rust-lang/rust-analyzer". */
  purlId: string;
  /** Additional npm packages to install alongside (npm only). */
  extraPackages?: string[];
  /** Platform-dependent download assets (github / generic only). */
  assets?: AssetSpec[];
  /** Maps executable name -> resolution strategy. */
  bin: { [exec: string]: BinResolution };
  /** Architecture-independent files to symlink into a shared dir (jdtls plugins/config). */
  linkShare?: Record<string, string>;
  /** External runtime that must be present before install. */
  runtimeRequirement?: RuntimeRequirement;
  /** Resolve the latest available version from upstream. */
  resolveLatest: () => Promise<string>;
}

// ── Helpers for resolveLatest implementations ───────────────────────────

/** Fetch the latest version of an npm package from the npm registry. */
async function npmLatest(pkg: string): Promise<string> {
  const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`);
  if (!res.ok) throw new Error(`npm registry returned ${res.status} for ${pkg}`);
  const data: any = await res.json();
  if (!data.version) throw new Error(`npm registry: no version field for ${pkg}`);
  return data.version as string;
}

/**
 * Fetch the latest released tag name from a GitHub repo.
 * Tries the API first; on rate-limit (403) falls back to following the
 * releases/latest redirect (not rate-limited).
 */
async function githubLatest(repo: string): Promise<string> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/releases/latest`,
      { headers: { "Accept": "application/vnd.github+json" } }
    );
    if (res.ok) {
      const data: any = await res.json();
      if (data.tag_name) return data.tag_name as string;
    }
    if (res.status !== 403 && res.status !== 429) {
      throw new Error(`GitHub API returned ${res.status} for ${repo}`);
    }
    // Rate limited — fall through to redirect method.
    console.warn(`[LSP Registry] GitHub API rate-limited for ${repo}, falling back to redirect method...`);
  } catch (err) {
    // Network errors fall through to redirect method.
    if (!String(err).includes("rate-limited")) {
      console.warn(`[LSP Registry] GitHub API failed for ${repo}: ${err}, trying redirect method...`);
    }
  }

  // Follow the releases/latest redirect — GitHub 302s to /releases/tag/<TAG>.
  const redirectRes = await fetch(`https://github.com/${repo}/releases/latest`, {
    redirect: "manual",
  });
  const location = redirectRes.headers.get("location");
  if (location) {
    const match = location.match(/\/releases\/tag\/(.+)$/);
    if (match) return match[1];
  }
  throw new Error(`Could not resolve latest GitHub release for ${repo}`);
}

/**
 * Scrape the Eclipse jdtls snapshots index for the newest tarball filename.
 * Returns the version+timestamp segment (e.g. "1.54.0-202511241837") which
 * is used to construct the download URL. The snapshots directory is flat:
 *   https://download.eclipse.org/jdtls/snapshots/jdt-language-server-<version>-<timestamp>.tar.gz
 */
async function jdtlsLatest(): Promise<string> {
  const res = await fetch("https://download.eclipse.org/jdtls/snapshots/");
  if (!res.ok) throw new Error(`Eclipse snapshots index returned ${res.status}`);
  const html = await res.text();
  // Match: jdt-language-server-1.54.0-202511241837.tar.gz
  const matches = html.match(/jdt-language-server-(\d+\.\d+\.\d+)-(\d+)\.tar\.gz/g);
  if (!matches || matches.length === 0) {
    throw new Error("Could not find any jdt-language-server tarball on Eclipse snapshots index");
  }
  // Extract version-timestamp pairs and pick the newest by version then timestamp.
  const entries = matches.map((m) => {
    const parts = m.match(/jdt-language-server-(\d+\.\d+\.\d+)-(\d+)\.tar\.gz/);
    return parts ? { version: parts[1], timestamp: parts[2] } : null;
  }).filter(Boolean) as { version: string; timestamp: string }[];

  entries.sort((a, b) => {
    const pa = a.version.split(".").map(Number);
    const pb = b.version.split(".").map(Number);
    const vcmp = pb[0] - pa[0] || pb[1] - pa[1] || pb[2] - pa[2];
    if (vcmp !== 0) return vcmp;
    // Same version, newer timestamp wins.
    return b.timestamp.localeCompare(a.timestamp);
  });

  const best = entries[0];
  return `${best.version}-${best.timestamp}`;
}

// ── The registry ────────────────────────────────────────────────────────

export const LSP_REGISTRY: Record<string, PackageSpec> = {
  // 1. TypeScript / JavaScript
  typescript: {
    language: "typescript",
    name: "typescript-language-server",
    description: "TypeScript & JavaScript Language Server.",
    homepage: "https://github.com/typescript-language-server/typescript-language-server",
    purlType: "npm",
    purlId: "npm/typescript-language-server",
    extraPackages: ["typescript"],
    bin: { "typescript-language-server": { kind: "npm", pkg: "typescript-language-server" } },
    resolveLatest: () => npmLatest("typescript-language-server"),
  },

  // 2. Python
  python: {
    language: "python",
    name: "pyright",
    description: "Static type checker for Python.",
    homepage: "https://github.com/microsoft/pyright",
    purlType: "npm",
    purlId: "npm/pyright",
    bin: { "pyright-langserver": { kind: "npm", pkg: "pyright" } },
    resolveLatest: () => npmLatest("pyright"),
  },

  // 3. Go
  go: {
    language: "go",
    name: "gopls",
    description: "Official Go language server.",
    homepage: "https://pkg.go.dev/golang.org/x/tools/gopls",
    purlType: "golang",
    purlId: "golang/golang.org/x/tools/gopls",
    bin: { "gopls": { kind: "golang", pkg: "golang.org/x/tools/gopls" } },
    runtimeRequirement: {
      binary: "go",
      message: "Go toolchain not found on PATH. Install Go from https://go.dev/dl/ and retry.",
    },
    resolveLatest: async () => "latest",
  },

  // 4. Rust
  rust: {
    language: "rust",
    name: "rust-analyzer",
    description: "LSP implementation for Rust.",
    homepage: "https://github.com/rust-lang/rust-analyzer",
    purlType: "github",
    purlId: "github/rust-lang/rust-analyzer",
    assets: [
      { targets: ["linux_x64_gnu"], url: (v) => `https://github.com/rust-lang/rust-analyzer/releases/download/${v}/rust-analyzer-x86_64-unknown-linux-gnu.gz`, archive: "gz" },
      { targets: ["linux_arm64_gnu"], url: (v) => `https://github.com/rust-lang/rust-analyzer/releases/download/${v}/rust-analyzer-aarch64-unknown-linux-gnu.gz`, archive: "gz" },
      { targets: ["linux_x64_musl"], url: (v) => `https://github.com/rust-lang/rust-analyzer/releases/download/${v}/rust-analyzer-x86_64-unknown-linux-musl.gz`, archive: "gz" },
      { targets: ["darwin_x64"], url: (v) => `https://github.com/rust-lang/rust-analyzer/releases/download/${v}/rust-analyzer-x86_64-apple-darwin.gz`, archive: "gz" },
      { targets: ["darwin_arm64"], url: (v) => `https://github.com/rust-lang/rust-analyzer/releases/download/${v}/rust-analyzer-aarch64-apple-darwin.gz`, archive: "gz" },
      { targets: ["win_x64"], url: (v) => `https://github.com/rust-lang/rust-analyzer/releases/download/${v}/rust-analyzer-x86_64-pc-windows-msvc.zip`, archive: "zip" },
      { targets: ["win_arm64"], url: (v) => `https://github.com/rust-lang/rust-analyzer/releases/download/${v}/rust-analyzer-aarch64-pc-windows-msvc.zip`, archive: "zip" },
    ],
    bin: { "rust-analyzer": { kind: "asset", path: "rust-analyzer" } },
    resolveLatest: () => githubLatest("rust-lang/rust-analyzer"),
  },

  // 5. Java
  java: {
    language: "java",
    name: "jdtls",
    description: "Eclipse JDT Language Server for Java.",
    homepage: "https://github.com/eclipse-jdtls/eclipse.jdt.ls",
    purlType: "generic",
    purlId: "generic/eclipse/eclipse.jdt.ls",
    assets: [
      {
        targets: ["darwin_arm64", "darwin_x64"],
        url: (v) => `https://download.eclipse.org/jdtls/snapshots/jdt-language-server-${v}.tar.gz`,
        archive: "tar.gz",
      },
      {
        targets: ["linux_x64_gnu", "linux_arm64_gnu", "linux_x64_musl"],
        url: (v) => `https://download.eclipse.org/jdtls/snapshots/jdt-language-server-${v}.tar.gz`,
        archive: "tar.gz",
      },
      {
        targets: ["win_x64", "win_arm64"],
        url: (v) => `https://download.eclipse.org/jdtls/snapshots/jdt-language-server-${v}.tar.gz`,
        archive: "tar.gz",
      },
    ],
    bin: { "jdtls": { kind: "launcher", path: "bin/jdtls" } },
    linkShare: {
      "jdtls/plugins/": "plugins/",
    },
    runtimeRequirement: {
      binary: "java",
      envVar: "JAVA_HOME",
      minMajor: 21,
      message: "Java 21+ is required to run jdtls. Install a JDK and set JAVA_HOME, then retry.",
    },
    resolveLatest: jdtlsLatest,
  },

  // 6. C
  c: {
    language: "c",
    name: "clangd",
    description: "clangd LSP server (part of LLVM/Clang tools).",
    homepage: "https://clangd.llvm.org/",
    purlType: "generic",
    purlId: "generic/llvm/clangd",
    assets: [],
    bin: { "clangd": { kind: "asset", path: "clangd" } },
    runtimeRequirement: {
      binary: "clangd",
      message: "clangd not found. Install LLVM/Clang (e.g. `brew install llvm` on macOS, `apt install clangd` on Debian) and retry. Auto-download is not supported for clangd.",
    },
    resolveLatest: async () => "system",
  },

  // 7. C++
  cpp: {
    language: "cpp",
    name: "clangd",
    description: "clangd LSP server (part of LLVM/Clang tools).",
    homepage: "https://clangd.llvm.org/",
    purlType: "generic",
    purlId: "generic/llvm/clangd",
    assets: [],
    bin: { "clangd": { kind: "asset", path: "clangd" } },
    runtimeRequirement: {
      binary: "clangd",
      message: "clangd not found. Install LLVM/Clang (e.g. `brew install llvm` on macOS, `apt install clangd` on Debian) and retry. Auto-download is not supported for clangd.",
    },
    resolveLatest: async () => "system",
  },

  // 8. C#
  csharp: {
    language: "csharp",
    name: "csharp-ls",
    description: "OmniSharp-style C# language server.",
    homepage: "https://github.com/razzmatazz/csharp-language-server",
    purlType: "dotnet",
    purlId: "dotnet/csharp-ls",
    bin: { "csharp-ls": { kind: "dotnet", pkg: "csharp-ls" } },
    runtimeRequirement: {
      binary: "dotnet",
      message: ".NET SDK not found on PATH. Install from https://dotnet.microsoft.com/download and retry.",
    },
    resolveLatest: async () => "latest",
  },

  // 9. Ruby
  ruby: {
    language: "ruby",
    name: "ruby-lsp",
    description: "Ruby LSP language server.",
    homepage: "https://github.com/Shopify/ruby-lsp",
    purlType: "gem",
    purlId: "gem/ruby-lsp",
    bin: { "ruby-lsp": { kind: "gem", pkg: "ruby-lsp" } },
    runtimeRequirement: {
      binary: "ruby",
      message: "Ruby not found on PATH. Install Ruby (e.g. via rbenv, asdf, or system package manager) and retry.",
    },
    resolveLatest: async () => "latest",
  },

  // 10. PHP
  php: {
    language: "php",
    name: "intelephense",
    description: "Intelephense PHP language server.",
    homepage: "https://github.com/bmewburn/intelephense-docs",
    purlType: "npm",
    purlId: "npm/intelephense",
    bin: { "intelephense": { kind: "npm", pkg: "intelephense" } },
    resolveLatest: () => npmLatest("intelephense"),
  },

  // 11. Lua
  lua: {
    language: "lua",
    name: "lua-language-server",
    description: "Lua language server.",
    homepage: "https://github.com/LuaLS/lua-language-server",
    purlType: "github",
    purlId: "github/LuaLS/lua-language-server",
    assets: [
      { targets: ["darwin_arm64"], url: (v) => `https://github.com/LuaLS/lua-language-server/releases/download/${v}/lua-language-server-${v}-darwin-arm64.tar.gz`, archive: "tar.gz" },
      { targets: ["darwin_x64"], url: (v) => `https://github.com/LuaLS/lua-language-server/releases/download/${v}/lua-language-server-${v}-darwin-x64.tar.gz`, archive: "tar.gz" },
      { targets: ["linux_x64_gnu", "linux_x64_musl"], url: (v) => `https://github.com/LuaLS/lua-language-server/releases/download/${v}/lua-language-server-${v}-linux-x64.tar.gz`, archive: "tar.gz" },
      { targets: ["linux_arm64_gnu"], url: (v) => `https://github.com/LuaLS/lua-language-server/releases/download/${v}/lua-language-server-${v}-linux-arm64.tar.gz`, archive: "tar.gz" },
      { targets: ["win_x64"], url: (v) => `https://github.com/LuaLS/lua-language-server/releases/download/${v}/lua-language-server-${v}-win32-x64.zip`, archive: "zip" },
    ],
    bin: { "lua-language-server": { kind: "asset", path: "bin/lua-language-server" } },
    resolveLatest: () => githubLatest("LuaLS/lua-language-server"),
  },

  // 12. Bash / Shell
  bash: {
    language: "bash",
    name: "bash-language-server",
    description: "Bash language server.",
    homepage: "https://github.com/bash-lsp/bash-language-server",
    purlType: "npm",
    purlId: "npm/bash-language-server",
    bin: { "bash-language-server": { kind: "npm", pkg: "bash-language-server" } },
    resolveLatest: () => npmLatest("bash-language-server"),
  },

  // 13. JSON
  json: {
    language: "json",
    name: "vscode-json-language-server",
    description: "JSON language server.",
    homepage: "https://github.com/microsoft/vscode-json-languageservice",
    purlType: "npm",
    purlId: "npm/vscode-langservers-extracted",
    bin: { "vscode-json-language-server": { kind: "npm", pkg: "vscode-langservers-extracted" } },
    resolveLatest: () => npmLatest("vscode-langservers-extracted"),
  },

  // 14. YAML
  yaml: {
    language: "yaml",
    name: "yaml-language-server",
    description: "YAML language server.",
    homepage: "https://github.com/redhat-developer/yaml-language-server",
    purlType: "npm",
    purlId: "npm/yaml-language-server",
    bin: { "yaml-language-server": { kind: "npm", pkg: "yaml-language-server" } },
    resolveLatest: () => npmLatest("yaml-language-server"),
  },

  // 15. HTML
  html: {
    language: "html",
    name: "vscode-html-language-server",
    description: "HTML language server.",
    homepage: "https://github.com/microsoft/vscode-html-languageservice",
    purlType: "npm",
    purlId: "npm/vscode-langservers-extracted",
    bin: { "vscode-html-language-server": { kind: "npm", pkg: "vscode-langservers-extracted" } },
    resolveLatest: () => npmLatest("vscode-langservers-extracted"),
  },

  // 16. CSS
  css: {
    language: "css",
    name: "vscode-css-language-server",
    description: "CSS / SCSS / LESS language server.",
    homepage: "https://github.com/microsoft/vscode-css-languageservice",
    purlType: "npm",
    purlId: "npm/vscode-langservers-extracted",
    bin: { "vscode-css-language-server": { kind: "npm", pkg: "vscode-langservers-extracted" } },
    resolveLatest: () => npmLatest("vscode-langservers-extracted"),
  },
};

/** Look up a package spec by Axiom language key. */
export function getPackageSpec(language: string): PackageSpec | null {
  return LSP_REGISTRY[language] || null;
}

/** List all registered language keys. */
export function listRegisteredLanguages(): string[] {
  return Object.keys(LSP_REGISTRY);
}
