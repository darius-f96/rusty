import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { themes } from "./theme";
import { useWorkspaceStore } from "./store";
import "./index.css";

// Dynamic CSS Variables injection
const activeThemeId = useWorkspaceStore.getState().activeThemeId;
const activeTheme = themes[activeThemeId] || themes.dark;
const root = document.documentElement;
root.style.setProperty("--bg-app", activeTheme.bgApp);
root.style.setProperty("--bg-sidebar", activeTheme.bgSidebar);
root.style.setProperty("--bg-header", activeTheme.bgHeader);
root.style.setProperty("--bg-editor", activeTheme.bgEditor);
root.style.setProperty("--bg-canvas", activeTheme.bgCanvas);
root.style.setProperty("--border-color", activeTheme.border);
root.style.setProperty("--border-active", activeTheme.borderActive);
root.style.setProperty("--text-normal", activeTheme.textNormal);
root.style.setProperty("--text-muted", activeTheme.textMuted);
root.style.setProperty("--text-light", activeTheme.textLight);
root.style.setProperty("--accent-color", activeTheme.accent);
root.style.setProperty("--accent-bg", activeTheme.accentBg);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
