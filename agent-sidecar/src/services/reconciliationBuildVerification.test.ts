import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import path from "node:path";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  detectBuildCommand,
  executeBuildWithTemporaryReconciliation,
  type ReconciliationVerificationFile,
} from "./reconciliationBuildVerification";

const temporaryWorkspaces: string[] = [];

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(tmpdir(), "axiom-reconciliation-verification-"));
  temporaryWorkspaces.push(workspace);
  return workspace;
}

afterEach(async () => {
  await Promise.all(temporaryWorkspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
});

test("detectBuildCommand reads a reconciled package.json overlay", async () => {
  const workspace = await createWorkspace();
  const packageJsonPath = path.join(workspace, "package.json");
  await writeFile(packageJsonPath, JSON.stringify({ scripts: {} }));
  const files: ReconciliationVerificationFile[] = [{
    vfsPath: packageJsonPath,
    physicalPath: packageJsonPath,
    content: JSON.stringify({ packageManager: "pnpm@10.0.0", scripts: { build: "tsc" } }),
  }];

  const command = await detectBuildCommand(workspace, files);

  assert.deepEqual(command, {
    program: "pnpm",
    args: ["run", "build"],
    cwd: workspace,
    timeoutMs: 15 * 60_000,
  });
});

test("temporary verification restores existing files and removes newly overlaid files", async () => {
  const workspace = await createWorkspace();
  const existingPath = path.join(workspace, "existing.ts");
  const newPath = path.join(workspace, "generated", "new.ts");
  await writeFile(existingPath, "original");
  const files: ReconciliationVerificationFile[] = [
    { vfsPath: existingPath, physicalPath: existingPath, content: "reconciled" },
    { vfsPath: newPath, physicalPath: newPath, content: "generated" },
  ];
  const checkOverlayScript = [
    "const fs = require('node:fs');",
    `const valid = fs.readFileSync(${JSON.stringify(existingPath)}, 'utf8') === 'reconciled' && fs.readFileSync(${JSON.stringify(newPath)}, 'utf8') === 'generated';`,
    "process.exit(valid ? 0 : 9);",
  ].join("");

  const outcome = await executeBuildWithTemporaryReconciliation(
    "test-success",
    workspace,
    files,
    { program: process.execPath, args: ["-e", checkOverlayScript], cwd: workspace, timeoutMs: 5_000 },
    () => {},
  );

  assert.equal(outcome.result?.exitCode, 0);
  assert.equal(await readFile(existingPath, "utf8"), "original");
  await assert.rejects(access(newPath));
  await assert.rejects(access(path.dirname(newPath)));
});

test("temporary verification restores files when the command cannot spawn", async () => {
  const workspace = await createWorkspace();
  const existingPath = path.join(workspace, "existing.ts");
  await writeFile(existingPath, "original");

  const outcome = await executeBuildWithTemporaryReconciliation(
    "test-spawn-error",
    workspace,
    [{ vfsPath: existingPath, physicalPath: existingPath, content: "reconciled" }],
    { program: path.join(workspace, "missing-build-command"), args: [], cwd: workspace, timeoutMs: 5_000 },
    () => {},
  );

  assert.match(outcome.error?.message || "", /ENOENT/);
  assert.equal(await readFile(existingPath, "utf8"), "original");
});
