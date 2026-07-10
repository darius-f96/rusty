/**
 * LLM Service
 * 
 * Functions to call OpenAI-compatible LLM endpoints, handle single-round
 * and multi-round tool calling loops, parse XML tool requests, truncate
 * tool output to prevent context window overflow, and stream SSE responses
 * for real-time token delivery.
 */

export const MAX_TOOL_RESULT_LENGTH = 8000; // Limit tool results to prevent context overflow

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function truncateToolResult(content: string, maxLength: number): string {
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength) + `\n\n[...truncated ${content.length - maxLength} characters...]`;
}

/** A safe, user-facing explanation of an action; never includes file contents or secrets. */
function describeToolIntent(toolName: string, args: Record<string, any>): string {
  const value = (key: string) => typeof args[key] === "string" ? args[key] : "";
  if (toolName === "read_file" || toolName === "write_file") return `${toolName === "read_file" ? "Reading" : "Updating"} ${value("path") || "a workspace file"}.`;
  if (toolName === "search_codebase") return `Searching the codebase for “${value("pattern") || "a relevant pattern"}”.`;
  if (toolName === "web_search") return `Searching the web for “${value("query") || "current information"}”.`;
  if (toolName === "list_files") return "Inspecting the workspace structure.";
  return `Using ${toolName}.`;
}

export async function callLlmWithTools(
  config: LlmConfig,
  systemPrompt: string,
  userMessage: string,
  tools: Array<{ name: string; description: string; inputSchema?: any; execute: (args: any) => Promise<any> }>,
  workspaceRoot: string,
  sendLog: (msg: string) => void
): Promise<string> {
  const { baseUrl, apiKey, model } = config;
  
  const messages: Array<{role: string, content: string | Array<any>}> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage }
  ];

  const openaiTools = tools.map(tool => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema || {
        type: "object",
        properties: {},
        required: []
      }
    }
  }));

  sendLog(`Calling LLM: ${model} at ${baseUrl}`);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      tools: openaiTools,
      tool_choice: "auto"
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const assistantMessage = data.choices?.[0]?.message;

  if (!assistantMessage) {
    throw new Error("No response from LLM");
  }

  if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
    sendLog(`LLM requested ${assistantMessage.tool_calls.length} tool call(s)`);
    const toolResults: Array<{role: string, tool_call_id: string, name: string, content: string}> = [];
    
    for (const toolCall of assistantMessage.tool_calls) {
      const toolName = toolCall.function.name;
      const toolArgs = JSON.parse(toolCall.function.arguments || "{}");
      
      sendLog(`Executing tool: ${toolName} with args: ${JSON.stringify(toolArgs)}`);
      
      const tool = tools.find(t => t.name === toolName);
      if (tool) {
        try {
          const result = await tool.execute(toolArgs);
          const truncatedResult = truncateToolResult(String(result), MAX_TOOL_RESULT_LENGTH);
          toolResults.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolName,
            content: truncatedResult
          });
        } catch (err: any) {
          toolResults.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolName,
            content: `Error: ${err.message}`
          });
        }
      } else {
        toolResults.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolName,
          content: `Tool ${toolName} not found`
        });
      }
    }

    messages.push(assistantMessage);
    messages.push(...toolResults);

    const followUpResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: messages
      })
    });

    if (!followUpResponse.ok) {
      const errorText = await followUpResponse.text();
      throw new Error(`LLM follow-up error: ${followUpResponse.status} - ${errorText}`);
    }

    const followUpData = await followUpResponse.json();
    return followUpData.choices?.[0]?.message?.content || "No response";
  }

  return assistantMessage.content || "No content";
}

/** Parse tool calls from XML-like content */
export function parseToolCallsFromContent(content: string): Array<{name: string, arguments: string}> | null {
  const toolCallRegex = /<function=(\w+)>\s*<parameter=(\w+)>\s*([^<]+)\s*<\/parameter>\s*<\/function>/g;
  const matches = [...content.matchAll(toolCallRegex)];
  if (matches.length === 0) return null;
  
  const toolCalls: Array<{name: string, arguments: string}> = [];
  for (const match of matches) {
    const [, name, paramName, paramValue] = match;
    try {
      const args = JSON.parse(`{"${paramName}": "${paramValue.trim()}"}`);
      toolCalls.push({ name, arguments: JSON.stringify(args) });
    } catch {
      // Skip malformed tool calls
    }
  }
  return toolCalls.length > 0 ? toolCalls : null;
}

