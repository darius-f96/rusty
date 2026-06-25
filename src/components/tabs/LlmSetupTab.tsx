import React, { useState } from "react";
import { useWorkspaceStore, CustomProvider } from "../../store";

export const LlmSetupTab: React.FC = () => {
  const customProviders = useWorkspaceStore((state) => state.customProviders);
  const activeCustomProviderId = useWorkspaceStore((state) => state.activeCustomProviderId);
  const activeModel = useWorkspaceStore((state) => state.activeModel);
  const setActiveCustomProviderId = useWorkspaceStore((state) => state.setActiveCustomProviderId);
  const setActiveModel = useWorkspaceStore((state) => state.setActiveModel);

  const [provId, setProvId] = useState("");
  const [provName, setProvName] = useState("");
  const [provUrl, setProvUrl] = useState("http://localhost:11434/v1");
  const [provModels, setProvModels] = useState("qwen2.5-coder:7b");

  const handleAddNewProvider = (e: React.FormEvent) => {
    e.preventDefault();
    if (!provId || !provName) return;

    const modelsList = provModels.split(",").map((m) => {
      const id = m.trim();
      return { id, name: id.split("/").pop() || id };
    });

    const newProvider: CustomProvider = {
      id: provId,
      name: provName,
      baseUrl: provUrl,
      apiKey: "",
      apiType: "openai-completions",
      models: modelsList,
    };

    useWorkspaceStore.getState().addCustomProvider(newProvider);
    alert(`LLM Provider ${provName} registered successfully!`);
    setProvId("");
    setProvName("");
  };

  return (
    <div className="p-8 max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8 font-sans text-[var(--text-normal)]">
      {/* List / Config Panel */}
      <div className="space-y-5">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-[var(--text-light)]">LLM Configuration</h2>
          <p className="text-xs text-[var(--text-muted)] font-mono">Select active providers and models for task nodes</p>
        </div>

        <div className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl p-5 space-y-4">
          <div className="space-y-2">
            <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">Choose Provider</label>
            <div className="grid grid-cols-1 gap-2">
              {customProviders.map((p) => {
                const isActive = p.id === activeCustomProviderId;
                return (
                  <div
                    key={p.id}
                    onClick={() => {
                      setActiveCustomProviderId(p.id);
                      if (p.models.length > 0) {
                        setActiveModel(p.models[0].id);
                      }
                    }}
                    className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                      isActive
                        ? "border-[var(--accent-color)] bg-[var(--accent-bg)]"
                        : "border-[var(--border-color)] bg-[var(--bg-app)] hover:border-[var(--border-active)]"
                    }`}
                  >
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-[var(--text-light)]">{p.name}</span>
                      <span className="text-[10px] text-[var(--text-muted)] font-mono">{p.baseUrl || "Built-in integration"}</span>
                    </div>
                    {isActive && <span className="w-2 h-2 rounded-full bg-[var(--accent-color)] shadow-sm" />}
                  </div>
                );
              })}
            </div>
          </div>

          {activeCustomProviderId && (
            <div className="space-y-2 pt-2">
              <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">Choose Model</label>
              <select
                value={activeModel}
                onChange={(e) => setActiveModel(e.target.value)}
                className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg p-2.5 text-xs text-[var(--text-light)] font-mono focus:outline-none focus:border-[var(--border-active)] cursor-pointer"
              >
                {customProviders
                  .find((p) => p.id === activeCustomProviderId)
                  ?.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.id})
                    </option>
                  ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Register Panel */}
      <div className="space-y-5">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-[var(--text-light)]">Add Custom LLM</h2>
          <p className="text-xs text-[var(--text-muted)] font-mono">Register custom local (Ollama) or OpenAI compatible endpoints</p>
        </div>

        <form onSubmit={handleAddNewProvider} className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="block text-[10px] uppercase font-bold tracking-wider text-[var(--text-muted)] font-mono">Provider ID</label>
            <input
              type="text"
              placeholder="e.g. ollama, openrouter"
              value={provId}
              onChange={(e) => setProvId(e.target.value)}
              className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg p-2 text-xs font-mono text-[var(--text-light)] focus:outline-none focus:border-[var(--border-active)]"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-[10px] uppercase font-bold tracking-wider text-[var(--text-muted)] font-mono">Provider Name</label>
            <input
              type="text"
              placeholder="e.g. Local Ollama"
              value={provName}
              onChange={(e) => setProvName(e.target.value)}
              className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg p-2 text-xs font-mono text-[var(--text-light)] focus:outline-none focus:border-[var(--border-active)]"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-[10px] uppercase font-bold tracking-wider text-[var(--text-muted)] font-mono">API Base URL</label>
            <input
              type="text"
              placeholder="e.g. http://localhost:11434/v1"
              value={provUrl}
              onChange={(e) => setProvUrl(e.target.value)}
              className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg p-2 text-xs font-mono text-[var(--text-light)] focus:outline-none focus:border-[var(--border-active)]"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-[10px] uppercase font-bold tracking-wider text-[var(--text-muted)] font-mono">Models (Comma-separated)</label>
            <input
              type="text"
              placeholder="e.g. qwen2.5-coder:7b, llama3.1"
              value={provModels}
              onChange={(e) => setProvModels(e.target.value)}
              className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg p-2 text-xs font-mono text-[var(--text-light)] focus:outline-none focus:border-[var(--border-active)]"
            />
          </div>

          <button
            type="submit"
            className="w-full bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/80 text-white font-mono font-bold py-2 rounded-lg text-xs transition-all shadow-md cursor-pointer flex items-center justify-center"
          >
            Register Provider
          </button>
        </form>
      </div>
    </div>
  );
};
