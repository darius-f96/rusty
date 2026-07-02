import React, { useEffect, useState } from "react";
import { useWorkspaceStore } from "../../store";
import { CustomSelect } from "../CustomSelect";
import {
  detectAllLspServers,
  installLspServer,
  DetectResult,
  InstallProgress,
} from "../../services/lspAdminService";

type InstallState = {
  status: "idle" | "installing" | "installed" | "error";
  message?: string;
};

export const SettingsTab: React.FC = () => {
  const activeThemeId = useWorkspaceStore((state) => state.activeThemeId);
  const setActiveThemeId = useWorkspaceStore((state) => state.setActiveThemeId);

  const lspSettings = useWorkspaceStore((state) => state.lspSettings);
  const updateLspSettings = useWorkspaceStore((state) => state.updateLspSettings);

  const [detectResults, setDetectResults] = useState<Record<string, DetectResult>>({});
  const [detecting, setDetecting] = useState(false);
  const [installStates, setInstallStates] = useState<Record<string, InstallState>>({});

  useEffect(() => {
    let cancelled = false;
    setDetecting(true);
    detectAllLspServers()
      .then((results) => {
        if (cancelled) return;
        const map: Record<string, DetectResult> = {};
        for (const r of results) map[r.language] = r;
        setDetectResults(map);
      })
      .catch((err) => console.warn("[SettingsTab] detect-all failed:", err))
      .finally(() => {
        if (!cancelled) setDetecting(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleInstall = async (langKey: string) => {
    setInstallStates((prev) => ({
      ...prev,
      [langKey]: { status: "installing", message: "Starting..." },
    }));
    try {
      const result = await installLspServer(langKey, (progress: InstallProgress) => {
        setInstallStates((prev) => ({
          ...prev,
          [langKey]: { status: "installing", message: progress.message },
        }));
      });
      if (result.error) {
        setInstallStates((prev) => ({
          ...prev,
          [langKey]: { status: "error", message: result.error },
        }));
        return;
      }
      // Persist the resolved serverPath into config.
      if (result.serverPath) {
        const current = lspSettings.servers?.[langKey] || { serverPath: "", args: [] };
        updateLspSettings({
          servers: {
            ...lspSettings.servers,
            [langKey]: { ...current, serverPath: result.serverPath },
          },
        });
      }
      setInstallStates((prev) => ({
        ...prev,
        [langKey]: { status: "installed", message: `Installed v${result.version || ""}`.trim() },
      }));
      setDetectResults((prev) => ({
        ...prev,
        [langKey]: { language: langKey, detected: true, serverPath: result.serverPath },
      }));
    } catch (err: any) {
      setInstallStates((prev) => ({
        ...prev,
        [langKey]: { status: "error", message: err?.message || "Install failed" },
      }));
    }
  };

  const themeOptions = [
    { id: "dark", name: "Slate Dark" },
    { id: "sepia", name: "Warm Sepia" },
    { id: "oneDark", name: "One Dark Pro" },
    { id: "sakura", name: "Sakura Blossom" },
    { id: "spaceDust", name: "Space Dust" },
    { id: "goldsrc", name: "GoldSrc" },
    { id: "oneMonokai", name: "One Monokai" },
    { id: "andromeda", name: "Andromeda" },
    { id: "atomOneLight", name: "Atom One Light" },
    { id: "noctis", name: "Noctis" },
    { id: "panda", name: "Panda Theme" },
    { id: "ruby", name: "Ruby" },
    { id: "blulocoLight", name: "Bluloco Light" },
  ];

  const handleServerPathChange = (lang: string, val: string) => {
    updateLspSettings({
      servers: {
        ...lspSettings.servers,
        [lang]: {
          ...lspSettings.servers[lang],
          serverPath: val,
        }
      }
    });
  };

  const handleServerArgsChange = (lang: string, val: string) => {
    updateLspSettings({
      servers: {
        ...lspSettings.servers,
        [lang]: {
          ...lspSettings.servers[lang],
          args: val.split(" ").filter(Boolean),
        }
      }
    });
  };

  const languages = [
    { key: "typescript", label: "TypeScript / JavaScript" },
    { key: "python", label: "Python" },
    { key: "go", label: "Go" },
    { key: "rust", label: "Rust" },
    { key: "java", label: "Java" },
    { key: "c", label: "C" },
    { key: "cpp", label: "C++" },
    { key: "csharp", label: "C#" },
    { key: "ruby", label: "Ruby" },
    { key: "php", label: "PHP" },
    { key: "lua", label: "Lua" },
    { key: "bash", label: "Bash / Shell" },
    { key: "json", label: "JSON" },
    { key: "yaml", label: "YAML" },
    { key: "html", label: "HTML" },
    { key: "css", label: "CSS" },
  ];

  return (
    <div className="w-full h-full overflow-y-auto">
      <div className="p-8 max-w-2xl mx-auto space-y-6 font-sans text-[var(--text-normal)]">
        {/* Title */}
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-[var(--text-light)]">General Settings</h2>
          <p className="text-xs text-[var(--text-muted)] font-mono">Configure system preferences and path properties</p>
        </div>

        {/* System Preferences Card */}
        <div className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">Appearance Theme</label>
            <CustomSelect
              value={activeThemeId}
              onChange={setActiveThemeId}
              options={themeOptions}
            />
          </div>
        </div>

        {/* LSP Server Configuration Card */}
        <div className="space-y-1 pt-4">
          <h2 className="text-xl font-bold text-[var(--text-light)]">LSP Language Intelligence</h2>
          <p className="text-xs text-[var(--text-muted)] font-mono">Manage compiler checking, autocomplete, and symbol lookup paths</p>
        </div>

        <div className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl p-5 space-y-5">
          {/* Enable Toggle */}
          <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-4">
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-[var(--text-light)] font-mono">ENABLE LANGUAGE SERVERS</span>
              <p className="text-[10px] text-[var(--text-muted)]">Run background language servers to analyze workspace code</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer select-none">
              <input
                type="checkbox"
                checked={lspSettings.enabled}
                onChange={(e) => updateLspSettings({ enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-[var(--bg-app)] border border-[var(--border-color)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-[var(--text-muted)] after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--accent-color)] peer-checked:after:bg-white peer-checked:after:border-transparent"></div>
            </label>
          </div>

          {/* Server Configurations list */}
          {lspSettings.enabled && (
            <div className="space-y-4">
              {languages.map((lang) => {
                const server = lspSettings.servers?.[lang.key] || { serverPath: "", args: [] };
                const detect = detectResults[lang.key];
                const detected = detect?.detected;
                const installState = installStates[lang.key];
                const isInstalling = installState?.status === "installing";
                return (
                  <div key={lang.key} className="space-y-2 border-b border-[var(--border-color)]/40 pb-4 last:border-0 last:pb-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            detecting
                              ? "bg-[var(--text-muted)] animate-pulse"
                              : detected
                                ? "bg-emerald-500"
                                : "bg-rose-500"
                          }`}
                          title={
                            detecting
                              ? "Detecting..."
                              : detected
                                ? `Detected: ${detect?.serverPath || "on PATH"}`
                                : "Not detected — click Install to download"
                          }
                        />
                        <span className="text-xs font-bold text-[var(--text-light)] font-mono uppercase tracking-wider">
                          {lang.label}
                        </span>
                      </div>
                      <button
                        onClick={() => handleInstall(lang.key)}
                        disabled={isInstalling}
                        className={`text-[9px] font-mono font-bold px-2 py-1 rounded border transition-all ${
                          isInstalling
                            ? "bg-[var(--bg-app)] border-[var(--border-color)] text-[var(--text-muted)] cursor-wait"
                            : installState?.status === "installed"
                              ? "bg-emerald-900/40 border-emerald-700/50 text-emerald-300 hover:bg-emerald-900/60"
                              : installState?.status === "error"
                                ? "bg-rose-900/40 border-rose-700/50 text-rose-300 hover:bg-rose-900/60"
                                : "bg-[var(--bg-app)] border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-light)] hover:border-[var(--border-active)] cursor-pointer"
                        }`}
                        title={installState?.message || (detected ? "Reinstall" : "Download & install")}
                      >
                        {isInstalling
                          ? "Installing..."
                          : detected
                            ? "Reinstall"
                            : "Install"}
                      </button>
                    </div>
                    {installState?.message && (
                      <div className={`text-[10px] font-mono ${
                        installState.status === "error"
                          ? "text-rose-400"
                          : installState.status === "installed"
                            ? "text-emerald-400"
                            : "text-[var(--text-muted)]"
                      }`}>
                        {installState.message}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="block text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">Server Binary / Command</label>
                        <input
                          type="text"
                          value={server.serverPath}
                          onChange={(e) => handleServerPathChange(lang.key, e.target.value)}
                          className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg px-2.5 py-1.5 font-mono text-[11px] text-[var(--text-light)] focus:outline-none focus:border-[var(--accent-color)]"
                          placeholder={`${lang.key}-language-server`}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="block text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">Arguments (Space-separated)</label>
                        <input
                          type="text"
                          value={(server.args || []).join(" ")}
                          onChange={(e) => handleServerArgsChange(lang.key, e.target.value)}
                          className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg px-2.5 py-1.5 font-mono text-[11px] text-[var(--text-light)] focus:outline-none focus:border-[var(--accent-color)]"
                          placeholder="--stdio"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