/** Make LLM calls with tools, handling multiple rounds of tool execution */
export async function callLlmWithToolsMultiRound(
  config: LlmConfig,
  systemPrompt: string,
  userMessage: string,
  tools: Array<{ name: string; description: string; inputSchema?: any; execute: (args: any) => Promise<any> }>,
  workspaceRoot: string,
  sendLog: (msg: string) => void,
  maxRounds = 50,
  chatHistory: Array<any> = [],
  shouldAbort: () => boolean = () => false
): Promise<string> {
  const { baseUrl, apiKey, model } = config;

  const sanitizedHistory = (chatHistory || []).filter(
    (m: any) => m && (m.role === "user" || m.role === "assistant" || m.role === "system")
  );

  const messages: Array<any> = [
    { role: "system", content: systemPrompt },
    ...sanitizedHistory,
    { role: "user", content: userMessage }
  ];

  if (userMessage.includes('<model Instructions>')) {
    console.log(`\n=== WebSocket [Server] USER PROMPT WITH PLAN-ONLY INSTRUCTIONS ===`);
    console.log(userMessage);
    console.log(`=== END USER PROMPT ===\n`);
  }

  const openaiTools = tools.map(tool => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema || {
        type: "object",
        properties: {},
        required: []
      }
    }
  }));

  sendLog(`Calling LLM: ${model} at ${baseUrl}`);
  console.log(`WebSocket [Server] LLM Start: ${model} @ ${baseUrl}`);

  let round = 0;
  while (round < maxRounds) {
    if (shouldAbort()) {
      console.log(`WebSocket [Server] LLM loop aborted: client disconnected before round ${round + 1}`);
      throw new Error("Client disconnected");
    }
    round++;
    sendLog(`LLM round ${round} starting...`);
    console.log(`\n--- WebSocket [Server] LLM Round ${round} ---`);
    console.log(`WebSocket [Server] Messages count: ${messages.length}`);
    console.log(`WebSocket [Server] Message roles: ${messages.map((m: any) => `${m.role}(${typeof m.content === 'string' ? m.content.length : 0}ch)`).join(', ')}`);

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        tools: openaiTools,
        tool_choice: "auto"
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`WebSocket [Server] Round ${round} API error: ${response.status} - ${errorText}`);
      throw new Error(`LLM API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (shouldAbort()) {
      console.log(`WebSocket [Server] LLM loop aborted: client disconnected after round ${round} response`);
      throw new Error("Client disconnected");
    }

    const finishReason = data.choices?.[0]?.finish_reason || 'unknown';
    const contentLen = data.choices?.[0]?.message?.content?.length || 0;
    const toolCallCount = data.choices?.[0]?.message?.tool_calls?.length || 0;
    console.log(`WebSocket [Server] Round ${round} Response: finish_reason=${finishReason}, content=${contentLen}ch, tool_calls=${toolCallCount}`);
    
    const assistantMessage = data.choices?.[0]?.message;

    if (!assistantMessage) {
      console.error(`WebSocket [Server] Round ${round} choice message is missing.`);
      throw new Error("No response from LLM");
    }

    let toolCalls = assistantMessage.tool_calls || [];
    
    if (toolCalls.length === 0 && assistantMessage.content) {
      const parsed = parseToolCallsFromContent(assistantMessage.content);
      if (parsed) {
        sendLog(`Found ${parsed.length} XML-style tool call(s) in content`);
        console.log(`WebSocket [Server] Parsed XML-style tool calls:`, parsed);
        toolCalls = parsed.map((tc, idx) => ({
          id: `call_xml_${round}_${idx}`,
          function: { name: tc.name, arguments: tc.arguments },
          type: "function" as const
        }));
        assistantMessage.tool_calls = toolCalls;
      }
    }

    messages.push(assistantMessage);

    if (toolCalls.length === 0) {
      sendLog(`LLM finished gathering information in round ${round}.`);
      console.log(`WebSocket [Server] LLM finished tool calls in round ${round}. Content:`, assistantMessage.content);
      return assistantMessage.content || "No content";
    }

    sendLog(`LLM requested ${toolCalls.length} tool call(s)`);
    console.log(`WebSocket [Server] LLM requested ${toolCalls.length} tool calls in round ${round}`);

    for (const toolCall of toolCalls) {
      if (shouldAbort()) {
        console.log(`WebSocket [Server] LLM loop aborted: client disconnected during tool execution in round ${round}`);
        throw new Error("Client disconnected");
      }
      const toolName = toolCall.function.name;
      let toolArgs = {};
      try {
        toolArgs = JSON.parse(toolCall.function.arguments || "{}");
      } catch {
        toolArgs = {};
      }
      
      sendLog(`Executing tool: ${toolName} with args: ${JSON.stringify(toolArgs)}`);
      console.log(`WebSocket [Server] Executing tool: ${toolName}`, toolArgs);
      
      const tool = tools.find(t => t.name === toolName);
      if (tool) {
        try {
          const result = await tool.execute(toolArgs);
          const resultStr = typeof result === "string" ? result : JSON.stringify(result);
          const truncatedResult = truncateToolResult(resultStr, MAX_TOOL_RESULT_LENGTH);
          console.log(`WebSocket [Server] Tool ${toolName} success (result length: ${truncatedResult.length})`);
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolName,
            content: truncatedResult
          });
        } catch (err: any) {
          console.error(`WebSocket [Server] Tool ${toolName} execution error:`, err);
          if (shouldAbort()) {
            console.log(`WebSocket [Server] LLM loop aborted: client disconnected during tool execution in round ${round}`);
            throw new Error("Client disconnected");
          }
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolName,
            content: `Error: ${err.message}`
          });
        }
      } else {
        console.error(`WebSocket [Server] Tool ${toolName} not found in registered tools.`);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolName,
          content: `Tool ${toolName} not found`
        });
      }
    }
    
    sendLog(`Tool execution complete, continuing to round ${round + 1}...`);
  }

  sendLog(`Max tool rounds (${maxRounds}) reached. Summarizing gathered findings...`);
  console.log(`WebSocket [Server] Max rounds reached (${maxRounds}). Running final clean summary call.`);
  try {
    const toolExecutions = messages
      .filter(m => m.role === "tool")
      .map(m => `### Tool [${m.name}] output:\n${m.content}`)
      .join("\n\n");

    const finalMessages = [
      { role: "system", content: "You are a codebase exploration assistant. Summarize the findings and answer the user's question clearly based on the provided tool outputs." },
      ...sanitizedHistory,
      { role: "user", content: `${userMessage}\n\nHere are the results of the files read and codebase searches:\n${toolExecutions}` }
    ];

    console.log(`WebSocket [Server] Outgoing final summary messages count: ${finalMessages.length}`);
    console.log(`WebSocket [Server] Final summary message roles: ${finalMessages.map((m: any) => `${m.role}(${typeof m.content === 'string' ? m.content.length : 0}ch)`).join(', ')}`);

    const finalResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: finalMessages
      })
    });

    if (finalResponse.ok) {
      const finalData = await finalResponse.json();
      console.log(`WebSocket [Server] Final summary response: ${finalData.choices?.[0]?.message?.content?.length || 0} chars`);
      const summaryContent = finalData.choices?.[0]?.message?.content;
      if (summaryContent) {
        sendLog(`Final summary generated successfully.`);
        return summaryContent;
      }
    } else {
      const errorText = await finalResponse.text();
      console.error(`WebSocket [Server] Final summary call API error: ${finalResponse.status} - ${errorText}`);
      sendLog(`Final summary call error: ${finalResponse.status}`);
    }
  } catch (finalCallError: any) {
    console.error("WebSocket [Server] Error generating final summary call:", finalCallError);
    sendLog(`Final summary call exception: ${finalCallError.message}`);
  }

  console.warn("WebSocket [Server] Summary generation failed. Falling back to structured tools output.");
  const toolExecutionsSummary = messages
    .filter(m => m.role === "tool")
    .map(m => `### Tool Output [${m.name}]\n${m.content}`)
    .join("\n\n");

  return `Exploration completed. I gathered the following codebase information:\n\n${toolExecutionsSummary}`;
}

