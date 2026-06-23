import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { theme } from "./theme";
import "./index.css";

// Dynamic CSS Variables injection
const root = document.documentElement;
root.style.setProperty("--bg-app", theme.bgApp);
root.style.setProperty("--bg-sidebar", theme.bgSidebar);
root.style.setProperty("--bg-header", theme.bgHeader);
root.style.setProperty("--bg-editor", theme.bgEditor);
root.style.setProperty("--border-color", theme.border);
root.style.setProperty("--border-active", theme.borderActive);
root.style.setProperty("--text-normal", theme.textNormal);
root.style.setProperty("--text-muted", theme.textMuted);
root.style.setProperty("--text-light", theme.textLight);
root.style.setProperty("--accent-color", theme.accent);
root.style.setProperty("--accent-bg", theme.accentBg);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
