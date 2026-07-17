import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const sourceRoot = new URL("../src", import.meta.url).pathname;
const sourceExtensions = new Set([".css", ".ts", ".tsx"]);
const allowedFixedColorFiles = new Set([
  "services/fileTypeService.tsx", // Official language and tool artwork.
  "components/nodes/sticky/StickyNode.tsx", // User-selectable sticky-note ink.
  "components/nodes/sticky/stickyColors.ts", // User-selectable sticky-note paper.
]);
const forbidden = [
  { pattern: /\bbg-black(?:\/\d+)?\b/, message: "use a semantic surface token" },
  { pattern: /\b(?:text|bg|border)-zinc-\d+\b/, message: "use foreground, surface, or border tokens" },
  { pattern: /\bprose-invert\b/, message: "Markdown appearance must follow the active theme" },
  { pattern: /highlight\.js\/styles\/[^\"']*dark/i, message: "use the tokenized highlight.js rules" },
];

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const violations = [];
for (const path of walk(sourceRoot)) {
  if (!sourceExtensions.has(extname(path))) continue;
  const displayPath = relative(sourceRoot, path);
  if (allowedFixedColorFiles.has(displayPath)) continue;
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((line, index) => {
    forbidden.forEach(({ pattern, message }) => {
      if (pattern.test(line)) violations.push(`${displayPath}:${index + 1}: ${message}`);
    });
  });
}

if (violations.length > 0) {
  console.error(`Theme usage check failed:\n${violations.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("Theme usage check passed.");
}