// ─── SSE Stream Helpers ────────────────────────────────────────────────

/** Parse an SSE (Server-Sent Events) stream from a fetch Response, yielding parsed JSON objects. */
async function* parseSSEStream(response: Response): AsyncGenerator<any> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Response body is not readable");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    // Keep the last potentially-incomplete line in the buffer
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":")) continue; // Skip empty lines and comments
      if (trimmed === "data: [DONE]") return;
      if (trimmed.startsWith("data: ")) {
        try {
          yield JSON.parse(trimmed.slice(6));
        } catch {
          // Skip malformed JSON chunks
        }
      }
    }
  }
}

/** Accumulate streaming tool_calls deltas into complete tool call objects. */
function accumulateToolCallDelta(
  accumulated: Array<{ id: string; function: { name: string; arguments: string }; type: string }>,
  delta: any
) {
  if (!delta.tool_calls) return;
  for (const tc of delta.tool_calls) {
    const idx = tc.index ?? accumulated.length;
    if (!accumulated[idx]) {
      accumulated[idx] = {
        id: tc.id || `call_stream_${idx}`,
        function: { name: "", arguments: "" },
        type: "function"
      };
    }
    if (tc.id) accumulated[idx].id = tc.id;
    if (tc.function?.name) accumulated[idx].function.name += tc.function.name;
    if (tc.function?.arguments) accumulated[idx].function.arguments += tc.function.arguments;
  }
}

