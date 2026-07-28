// ============================================================
// connection-test.ts — Connection test types, probe functions,
// orchestrator, and the useConnectionTest hook.
//
// The browser-side probes are deliberately limited:
//   - HTTP/SSE: abortable fetch with mode "no-cors"
//   - WebSocket: URL format validation only
//   - Stdio: simulated spawn check (real spawn is backend-only)
// ============================================================

import { useState, useCallback } from "react";
import type { UseFormWatch } from "react-hook-form";
import type { McpFormValues } from "./types";
import { isValidUrl } from "./form-utils";
import { MAX_PROBE_TIMEOUT } from "./constants";

// ───────────────────── Types ─────────────────────────────

/** Result of a single connection probe. */
export type ProbeResult = { status: "success" | "error"; message: string };

/** Subset of form values needed to run a connection test. */
export type McpFormTestValues = Pick<
  McpFormValues,
  "transportType" | "url" | "command" | "timeout"
>;

/** Visual state of the connection test UI section. */
export type TestState =
  | { status: "idle" }
  | { status: "testing"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

// ───────────────────── Validation ────────────────────────

/**
 * Validates inputs before running a connection test.
 * Returns an error message string, or null if inputs are valid.
 */
export function validateTestInputs(values: McpFormTestValues): string | null {
  const { transportType, url, command } = values;

  if (transportType === "stdio") {
    if (!command.trim()) return "Enter a command before testing.";
    return null;
  }

  if (!url.trim() || !isValidUrl(url)) {
    return "Enter a valid URL before testing.";
  }

  return null;
}

// ───────────────────── Probe functions ───────────────────

/**
 * Simulates a stdio spawn check for the test connection feature.
 * Real process spawning is backend-only, so this is a simulated delay.
 */
export async function probeStdioCommand(command: string): Promise<ProbeResult> {
  await new Promise((resolve) => setTimeout(resolve, 450));
  return {
    status: "success",
    message: `Simulated check: would spawn \`${command} --version\`. Actual process spawn is backend-only.`,
  };
}

/**
 * Validates a WebSocket URL format. Live handshake is not possible
 * from the browser environment.
 */
export function probeWebSocketUrl(_url: string): ProbeResult {
  return {
    status: "success",
    message:
      "WebSocket URL is valid. Live handshake is performed by the backend at runtime — browsers cannot probe ws:// directly.",
  };
}

/**
 * Probes an HTTP/SSE endpoint with an abortable fetch request.
 * Uses mode: "no-cors" and a capped timeout.
 */
export async function probeHttpEndpoint(
  url: string,
  timeoutMs: number,
): Promise<ProbeResult> {
  const probeTimeout = Math.min(
    Number.isFinite(timeoutMs) ? timeoutMs : MAX_PROBE_TIMEOUT,
    MAX_PROBE_TIMEOUT,
  );

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), probeTimeout);
    await fetch(url, { mode: "no-cors", signal: controller.signal });
    clearTimeout(timer);

    return {
      status: "success",
      message: `Reachable — endpoint responded (${url}). Auth headers are applied at runtime.`,
    };
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return {
        status: "error",
        message: `Request timed out after ${probeTimeout}ms.`,
      };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { status: "error", message: `Connection failed: ${msg}` };
  }
}

// ───────────────────── Orchestrator ──────────────────────

/**
 * Runs the appropriate connection test based on the transport type.
 * Orchestrates validation and delegates to the correct probe function.
 */
export async function runConnectionTest(
  values: McpFormTestValues,
): Promise<ProbeResult> {
  const validationError = validateTestInputs(values);
  if (validationError) {
    return { status: "error", message: validationError };
  }

  switch (values.transportType) {
    case "stdio":
      return probeStdioCommand(values.command);
    case "websocket":
      return probeWebSocketUrl(values.url);
    default:
      return probeHttpEndpoint(values.url, values.timeout);
  }
}

// ───────────────────── React hook ────────────────────────

/**
 * Hook that manages the connection test state and handler.
 *
 * Reads the current transport type, URL, command, and timeout from
 * the form via `watch`, then delegates to `runConnectionTest`.
 */
export function useConnectionTest(
  watch: UseFormWatch<McpFormValues>,
): { test: TestState; handleTest: () => Promise<void> } {
  const [test, setTest] = useState<TestState>({ status: "idle" });

  const handleTest = useCallback(async () => {
    const values: McpFormTestValues = {
      transportType: watch("transportType"),
      url: watch("url"),
      command: watch("command"),
      timeout: watch("timeout"),
    };

    setTest({ status: "testing", message: "Testing connection..." });
    const result = await runConnectionTest(values);
    setTest(result);
  }, [watch]);

  return { test, handleTest };
}
