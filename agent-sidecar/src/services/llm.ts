/**
 * LLM Service
 * 
 * Functions to call OpenAI-compatible LLM endpoints, handle single-round
 * and multi-round tool calling loops, parse XML tool requests, and truncate
 * tool output to prevent context window overflow.
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