// ─── Streaming Multi-Round LLM Function ────────────────────────────────

/** Make LLM calls with tools using SSE streaming, handling multiple rounds of tool execution.
 *  Tokens are emitted in real-time via the `sendToken` callback.
 *  Falls back to non-streaming if the provider doesn't support SSE. */
export async function callLlmWithToolsMultiRoundStreaming(
  config: LlmConfig,
  systemPrompt: string,
  userMessage: string,
  tools: Array<{ name: string; description: string; inputSchema?: any; execute: (args: any) => Promise<any> }>,
  workspaceRoot: string,
  sendLog: (msg: string) => void,
  sendToken: (token: string) => void,
  maxRounds = 50,
  chatHistory: Array<any> = [],
  shouldAbort: () => boolean = () => false
): Promise<string> {
  const { baseUrl, apiKey, model } = config;

  const sanitizedHistory = (chatHistory || []).filter(
    (m: any) => m && (m.role === "user" || m.role === "assistant" || m.role === "system")
  );

  const messages: Array<any> = [
    { role: "system", content: systemPrompt },
    ...sanitizedHistory,
    { role: "user", content: userMessage }
  ];

  const openaiTools = tools.map(tool => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema || {
        type: "object",
        properties: {},
        required: []
      }
    }
  }));

  sendLog(`Calling LLM (streaming): ${model} at ${baseUrl}`);
  sendLog("Reviewing the request and deciding on the next useful action.");
  console.log(`WebSocket [Server] LLM Start (streaming): ${model} @ ${baseUrl}`);

  let round = 0;
  while (round < maxRounds) {
    if (shouldAbort()) {
      console.log(`WebSocket [Server] Streaming LLM loop aborted: client disconnected before round ${round + 1}`);
      throw new Error("Client disconnected");
    }
    round++;
    sendLog(`Planning step ${round}: reviewing the available context and tools.`);
    console.log(`\n--- WebSocket [Server] Streaming LLM Round ${round} ---`);
    console.log(`WebSocket [Server] Messages count: ${messages.length}`);

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: messages,
          tools: openaiTools,
          tool_choice: "auto",
          stream: true
        })
      });
    } catch (fetchErr: any) {
      console.error(`WebSocket [Server] Streaming fetch failed:`, fetchErr);
      throw new Error(`LLM API fetch error: ${fetchErr.message}`);
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`WebSocket [Server] Round ${round} API error: ${response.status} - ${errorText}`);
      throw new Error(`LLM API error: ${response.status} - ${errorText}`);
    }

    // Check if the server actually returned a stream
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/event-stream") && !contentType.includes("text/plain")) {
      // Server returned a non-streaming JSON response — fall back to parsing it directly
      console.log(`WebSocket [Server] Round ${round}: Server returned non-streaming response (${contentType}), parsing as JSON`);
      const data = await response.json();
      const assistantMessage = data.choices?.[0]?.message;
      if (!assistantMessage) throw new Error("No response from LLM");

      // Emit content if present
      if (assistantMessage.content) {
        sendToken(assistantMessage.content);
      }

      messages.push(assistantMessage);
      const toolCalls = assistantMessage.tool_calls || [];

      if (toolCalls.length === 0) {
        sendLog(`LLM finished in round ${round}.`);
        return assistantMessage.content || "No content";
      }

      // Execute tools in parallel
      sendLog(`Selected ${toolCalls.length} action${toolCalls.length === 1 ? "" : "s"} to gather the needed information.`);
      const toolResults = await executeToolCallsParallel(toolCalls, tools, sendLog, shouldAbort);
      messages.push(...toolResults);
      sendLog(`Tool execution complete, continuing to round ${round + 1}...`);
      continue;
    }

    // ── Stream the SSE response ─────────────────────────────────────
    let contentAccumulator = "";
    const toolCallsAccumulator: Array<{ id: string; function: { name: string; arguments: string }; type: string }> = [];
    let finishReason = "";

    try {
      for await (const chunk of parseSSEStream(response)) {
        if (shouldAbort()) {
          console.log(`WebSocket [Server] Streaming aborted mid-stream in round ${round}`);
          throw new Error("Client disconnected");
        }

        const delta = chunk.choices?.[0]?.delta;
        const chunkFinishReason = chunk.choices?.[0]?.finish_reason;

        if (chunkFinishReason) {
          finishReason = chunkFinishReason;
        }

        if (!delta) continue;

        // Emit content tokens in real-time
        if (delta.content) {
          contentAccumulator += delta.content;
          sendToken(delta.content);
        }

        // Accumulate tool call deltas
        accumulateToolCallDelta(toolCallsAccumulator, delta);
      }
    } catch (streamErr: any) {
      if (streamErr.message === "Client disconnected") throw streamErr;
      console.error(`WebSocket [Server] Stream parsing error in round ${round}:`, streamErr);
      throw new Error(`Stream parsing error: ${streamErr.message}`);
    }

    console.log(`WebSocket [Server] Round ${round} streamed: finish_reason=${finishReason}, content=${contentAccumulator.length}ch, tool_calls=${toolCallsAccumulator.length}`);

    // Build the assistant message from accumulated data
    const assistantMessage: any = {
      role: "assistant",
      content: contentAccumulator || null
    };
    if (toolCallsAccumulator.length > 0) {
      assistantMessage.tool_calls = toolCallsAccumulator;
    }

    // Check for XML-style tool calls in content (fallback for some providers)
    if (toolCallsAccumulator.length === 0 && contentAccumulator) {
      const parsed = parseToolCallsFromContent(contentAccumulator);
      if (parsed) {
        sendLog(`Found ${parsed.length} XML-style tool call(s) in streamed content`);
        const xmlToolCalls = parsed.map((tc, idx) => ({
          id: `call_xml_${round}_${idx}`,
          function: { name: tc.name, arguments: tc.arguments },
          type: "function" as const
        }));
        assistantMessage.tool_calls = xmlToolCalls;
        toolCallsAccumulator.push(...xmlToolCalls);
      }
    }

    messages.push(assistantMessage);

    if (toolCallsAccumulator.length === 0) {
      sendLog(`LLM finished in round ${round}.`);
      console.log(`WebSocket [Server] Streaming LLM finished in round ${round}.`);
      return contentAccumulator || "No content";
    }

    // Execute tools in parallel
    sendLog(`Selected ${toolCallsAccumulator.length} action${toolCallsAccumulator.length === 1 ? "" : "s"} to gather the needed information.`);
    console.log(`WebSocket [Server] Executing ${toolCallsAccumulator.length} tool calls in parallel`);

    const toolResults = await executeToolCallsParallel(toolCallsAccumulator, tools, sendLog, shouldAbort);
    messages.push(...toolResults);
    sendLog("Reviewing the tool results before continuing.");
  }

  // Max rounds reached — generate a summary
  sendLog(`Max tool rounds (${maxRounds}) reached. Summarizing gathered findings...`);
  console.log(`WebSocket [Server] Max rounds reached (${maxRounds}). Running final clean summary call.`);
  try {
    const toolExecutions = messages
      .filter(m => m.role === "tool")
      .map(m => `### Tool [${m.name}] output:\n${m.content}`)
      .join("\n\n");

    const finalMessages = [
      { role: "system", content: "You are a codebase exploration assistant. Summarize the findings and answer the user's question clearly based on the provided tool outputs." },
      ...sanitizedHistory,
      { role: "user", content: `${userMessage}\n\nHere are the results of the files read and codebase searches:\n${toolExecutions}` }
    ];

    const finalResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: finalMessages,
        stream: true
      })
    });

    if (finalResponse.ok) {
      const finalContentType = finalResponse.headers.get("content-type") || "";
      if (finalContentType.includes("text/event-stream") || finalContentType.includes("text/plain")) {
        let summaryContent = "";
        for await (const chunk of parseSSEStream(finalResponse)) {
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.content) {
            summaryContent += delta.content;
            sendToken(delta.content);
          }
        }
        if (summaryContent) {
          sendLog(`Final summary generated successfully.`);
          return summaryContent;
        }
      } else {
        const finalData = await finalResponse.json();
        const summaryContent = finalData.choices?.[0]?.message?.content;
        if (summaryContent) {
          sendToken(summaryContent);
          sendLog(`Final summary generated successfully.`);
          return summaryContent;
        }
      }
    } else {
      const errorText = await finalResponse.text();
      console.error(`WebSocket [Server] Final summary call API error: ${finalResponse.status} - ${errorText}`);
      sendLog(`Final summary call error: ${finalResponse.status}`);
    }
  } catch (finalCallError: any) {
    console.error("WebSocket [Server] Error generating final summary call:", finalCallError);
    sendLog(`Final summary call exception: ${finalCallError.message}`);
  }

  const toolExecutionsSummary = messages
    .filter(m => m.role === "tool")
    .map(m => `### Tool Output [${m.name}]\n${m.content}`)
    .join("\n\n");

  return `Exploration completed. I gathered the following codebase information:\n\n${toolExecutionsSummary}`;
}

