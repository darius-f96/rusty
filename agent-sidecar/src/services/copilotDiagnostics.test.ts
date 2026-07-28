import assert from "node:assert/strict";
import test from "node:test";
import {
  compactCopilotCliMessage,
  diagnosticCopilotMessage,
  errorMessage,
  sanitizeCopilotCliOutput,
} from "./copilotDiagnostics";

test("Copilot CLI diagnostics redact credentials and device codes", () => {
  const diagnostic = diagnosticCopilotMessage(
    "\u001b[32mSigned in successfully as octocat. Token: ghp_abcdefgh12345678 Code: ABCD-EFGH\u001b[0m",
    "/Users/test/.copilot",
  );

  assert.equal(diagnostic, "Signed in successfully as [account]. Token: [redacted] Code: [device-code]");
});

test("Copilot CLI output sanitization removes control sequences and bounds compact messages", () => {
  assert.equal(sanitizeCopilotCliOutput("a\u0000b^D"), "ab");
  assert.equal(compactCopilotCliMessage("  a\n\tb  "), "a b");
});

test("errorMessage only exposes Error messages", () => {
  assert.equal(errorMessage(new Error("unavailable"), "fallback"), "unavailable");
  assert.equal(errorMessage("unavailable", "fallback"), "fallback");
});
