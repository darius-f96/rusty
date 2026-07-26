import { create } from "zustand";
import { createAgentSlice } from "./store/slices/createAgentSlice";
import { createCanvasSlice } from "./store/slices/createCanvasSlice";
import { createEditorSlice } from "./store/slices/createEditorSlice";
import { createGitSlice } from "./store/slices/createGitSlice";
import { createIntegrationSlice } from "./store/slices/createIntegrationSlice";
import { createPreferencesSlice } from "./store/slices/createPreferencesSlice";
import { createTerminalSlice } from "./store/slices/createTerminalSlice";
import { createWorkspaceSlice } from "./store/slices/createWorkspaceSlice";
import type { WorkspaceState } from "./store/types";

export * from "./store/types";

export const useWorkspaceStore = create<WorkspaceState>()((...args) => ({
  ...createWorkspaceSlice(...args),
  ...createGitSlice(...args),
  ...createTerminalSlice(...args),
  ...createEditorSlice(...args),
  ...createCanvasSlice(...args),
  ...createAgentSlice(...args),
  ...createIntegrationSlice(...args),
  ...createPreferencesSlice(...args),
}) as WorkspaceState);
