import type { WorkspaceSliceCreator } from "../sliceTypes";

export const createAgentSlice: WorkspaceSliceCreator = (set) => ({
  agentChats: {},
  agentStreams: {},
  agentPermissionRequests: {},

  createAgentTab: (title) => set((state) => {
    const tabId = `agent_${Date.now()}`;
    const name = title || `Agent ${Object.keys(state.agentChats || {}).length + 1}`;
    const editorGroups = state.editorGroups.map((group) => group.id === state.activeGroupId
      ? {
          ...group,
          openTabs: [...group.openTabs, { id: tabId, type: "agent" as const, title: name, key: tabId }],
          activeTabId: tabId,
        }
      : group);
    return { editorGroups, agentChats: { ...state.agentChats, [tabId]: [] } };
  }),

  addAgentMessage: (tabId, message) => set((state) => ({
    agentChats: { ...state.agentChats, [tabId]: [...(state.agentChats[tabId] || []), message] },
  })),

  updateAgentMessage: (tabId, messageId, content) => set((state) => ({
    agentChats: {
      ...state.agentChats,
      [tabId]: (state.agentChats[tabId] || []).map((message) =>
        message.id === messageId ? { ...message, content } : message,
      ),
    },
  })),

  setAgentMessages: (tabId, messages) => set((state) => ({
    agentChats: { ...state.agentChats, [tabId]: messages },
  })),

  clearAgentMessages: (tabId) => set((state) => ({
    agentChats: { ...state.agentChats, [tabId]: [] },
  })),

  updateAgentStream: (tabId, content) => set((state) => ({
    agentStreams: { ...state.agentStreams, [tabId]: content },
  })),

  clearAgentStream: (tabId) => set((state) => {
    const agentStreams = { ...state.agentStreams };
    delete agentStreams[tabId];
    return { agentStreams };
  }),

  addAgentPermissionRequest: (tabId, request) => set((state) => ({
    agentPermissionRequests: {
      ...state.agentPermissionRequests,
      [tabId]: [...(state.agentPermissionRequests[tabId] || []), request],
    },
  })),

  resolveAgentPermission: (tabId, requestId, approved) => set((state) => ({
    agentPermissionRequests: {
      ...state.agentPermissionRequests,
      [tabId]: (state.agentPermissionRequests[tabId] || []).map((request) =>
        request.id === requestId
          ? { ...request, status: approved ? "approved" as const : "denied" as const }
          : request,
      ),
    },
  })),
});
