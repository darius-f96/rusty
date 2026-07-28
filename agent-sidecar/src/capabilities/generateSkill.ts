/**
 * Generate Skill Capability
 *
 * Generates a skill specification (systemPrompt, enabledTools, description)
 * based on a natural language description using the resolved harness.
 */

import { WebSocket } from "ws";
import { safeSend } from "../services/websocket";
import { resolveHarness } from "../services/harness";
import { createUsageReporter } from "../services/usageBroadcast";

const AVAILABLE_TOOLS = ["read_file", "write_file", "list_files", "search_codebase", "web_search", "run_command"];

export async function generateSkill(ws: WebSocket, data: any): Promise<void> {
  const { description, model, customProvider } = data;
  console.log(`WebSocket [Server] generate_skill starting`, { model, hasCustomProvider: !!customProvider });

  const sendLog = (logMessage: string) => {
    safeSend(ws, { type: "generate_skill_log", message: logMessage });
  };

  try {
    const modelReference = model || customProvider?.models?.find((item: any) => item.supported !== false)?.id || "";
    if (!modelReference) throw new Error("Select a model before generating a skill.");
    sendLog(`Generating skill with ${modelReference}...`);

    const metaPrompt = `You are a skill designer for an AI coding agent. Based on the following description, generate a skill specification as a JSON object.

Description: ${description}

Return ONLY a valid JSON object with this structure (no markdown, no explanation):
{
  "systemPrompt": "The system prompt for the skill - be specific about behavior, guidelines, and tone",
  "enabledTools": ["read_file", "write_file", "list_files", "search_codebase", "web_search", "run_command"] - choose the tools this skill should have access to,
  "description": "A brief 1-2 sentence description of what this skill does"
}

Available tools:
- read_file: Read any file in the workspace
- write_file: Write or edit a file
- list_files: List all files in the workspace
- search_codebase: Search for text patterns across the codebase
- web_search: Search the public web for current information and cited sources
- run_command: Run an explicitly user-approved non-interactive command in the physical workspace

For a coding/building skill, enable all tools.
For a read-only analysis/planning skill, only enable: read_file, list_files, search_codebase
For a question-heavy skill (like 'grind-me'), enable all tools but emphasize asking questions in the systemPrompt.`;

    const content = await resolveHarness(customProvider).completeText({
      modelReference,
      customProvider,
      systemPrompt: metaPrompt,
      userMessage: `Generate a skill for: ${description}`,
      maxTokens: 4000,
      cwd: data.workspaceRoot,
      onUsage: data.workspaceRoot
        ? createUsageReporter(ws, {
            workspaceRoot: data.workspaceRoot,
            surface: "skill_generation",
            model: modelReference,
            provider: customProvider?.id,
          })
        : undefined,
    });

    let spec: any;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        spec = JSON.parse(jsonMatch[0]);
      } else {
        spec = JSON.parse(content);
      }
    } catch (parseErr) {
      console.error(`WebSocket [Server] Failed to parse skill spec: ${content}`);
      safeSend(ws, {
        type: "generate_skill_error",
        error: "Failed to parse skill specification. Please try again."
      });
      return;
    }

    if (!spec.systemPrompt || !Array.isArray(spec.enabledTools)) {
      spec.systemPrompt = spec.systemPrompt || `You are a coding agent focused on: ${description}`;
      spec.enabledTools = spec.enabledTools || ["read_file", "list_files", "search_codebase"];
    }

    spec.enabledTools = spec.enabledTools.filter((t: string) => AVAILABLE_TOOLS.includes(t));
    if (spec.enabledTools.length === 0) {
      spec.enabledTools = ["read_file", "list_files", "search_codebase"];
    }

    sendLog("Skill generated successfully.");

    safeSend(ws, {
      type: "generate_skill_response",
      spec
    });

  } catch (err: any) {
    console.error(`WebSocket [Server] generate_skill error:`, err);
    safeSend(ws, {
      type: "generate_skill_error",
      error: err.message || "Failed to generate skill"
    });
  }
}