// ─── Parallel Tool Execution ───────────────────────────────────────────

/** Execute multiple tool calls in parallel, returning results in the correct message format. */
async function executeToolCallsParallel(
  toolCalls: Array<{ id: string; function: { name: string; arguments: string }; type: string }>,
  tools: Array<{ name: string; description: string; inputSchema?: any; execute: (args: any) => Promise<any> }>,
  sendLog: (msg: string) => void,
  shouldAbort: () => boolean
): Promise<Array<{ role: string; tool_call_id: string; name: string; content: string }>> {
  const results = await Promise.all(
    toolCalls.map(async (toolCall) => {
      if (shouldAbort()) {
        return {
          role: "tool" as const,
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: "Error: Client disconnected"
        };
      }

      const toolName = toolCall.function.name;
      let toolArgs = {};
      try {
        toolArgs = JSON.parse(toolCall.function.arguments || "{}");
      } catch {
        toolArgs = {};
      }

      sendLog(describeToolIntent(toolName, toolArgs));
      console.log(`WebSocket [Server] Executing tool (parallel): ${toolName}`, toolArgs);

      const tool = tools.find(t => t.name === toolName);
      if (!tool) {
        console.error(`WebSocket [Server] Tool ${toolName} not found.`);
        return {
          role: "tool" as const,
          tool_call_id: toolCall.id,
          name: toolName,
          content: `Tool ${toolName} not found`
        };
      }

      try {
        const result = await tool.execute(toolArgs);
        const resultStr = typeof result === "string" ? result : JSON.stringify(result);
        const truncatedResult = truncateToolResult(resultStr, MAX_TOOL_RESULT_LENGTH);
        sendLog(`Finished ${toolName}; incorporating the result.`);
        console.log(`WebSocket [Server] Tool ${toolName} success (${truncatedResult.length} chars)`);
        return {
          role: "tool" as const,
          tool_call_id: toolCall.id,
          name: toolName,
          content: truncatedResult
        };
      } catch (err: any) {
        sendLog(`${toolName} could not complete; choosing a fallback if available.`);
        console.error(`WebSocket [Server] Tool ${toolName} error:`, err);
        return {
          role: "tool" as const,
          tool_call_id: toolCall.id,
          name: toolName,
          content: `Error: ${err.message}`
        };
      }
    })
  );

  return results;
}
