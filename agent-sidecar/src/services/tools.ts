/**
 * Tools Service
 * 
 * Factory functions to create standard codebase tools (list_files, search_codebase)
 * and recursive file-system search helpers, filtering out build assets and noise directories.
 */

import fs from "fs";
import path from "path";

export const IGNORED_DIRS = new Set([
  "node_modules", "dist", ".git", "target", ".vscode", ".gemini", ".next",
  "__pycache__", ".env", "env", ".venv", "venv"
]);

/** Get a summary of the workspace structure without listing all files. */
export function getWorkspaceSummary(root: string, maxFiles = 100): string {
  const results: string[] = [];
  const dirCounts: Record<string, number> = {};
  const extCounts: Record<string, number> = {};
  let totalFiles = 0;
  let totalDirs = 0;

  function traverse(dir: string, depth: number, maxDepth: number) {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        totalDirs++;
        const relDir = path.relative(root, full);
        dirCounts[relDir] = (dirCounts[relDir] || 0) + 1;
        traverse(full, depth + 1, maxDepth);
      } else {
        totalFiles++;
        const ext = path.extname(entry.name).toLowerCase() || "no_extension";
        extCounts[ext] = (extCounts[ext] || 0) + 1;
        if (results.length < maxFiles) {
          results.push(path.relative(root, full));
        }
      }
    }
  }

  traverse(root, 0, 3);

  const topDirs = Object.entries(dirCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([dir, count]) => `${dir}/ (${count} items)`)
    .join("\n");

  const topExts = Object.entries(extCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([ext, count]) => `${ext}: ${count} files`)
    .join("\n");

  const sampleFiles = results.length > 0 ? `\n\nSample files (first ${results.length}):\n${results.join("\n")}` : "";

  return `Workspace Summary:
- Total: ${totalFiles} files, ${totalDirs} directories

Top-level directories:
${topDirs || "(none found)"}

File types:
${topExts || "(none detected)"}
${sampleFiles}`;
}

/** Recursively list all file paths under `root`, ignoring common noise dirs. */
export function listFilesRecursive(root: string, prefix = ""): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(full, rel));
    } else {
      results.push(rel);
    }
  }
  return results;
}

/** Search all non-ignored files for a text pattern, returning matching file paths + line snippets. */
export function searchCodebase(root: string, pattern: string, maxResults = 50): { file: string; line: number; text: string }[] {
  const results: { file: string; line: number; text: string }[] = [];
  const files = listFilesRecursive(root);
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "gi");
  } catch {
    regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  }
  for (const relPath of files) {
    if (results.length >= maxResults) break;
    const fullPath = path.join(root, relPath);
    try {
      const content = fs.readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          results.push({ file: relPath, line: i + 1, text: lines[i].trim().slice(0, 200) });
          if (results.length >= maxResults) break;
        }
        regex.lastIndex = 0;
      }
    } catch {
      // Skip unreadable files (binary, permissions, etc.)
    }
  }
  return results;
}

export function createListFilesTool(workspaceRoot: string) {
  return {
    name: "list_files",
    description: "Get a summary of the workspace structure including directories, file types, and a sample of files.",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    },
    execute: async () => {
      return getWorkspaceSummary(workspaceRoot);
    }
  };
}

export function createSearchCodebaseTool(workspaceRoot: string) {
  return {
    name: "search_codebase",
    description: "Find files containing a search term or regex pattern. Returns matching file paths and line snippets (limited to 30 results).",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "The search pattern or regex to match" }
      },
      required: ["pattern"]
    },
    execute: async ({ pattern }: { pattern: string }) => {
      const results = searchCodebase(workspaceRoot, pattern, 30);
      if (results.length === 0) return "No matches found.";
      return results.map(r => `${r.file}:${r.line} | ${r.text}`).join("\n");
    }
  };
}
