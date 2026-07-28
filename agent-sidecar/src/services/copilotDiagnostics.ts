import * as os from "node:os";
import * as path from "node:path";

const ANSI_ESCAPE_PATTERN = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const GITHUB_TOKEN_PATTERN = /(?:gh[oupsr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g;
const CONTROL_CHARACTER_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const DEVICE_CODE_PATTERN = /\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/gi;

export function copilotHome(): string {
  return process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot");
}

export function sanitizeCopilotCliOutput(value: string): string {
  return value
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(GITHUB_TOKEN_PATTERN, "[redacted]")
    .replace(CONTROL_CHARACTER_PATTERN, "")
    .replace(/\^D/g, "");
}

export function compactCopilotCliMessage(value: string): string {
  return sanitizeCopilotCliOutput(value).replace(/\s+/g, " ").trim().slice(0, 500);
}

export function diagnosticCopilotMessage(value: string, home = copilotHome()): string {
  return compactCopilotCliMessage(value)
    .replace(DEVICE_CODE_PATTERN, "[device-code]")
    .replace(/(Signed in successfully as)\s+.+?(?:\.|$)/i, "$1 [account].")
    .replace(home, "$COPILOT_HOME");
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
