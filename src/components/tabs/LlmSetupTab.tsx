import React, { useState, useEffect } from "react";
import { useWorkspaceStore, CustomProvider } from "../../store";
import { Cpu, Key, Globe, Plus, ShieldCheck, Save, Layers, Lock, Unlock, HelpCircle as HelpIcon, RefreshCw, GitBranch } from "lucide-react";
import { CustomSelect } from "../CustomSelect";
import { notify } from "../../notificationStore";

export const LlmSetupTab: React.FC = () => {
  const customProviders = useWorkspaceStore((state) => state.customProviders);
  const activeCustomProviderId = useWorkspaceStore((state) => state.activeCustomProviderId);
  const activeModel = useWorkspaceStore((state) => state.activeModel);
  const setActiveCustomProviderId = useWorkspaceStore((state) => state.setActiveCustomProviderId);
  const setActiveModel = useWorkspaceStore((state) => state.setActiveModel);
  const updateProviderSettings = useWorkspaceStore((state) => state.updateProviderSettings);
  const addCustomProvider = useWorkspaceStore((state) => state.addCustomProvider);

  // Selected provider configuration state
  const selectedProvider = customProviders.find((p) => p.id === activeCustomProviderId);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);

  // Sync inputs with selected provider
  useEffect(() => {
    if (selectedProvider) {
      setApiKey(selectedProvider.apiKey || "");
      setBaseUrl(selectedProvider.baseUrl || "");
    }
  }, [activeCustomProviderId, selectedProvider]);

  // Automatically select the first model as default if activeModel is empty
  useEffect(() => {
    if (!activeModel && selectedProvider && selectedProvider.models.length > 0) {
      setActiveModel(selectedProvider.models[0].id);
    }
  }, [activeModel, selectedProvider, setActiveModel]);

  // Save Settings
  const handleSaveSettings = async () => {
    if (!activeCustomProviderId) return;
    updateProviderSettings(activeCustomProviderId, {
      apiKey: apiKey.trim(),
      baseUrl: baseUrl.trim(),
    });
    
    // Automatically fetch models on save if key is present
    if (apiKey.trim()) {
      setFetchingModels(true);
      console.log(`[LlmSetup] Auto-fetching models for ${selectedProvider?.name} on save...`);
      try {
        const proxyUrl = "http://localhost:4000/proxy/models";
        const targetUrl = activeCustomProviderId === "opencode" 
          ? (baseUrl.trim() || "https://opencode.ai/zen/v1") 
          : activeCustomProviderId === "github-copilot"
          ? "https://models.github.ai/catalog"
          : baseUrl.trim() || selectedProvider?.baseUrl || "";

        const res = await fetch(proxyUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            baseUrl: targetUrl,
            apiKey: apiKey.trim()
          })
        });
        
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.data)) {
            const mapped = data.data.map((m: any) => {
              const prefix = activeCustomProviderId + "/";
              const modelId = m.id || m.name || "";
              const id = modelId.startsWith(prefix) ? modelId : `${prefix}${modelId}`;
              return {
                id,
                name: m.friendly_name || m.display_name || modelId.split("/").pop() || modelId
              };
            });
            if (mapped.length > 0) {
              updateProviderSettings(activeCustomProviderId, { models: mapped });
              setActiveModel(mapped[0].id);
              notify("Saved", `Configuration saved successfully! Auto-loaded ${mapped.length} models for ${selectedProvider?.name}.`, "success");
              return;
            }
          }
        }
        notify("Saved", `Configuration saved for ${selectedProvider?.name}! (Model fetching failed, please double check connection details)`, "info");
      } catch (err) {
        console.error("Auto-fetch error:", err);
        notify("Saved with error", `Configuration saved for ${selectedProvider?.name}, but model auto-fetch encountered an error.`, "error");
      } finally {
        setFetchingModels(false);
      }
    } else {
      notify("Updated", `Connection settings updated for ${selectedProvider?.name}!`, "success");
    }
  };

  const handleFetchModels = async () => {
    if (!activeCustomProviderId) return;
    if (!apiKey) {
      notify("API key required", "Please provide an API Authorization Key first.", "info");
      return;
    }

    setFetchingModels(true);
    console.log(`[LlmSetup] Fetching models for ${selectedProvider?.name}...`);
    console.log(`[LlmSetup] API Key provided: ${apiKey.substring(0, 10)}...`);
    
    try {
      const proxyUrl = "http://localhost:4000/proxy/models";
      const targetUrl = activeCustomProviderId === "opencode" 
        ? (baseUrl.trim() || "https://opencode.ai/zen/v1") 
        : activeCustomProviderId === "github-copilot"
        ? "https://models.github.ai/catalog"
        : baseUrl.trim() || selectedProvider?.baseUrl || "";
      
      const res = await fetch(proxyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          baseUrl: targetUrl,
          apiKey: apiKey.trim()
        })
      });
      
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP error ${res.status}`);
      }
      
      const data = await res.json();
      
      if (data && Array.isArray(data.data)) {
        const mapped = data.data.map((m: any) => {
          const prefix = activeCustomProviderId + "/";
          const modelId = m.id || m.name || "";
          const id = modelId.startsWith(prefix) ? modelId : `${prefix}${modelId}`;
          return {
            id,
            name: m.friendly_name || m.display_name || modelId.split("/").pop() || modelId
          };
        });
        
        if (mapped.length > 0) {
          updateProviderSettings(activeCustomProviderId, { models: mapped });
          setActiveModel(mapped[0].id);
          notify("Models loaded", `Successfully fetched and loaded ${mapped.length} models for ${selectedProvider?.name}!`, "success");
        } else {
          notify("No models", "No models found in the provider response.", "info");
        }
      } else {
        throw new Error("Invalid response format.");
      }
    } catch (err: any) {
      console.error(`[LlmSetup] Fetch models error:`, err.message);
      notify("Fetch failed", `Failed to fetch models: ${err.message}`, "error");
    } finally {
      setFetchingModels(false);
    }
  };

  // Add Custom Provider Form State
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [provId, setProvId] = useState("");
  const [provName, setProvName] = useState("");
  const [provUrl, setProvUrl] = useState("http://localhost:11434/v1");
  const [provModels, setProvModels] = useState("qwen2.5-coder:7b");

  const handleAddNewProvider = (e: React.FormEvent) => {
    e.preventDefault();
    if (!provId || !provName) return;

    const providerId = provId.trim().toLowerCase();
    const modelsList = provModels.split(",").map((m) => {
      const modelName = m.trim();
      const id = modelName.includes("/") ? modelName : `${providerId}/${modelName}`;
      return { id, name: modelName.split("/").pop() || modelName };
    });

    const newProvider: CustomProvider = {
      id: provId.trim().toLowerCase(),
      name: provName.trim(),
      baseUrl: provUrl.trim(),
      apiKey: "",
      apiType: "openai-completions",
      models: modelsList,
    };

    addCustomProvider(newProvider);
    setActiveCustomProviderId(newProvider.id);
    if (modelsList.length > 0) {
      setActiveModel(modelsList[0].id);
    }
    
    notify("Provider added", `LLM Provider ${provName} registered successfully!`, "success");
    setProvId("");
    setProvName("");
    setShowAddCustom(false);
  };

  // Check integration helper text and placeholder keys
  const getProviderHelpText = (id: string) => {
    switch (id) {
      case "openai":
        return "Connects directly to OpenAI's completion servers. If API Key is left blank, it falls back to the OPENAI_API_KEY environment variable defined in the agent sidecar startup environment.";
      case "anthropic":
        return "Connects directly to Anthropic's Claude API. If API Key is left blank, it falls back to the ANTHROPIC_API_KEY environment variable defined in the agent sidecar startup environment.";
      case "opencode":
        return "Connects to OpenCode Zen/Go models using your developer API token. The base URL defaults to https://opencode.ai/zen/go/v1. Find your API Key in your OpenCode account dashboard.";
      case "github-copilot":
        return "Connects to GitHub Models via the official OpenAI-compatible inference API. Requires a GitHub Personal Access Token (PAT) with the 'models:read' scope. Generate one at GitHub → Settings → Developer settings → Personal access tokens. You can click 'Fetch Models' after saving to load the full GitHub Models catalog.";
      default:
        return "Custom OpenAI-compatible provider (e.g. Ollama, LM Studio, vLLM, or LiteLLM gateway). Configure the URL and models as needed.";
    }
  };

  return (
    <div className="w-full h-full p-8 max-w-5xl mx-auto flex flex-col space-y-6 font-sans text-[var(--text-normal)] overflow-y-auto">
      {/* Title */}
      <div className="flex flex-col space-y-1">
        <h2 className="text-2xl font-bold text-[var(--text-light)] flex items-center space-x-2">
          <Cpu className="text-[var(--accent-color)]" size={24} />
          <span>LLM Connection Center</span>
        </h2>
        <p className="text-xs text-[var(--text-muted)] font-mono">
          Manage API credentials, target models, and local inference server endpoints.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-8">
        {/* Left Side: Providers Selection list & registration */}
        <div className="md:col-span-2 space-y-4">
          <div className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl p-4 space-y-3">
            <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">
              Integrations
            </h3>
            
            <div className="space-y-2">
              {customProviders.map((p) => {
                const isActive = p.id === activeCustomProviderId;
                
                // Connection indicator status text & color
                let statusLabel = "Env Fallback";
                let statusColor = "bg-amber-500/80";
                if (p.apiKey) {
                  statusLabel = "Configured";
                  statusColor = "bg-emerald-500";
                } else if (p.id !== "openai" && p.id !== "anthropic") {
                  statusLabel = "Key Required";
                  statusColor = "bg-rose-500/80";
                }

                const isGithubCopilot = p.id === "github-copilot";

                return (
                  <div
                    key={p.id}
                    onClick={() => {
                      setActiveCustomProviderId(p.id);
                      if (p.models.length > 0) {
                        setActiveModel(p.models[0].id);
                      }
                    }}
                    className={`group flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                      isActive
                        ? "border-[var(--accent-color)] bg-[var(--accent-bg)]/20 shadow-[0_0_10px_rgba(139,92,246,0.1)]"
                        : "border-[var(--border-color)] bg-[var(--bg-app)]/50 hover:bg-[var(--bg-sidebar)] hover:border-[var(--border-active)]"
                    }`}
                  >
                    <div className="flex flex-col min-w-0 pr-2">
                      <span className="text-xs font-bold text-[var(--text-light)] group-hover:text-[var(--accent-color)] transition-colors flex items-center space-x-1.5">
                        {isGithubCopilot && <GitBranch size={11} className="text-[var(--text-muted)] flex-shrink-0" />}
                        <span>{p.name}</span>
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)] font-mono truncate mt-0.5 max-w-[180px]">
                        {p.baseUrl || "Built-in API endpoint"}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2 flex-shrink-0">
                      <span className={`text-[8px] font-bold text-white px-1.5 py-0.5 rounded-full ${statusColor}`}>
                        {statusLabel}
                      </span>
                      {isActive && <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent-color)] animate-pulse" />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Create Custom Provider Drawer button */}
          {!showAddCustom ? (
            <button
              onClick={() => setShowAddCustom(true)}
              className="w-full border border-dashed border-[var(--border-color)] hover:border-[var(--accent-color)] hover:bg-[var(--accent-bg)]/5 text-xs text-[var(--text-muted)] hover:text-[var(--text-light)] font-mono font-semibold py-3 rounded-xl transition-all flex items-center justify-center space-x-1.5 cursor-pointer"
            >
              <Plus size={14} className="text-[var(--accent-color)]" />
              <span>Register Custom LLM / Local Host</span>
            </button>
          ) : (
            <form
              onSubmit={handleAddNewProvider}
              className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl p-4 space-y-3 font-sans"
            >
              <div className="flex items-center justify-between border-b border-[var(--border-color)]/30 pb-2">
                <span className="text-xs font-bold text-[var(--text-light)] font-mono">New Custom Provider</span>
                <button
                  type="button"
                  onClick={() => setShowAddCustom(false)}
                  className="text-rose-400 hover:text-rose-300 text-[10px] font-mono cursor-pointer"
                >
                  Cancel
                </button>
              </div>

              <div className="space-y-2 text-xs">
                <div className="space-y-1">
                  <label className="block text-[9px] uppercase font-bold text-[var(--text-muted)] font-mono">Provider ID</label>
                  <input
                    type="text"
                    placeholder="e.g. ollama, custom-api"
                    value={provId}
                    onChange={(e) => setProvId(e.target.value)}
                    className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg p-2 text-xs font-mono text-[var(--text-light)] focus:outline-none focus:border-[var(--border-active)]"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[9px] uppercase font-bold text-[var(--text-muted)] font-mono">Display Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Local Ollama Runner"
                    value={provName}
                    onChange={(e) => setProvName(e.target.value)}
                    className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg p-2 text-xs text-[var(--text-light)] focus:outline-none focus:border-[var(--border-active)]"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[9px] uppercase font-bold text-[var(--text-muted)] font-mono">Base API URL</label>
                  <input
                    type="text"
                    placeholder="e.g. http://localhost:11434/v1"
                    value={provUrl}
                    onChange={(e) => setProvUrl(e.target.value)}
                    className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg p-2 text-xs font-mono text-[var(--text-light)] focus:outline-none focus:border-[var(--border-active)]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[9px] uppercase font-bold text-[var(--text-muted)] font-mono">Models (Comma-separated)</label>
                  <input
                    type="text"
                    placeholder="qwen2.5-coder:7b, llama3.3:70b"
                    value={provModels}
                    onChange={(e) => setProvModels(e.target.value)}
                    className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg p-2 text-xs font-mono text-[var(--text-light)] focus:outline-none focus:border-[var(--border-active)]"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/85 text-white font-mono font-bold py-2 rounded-lg text-xs transition-all shadow-md cursor-pointer flex items-center justify-center space-x-1.5"
                >
                  <Plus size={13} />
                  <span>Register Provider</span>
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Right Side: Active Provider configuration settings editor */}
        <div className="md:col-span-3">
          {selectedProvider ? (
            <div className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-2xl p-6 space-y-6">
              {/* Card Header */}
              <div className="flex items-center justify-between border-b border-[var(--border-color)]/30 pb-4">
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] font-mono tracking-wider">
                    Provider Configuration
                  </span>
                  <span className="text-lg font-bold text-[var(--text-light)]">
                    {selectedProvider.name} Settings
                  </span>
                </div>
                
                <div className="flex items-center space-x-1 bg-[var(--bg-app)] border border-[var(--border-color)] rounded-full px-3 py-1 font-mono text-[10px] text-[var(--text-muted)]">
                  <span>ID:</span>
                  <span className="font-bold text-[var(--text-light)]">{selectedProvider.id}</span>
                </div>
              </div>

              {/* Settings Form */}
              <div className="space-y-4 text-xs">
                {/* 1. API Key Input */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="block text-xs font-bold text-[var(--text-normal)] uppercase font-mono tracking-wide flex items-center space-x-1.5">
                      <Key size={13} className="text-violet-400" />
                      <span>API Authorization Key</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors cursor-pointer flex items-center space-x-1 font-mono"
                    >
                      {showKey ? (
                        <>
                          <Lock size={10} />
                          <span>Hide</span>
                        </>
                      ) : (
                        <>
                          <Unlock size={10} />
                          <span>Show</span>
                        </>
                      )}
                    </button>
                  </div>
                  
                  <input
                    type={showKey ? "text" : "password"}
                    placeholder={
                      selectedProvider.id === "openai" || selectedProvider.id === "anthropic"
                        ? "Enter key (falls back to process.env if left empty)"
                        : selectedProvider.id === "github-copilot"
                        ? "GitHub PAT with models:read scope (ghp_... or github_pat_...)"
                        : "Enter your API Key / Auth Token"
                    }
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--text-light)] font-mono focus:outline-none focus:border-[var(--border-active)] placeholder-[var(--text-muted)]/70 shadow-inner"
                  />
                  
                  {(selectedProvider.id === "openai" || selectedProvider.id === "anthropic") && !apiKey && (
                    <span className="text-[10px] text-[var(--text-muted)] leading-relaxed italic block mt-1 font-mono">
                      ℹ Environment Variable configuration will be active for this provider since no custom key is provided.
                    </span>
                  )}
                  {selectedProvider.id === "github-copilot" && !apiKey && (
                    <span className="text-[10px] text-amber-400/80 leading-relaxed italic block mt-1 font-mono flex items-center space-x-1">
                      <GitBranch size={10} className="flex-shrink-0" />
                      <span>A GitHub PAT with <strong>models:read</strong> scope is required. Generate one at GitHub → Settings → Developer settings → Personal access tokens.</span>
                    </span>
                  )}
                </div>

                {/* 2. Base URL Input */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-[var(--text-normal)] uppercase font-mono tracking-wide flex items-center space-x-1.5">
                    <Globe size={13} className="text-violet-400" />
                    <span>Connection Base URL</span>
                  </label>
                  
                  <input
                    type="text"
                    placeholder="e.g. https://api.openai.com/v1"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    disabled={selectedProvider.id === "openai" || selectedProvider.id === "anthropic"}
                    className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--text-light)] font-mono focus:outline-none focus:border-[var(--border-active)] placeholder-[var(--text-muted)]/70 disabled:opacity-50 disabled:cursor-not-allowed shadow-inner"
                  />

                  {selectedProvider.id === "github-copilot" && (
                    <span className="text-[10px] text-[var(--text-muted)] leading-relaxed italic block mt-1 font-mono">
                      GitHub Models inference endpoint. You can change this if using a custom proxy or organizational endpoint.
                    </span>
                  )}

                  {(selectedProvider.id === "openai" || selectedProvider.id === "anthropic") && (
                    <span className="text-[10px] text-[var(--text-muted)] leading-relaxed italic block mt-1 font-mono">
                      Note: The default connection endpoint cannot be edited for native built-in cloud providers.
                    </span>
                  )}
                </div>

                {/* 3. Default Target Model Dropdown */}
                <div className="space-y-2 pt-2">
                  <label className="block text-xs font-bold text-[var(--text-normal)] uppercase font-mono tracking-wide flex items-center space-x-1.5">
                    <Layers size={13} className="text-violet-400" />
                    <span>Default Target Model</span>
                  </label>
                  <CustomSelect
                    value={activeModel}
                    onChange={(val) => setActiveModel(val)}
                    options={
                      selectedProvider.models.length > 0
                        ? selectedProvider.models.map((m) => ({ id: m.id, name: `${m.name} (${m.id})` }))
                        : []
                    }
                    placeholder="No models available - Save configuration to fetch models"
                  />
                </div>

                {/* Save and Fetch buttons */}
                <div className="pt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-t border-[var(--border-color)]/30">
                  <div className="flex items-center space-x-1.5 text-[10px] font-mono text-[var(--text-muted)]">
                    <ShieldCheck size={14} className="text-emerald-400" />
                    <span>Active: {activeModel}</span>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={handleFetchModels}
                      disabled={fetchingModels}
                      className="border border-[var(--border-color)] hover:border-[var(--accent-color)] bg-[var(--bg-app)] hover:bg-[var(--accent-bg)]/10 text-[var(--text-normal)] hover:text-[var(--text-light)] font-mono font-bold px-4 py-2.5 rounded-xl transition-all cursor-pointer flex items-center space-x-1.5 disabled:opacity-50"
                      title="Fetch models from the provider's /models endpoint"
                    >
                      <RefreshCw size={13} className={fetchingModels ? "animate-spin text-[var(--accent-color)]" : ""} />
                      <span>{fetchingModels ? "Fetching..." : "Fetch Models"}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleSaveSettings}
                      className="bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/85 text-white font-mono font-bold px-4 py-2.5 rounded-xl transition-all shadow-lg hover:shadow-[var(--accent-color)]/20 cursor-pointer flex items-center space-x-1.5"
                    >
                      <Save size={13} />
                      <span>Save Configuration</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Informative Guidance Card */}
              <div className="bg-[var(--bg-app)] border border-[var(--border-color)] rounded-xl p-4.5 flex items-start space-x-3.5">
                <HelpIcon size={18} className="text-[var(--accent-color)] flex-shrink-0 mt-0.5" />
                <div className="flex flex-col space-y-1">
                  <span className="text-xs font-bold text-[var(--text-light)]">Integration Guide</span>
                  <p className="text-[11px] text-[var(--text-muted)] leading-relaxed font-sans">
                    {getProviderHelpText(selectedProvider.id)}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-2xl p-8 text-center flex flex-col items-center justify-center min-h-[300px]">
              <Cpu size={40} className="text-[var(--text-muted)] opacity-30 mb-3" />
              <span className="text-sm font-bold text-[var(--text-light)] font-mono">No Active Provider Selected</span>
              <p className="text-xs text-[var(--text-muted)] max-w-sm mt-1">
                Select an LLM Integration provider from the sidebar menu to edit credentials, URLs, and customize models.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
