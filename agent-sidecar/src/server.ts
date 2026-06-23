import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Map to track active websocket callbacks for tool requests
const pendingRequests = new Map<string, (response: any) => void>();

// Helper to generate unique request IDs
let nextRequestId = 1;
function getNextId() {
  return `req_${nextRequestId++}`;
}

wss.on("connection", (ws: WebSocket) => {
  console.log("WebSocket [Server] Client connected to Pi Sidecar");

  ws.on("message", async (messageStr: string) => {
    let data;
    try {
      data = JSON.parse(messageStr);
    } catch (e) {
      console.error("WebSocket [Server] Invalid JSON received", e);
      return;
    }

    console.log(`WebSocket [Server] Received message type: ${data.type}`);

    // Handle tool execution responses coming back from React/Tauri
    if (data.type === "read_file_response" || data.type === "write_file_response") {
      console.log(`WebSocket [Server] Resolving pending request: ${data.requestId}`, { hasError: !!data.error });
      const resolver = pendingRequests.get(data.requestId);
      if (resolver) {
        resolver(data);
        pendingRequests.delete(data.requestId);
      }
      return;
    }

    // Handle initial execution request
    if (data.type === "execute_node") {
      const { nodeId, instructions, model, workspaceRoot, inputFiles, customProvider } = data;
      console.log(`WebSocket [Server] execute_node task starting`, {
        nodeId,
        model,
        workspaceRoot,
        inputFilesCount: inputFiles?.length || 0
      });

      // Keep track of files modified by this task execution
      const modifiedFiles = new Set<string>();

      // Helper to log status back to React node UI
      const sendLog = (message: string) => {
        ws.send(JSON.stringify({ type: "log", nodeId, message }));
      };

      try {
        // Register custom LLM provider if supplied
        if (customProvider) {
          sendLog(`Registering custom LLM provider: ${customProvider.name} (${customProvider.id})`);
          console.log(`WebSocket [Server] registering custom provider`, customProvider);
          try {
            const { registerProvider } = require("@earendil-works/pi-agent-core");
            registerProvider(customProvider.id, {
              name: customProvider.name,
              baseUrl: customProvider.baseUrl,
              apiKey: customProvider.apiKey || "not-needed",
              api: customProvider.apiType || "openai-completions",
              models: customProvider.models
            });
            sendLog("Custom provider registered successfully.");
          } catch (err: any) {
            console.error("Could not register custom provider:", err.message);
            sendLog(`Provider warning: Using simulated/mock LLM fallback due to: ${err.message}`);
          }
        }

        // Setup VFS bridged tools using WebSocket messages back to the frontend
        const readVfsTool = {
          name: "read_file",
          description: "Read a file's content from the virtual workspace.",
          execute: async ({ path }: { path: string }) => {
            console.log(`WebSocket [Server] tool read_file requested: ${path}`);
            sendLog(`AI reading file context: ${path}`);
            return new Promise((resolve, reject) => {
              const requestId = getNextId();
              pendingRequests.set(requestId, (res) => {
                if (res.error) {
                  console.error(`WebSocket [Server] read_file failed for: ${path}`, res.error);
                  reject(new Error(res.error));
                } else {
                  console.log(`WebSocket [Server] read_file success for: ${path} (${res.content?.length || 0} chars)`);
                  resolve(res.content);
                }
              });
              ws.send(JSON.stringify({ type: "read_file", requestId, path }));
            });
          }
        };

        const writeVfsTool = {
          name: "write_file",
          description: "Write or edit a file's content in the virtual workspace.",
          execute: async ({ path, content }: { path: string; content: string }) => {
            console.log(`WebSocket [Server] tool write_file requested: ${path} (${content.length} chars)`);
            sendLog(`AI modifying file: ${path}`);
            // Track modification
            modifiedFiles.add(path);
            
            return new Promise((resolve, reject) => {
              const requestId = getNextId();
              pendingRequests.set(requestId, (res) => {
                if (res.error) {
                  console.error(`WebSocket [Server] write_file failed for: ${path}`, res.error);
                  reject(new Error(res.error));
                } else {
                  console.log(`WebSocket [Server] write_file success for: ${path}`);
                  resolve({ success: true });
                }
              });
              ws.send(JSON.stringify({ type: "write_file", requestId, path, content }));
            });
          }
        };

        sendLog("Initializing Pi agent runtime...");

        // Generate dynamic system prompt matching active inputs
        const filesList = inputFiles && inputFiles.length > 0
          ? `You have direct read/write access to the following connected files:
${inputFiles.map((f: any) => `- ${f.path}`).join("\n")}
Please read them first if you need to modify or inspect them.`
          : `No input files are directly connected to this task node. You can read/write any files in the workspace.`;

        const systemPrompt = `You are an AI coding agent operating inside a spatial canvas.
Update files according to these user instructions: ${instructions}

Workspace directory root: ${workspaceRoot || "unknown"}
${filesList}

Remember:
- Use the 'read_file' tool to read a file's current content before editing it.
- Use the 'write_file' tool to write the updated content back.
- Always output clean code without placeholder comments.
`;

        // Simulate Pi SDK run loop or construct actual session runtime
        let runResult;
        try {
          const { createAgentSessionRuntime } = require("@earendil-works/pi-agent-core");
          console.log("WebSocket [Server] Instantiating Pi Agent Core Runtime...");
          const runtime = await createAgentSessionRuntime({
            tools: [readVfsTool, writeVfsTool],
            modelName: model || "anthropic/claude-3-5-sonnet",
            systemPrompt: systemPrompt
          });
          sendLog("Executing agent reasoning loop...");
          console.log("WebSocket [Server] Running agent core loop...");
          runResult = await runtime.run();
        } catch (sdkError: any) {
          console.warn("WebSocket [Server] Pi SDK load warning (using simulation fallback):", sdkError.message);
          sendLog(`Pi SDK load warning (using simulation fallback): ${sdkError.message}`);
          
          // Simulation fallback for prototype/offline run
          await new Promise((resolve) => setTimeout(resolve, 1200));
          
          const targetFile = inputFiles && inputFiles.length > 0 
            ? inputFiles[0].path 
            : "./src/App.tsx";
            
          sendLog(`Simulated AI reading connected target: ${targetFile}`);
          try {
            const text = await readVfsTool.execute({ path: targetFile }) as string;
            
            sendLog("Simulated AI planning refactoring edits...");
            await new Promise((resolve) => setTimeout(resolve, 1200));
            
            let updatedContent = text;
            if (text.includes("Welcome to Tauri + React")) {
              updatedContent = text.replace(
                "Welcome to Tauri + React",
                "Spatial IDE Orchestrated Code"
              );
            } else if (text.trim().length > 0) {
              updatedContent = `// Edited by AI spatial orchestrator simulation at ${new Date().toLocaleTimeString()}\n${text}`;
            } else {
              updatedContent = `// Created by AI spatial orchestrator simulation at ${new Date().toLocaleTimeString()}\n`;
            }
            
            await writeVfsTool.execute({ path: targetFile, content: updatedContent });
            runResult = { status: "success" };
          } catch (simErr: any) {
            console.error("Simulation failed:", simErr);
            throw new Error(`Simulation failed: ${simErr.message}`);
          }
        }

        const finalModifiedList = Array.from(modifiedFiles);
        console.log(`WebSocket [Server] task execution complete! Modified files:`, finalModifiedList);

        ws.send(
          JSON.stringify({
            type: "execution_complete",
            nodeId,
            result: {
              ...runResult,
              modified: finalModifiedList.length > 0 ? finalModifiedList : (runResult?.modified || [])
            }
          })
        );
      } catch (err: any) {
        console.error("WebSocket [Server] Execution failed:", err);
        ws.send(
          JSON.stringify({
            type: "execution_error",
            nodeId,
            error: err.message
          })
        );
      }
    }
  });

  ws.on("close", () => {
    console.log("WebSocket [Server] Client disconnected");
  });
});

// Expose status endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", mode: "sidecar" });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Pi sidecar server listening on port ${PORT}`);
});
