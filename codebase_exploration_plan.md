# Implementation Plan: Codebase Exploration & Prompt Injection

This document contains the step-by-step implementation plan for the **Codebase Context Exploration & Prompt Injection** system using the Pi Agent sidecar and React Flow.

---

## 1. System Overview

- **Global Chat Node**: A spatial explorer node of type `globalChatNode` placed on the canvas. It explores directories and queries code layouts. The resulting guidelines are stored in Zustand as `globalContextSummary`.
- **Sidecar Search Tools**: Backend tools registered inside `agent-sidecar/src/server.ts` to allow local file traversal and grepping.
- **Prompt Injection**: Automated injection of `globalContextSummary` into all target `TaskNode` prompts during execution.

---

## 2. Technical Additions

### A. Sidecar Tool Registration
Add the following tools to the Pi Agent runtime inside [agent-sidecar/src/server.ts](file:///Users/suciuvictortraian/Development/axiom/agent-sidecar/src/server.ts):

1. **`list_files`**:
   Recursively returns paths in the workspace (ignores `node_modules`, `dist`, `.git`).
2. **`search_codebase`**:
   Runs simple text matching or regex searches across workspace files.

```typescript
// Tool specifications in server.ts
const listFilesTool = {
  name: "list_files",
  description: "Get list of all file paths in workspace recursively.",
  execute: async () => { ... }
};

const grepSearchTool = {
  name: "search_codebase",
  description: "Find files containing specific search terms or functions.",
  execute: async ({ pattern }) => { ... }
};
```

---

### B. Store Additions (`store.ts`)
Add global states in [store.ts](file:///Users/suciuvictortraian/Development/axiom/src/store.ts):
```typescript
export interface WorkspaceState {
  globalContextSummary: string;
  setGlobalContextSummary: (summary: string) => void;
}
```

---

### C. Workspace Prompt Compilation
Update `executeNode` in [Workspace.tsx](file:///Users/suciuvictortraian/Development/axiom/src/components/Workspace.tsx):
- Retrieve `globalContextSummary`.
- Append it as architectural context inside the execution instructions payload.

```typescript
const systemPrompt = `
You are an AI coding agent executing a local refactoring task.

--- GLOBAL CONTEXT & ARCHITECTURE ---
${globalContextSummary}

--- LOCAL FILE CONTEXT ---
${fileContexts}

--- USER TASK INSTRUCTIONS ---
${instructions}
`;
```

---

### D. Global Chat Node UI & Canvas
1. **New Component**: Create `src/components/GlobalChatNode.tsx` rendering the explorer node card.
2. **Canvas Nodes Registration**: Register `globalChatNode` under `nodeTypes` in [CanvasTab.tsx](file:///Users/suciuvictortraian/Development/axiom/src/components/tabs/CanvasTab.tsx).
3. **Context Menu Action**: Add a context menu button to spawn the global node.

---

## 3. Verification Plan

### Automated Verification
- Run `npm run build` to verify clean typescript compilation.

### Manual Verification
- Spawn a `Global Explorer Node` on the canvas.
- Trigger exploration (e.g. *"Analyze code layout"*) and verify directory search.
- Check that the output summary is successfully injected into subsequent task runs.
