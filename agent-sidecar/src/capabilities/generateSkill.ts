/**
 * Generate Skill Capability
 *
 * Generates a skill specification (systemPrompt, enabledTools, description)
 * based on a natural language description using an LLM.
 */

import { WebSocket } from "ws";
import { safeSend } from "../services/websocket";
import { LlmConfig } from "../services/llm";

const AVAILABLE_TOOLS = ["read_file", "write_file", "list_files", "search_codebase"];

export async function generateSkill(ws: WebSocket, data: any): Promise<void> {
  const { description, model, customProvider } = data;
  console.log(`WebSocket [Server] generate_skill starting`, { model, hasCustomProvider: !!customProvider });

  const sendLog = (logMessage: string) => {
    safeSend(ws, { type: "generate_skill_log", message: logMessage });
  };

  try {
    let llmConfig: LlmConfig;
    let modelId = model || "claude-3-5-sonnet";

    if (customProvider && customProvider.baseUrl && customProvider.apiKey) {
      let selectedModel = modelId;
      if (selectedModel.includes("/")) {
        selectedModel = selectedModel.split("/")[1];
      }
      if (!selectedModel || selectedModel === "claude-3-5-sonnet") {
        const firstModel = customProvider.models?.[0]?.id || "";
        selectedModel = firstModel.includes("/") ? firstModel.split("/")[1] : firstModel;
      }
      llmConfig = {
        baseUrl: customProvider.baseUrl.replace(/\/$/, ""),
        apiKey: customProvider.apiKey,
        model: selectedModel
      };
      sendLog(`Using custom provider: ${customProvider.name}`);
    } else if (model && model.includes("/")) {
      const [provider] = model.split("/");
      if (provider === "anthropic") {
        llmConfig = {
          baseUrl: "https://api.anthropic.com/v1",
          apiKey: process.env.ANTHROPIC_API_KEY || "",
          model: model.split("/")[1]
        };
      } else if (provider === "openai") {
        llmConfig = {
          baseUrl: "https://api.openai.com/v1",
          apiKey: process.env.OPENAI_API_KEY || "",
          model: model.split("/")[1]
        };
      } else {
        throw new Error(`Unknown provider: ${provider}.`);
      }
    } else {
      throw new Error("No LLM configuration available.");
    }

    if (!llmConfig.apiKey) {
      throw new Error("No API key available.");
    }

    sendLog(`Generating skill with ${llmConfig.model}...`);

    const metaPrompt = `You are a skill designer for an AI coding agent. Based on the following description, generate a skill specification as a JSON object.

Description: ${description}

Return ONLY a valid JSON object with this structure (no markdown, no explanation):
{
  "systemPrompt": "The system prompt for the skill - be specific about behavior, guidelines, and tone",
  "enabledTools": ["read_file", "write_file", "list_files", "search_codebase"] - choose the tools this skill should have access to,
  "description": "A brief 1-2 sentence description of what this skill does"
}

Available tools:
- read_file: Read any file in the workspace
- write_file: Write or edit a file
- list_files: List all files in the workspace
- search_codebase: Search for text patterns across the codebase

For a coding/building skill, enable all tools.
For a read-only analysis/planning skill, only enable: read_file, list_files, search_codebase
For a question-heavy skill (like 'grind-me'), enable all tools but emphasize asking questions in the systemPrompt.`;

    const response = await fetch(`${llmConfig.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${llmConfig.apiKey}`
      },
      body: JSON.stringify({
        model: llmConfig.model,
        messages: [
          { role: "system", content: metaPrompt },
          { role: "user", content: `Generate a skill for: ${description}` }
        ],
        max_tokens: 1000,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

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