import React from "react";
import { useWorkspaceStore } from "../../store";

export const SettingsTab: React.FC = () => {
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const activeCustomProviderId = useWorkspaceStore((state) => state.activeCustomProviderId);
  const activeModel = useWorkspaceStore((state) => state.activeModel);
  const activeThemeId = useWorkspaceStore((state) => state.activeThemeId);
  const setActiveThemeId = useWorkspaceStore((state) => state.setActiveThemeId);

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6 font-sans text-[var(--text-normal)]">
      <div className="space-y-1">
        <h2 className="text-xl font-bold text-[var(--text-light)]">General Settings</h2>
        <p className="text-xs text-[var(--text-muted)] font-mono">Configure system preferences and path properties</p>
      </div>

      <div className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl p-5 space-y-4">
        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">Appearance Theme</label>
          <select
            value={activeThemeId}
            onChange={(e) => setActiveThemeId(e.target.value)}
            className="bg-[var(--bg-app)] text-[var(--text-normal)] border border-[var(--border-color)] rounded-lg px-3 py-2 outline-none text-xs w-full focus:border-[var(--border-active)] cursor-pointer"
          >
            <option value="dark">Slate Dark</option>
            <option value="sepia">Warm Sepia</option>
            <option value="oneDark">One Dark Pro</option>
            <option value="sakura">Sakura Blossom</option>
            <option value="spaceDust">Space Dust</option>
          </select>
        </div>

        <div className="space-y-1.5 pt-2">
          <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">Workspace Directory</label>
          <div className="bg-[var(--bg-app)] border border-[var(--border-color)] px-3 py-2 rounded-lg font-mono text-xs text-[var(--text-light)] select-text break-all">
            {rootPath || "No workspace folder selected"}
          </div>
        </div>

        <div className="space-y-1.5 pt-2">
          <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">Active LLM Provider</label>
          <div className="bg-[var(--bg-app)] border border-[var(--border-color)] px-3 py-2 rounded-lg font-mono text-xs text-[var(--text-light)]">
            {activeCustomProviderId || "None"}
          </div>
        </div>

        <div className="space-y-1.5 pt-2">
          <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">Active Target Model</label>
          <div className="bg-[var(--bg-app)] border border-[var(--border-color)] px-3 py-2 rounded-lg font-mono text-xs text-[var(--text-light)]">
            {activeModel || "None"}
          </div>
        </div>
      </div>
    </div>
  );
};
