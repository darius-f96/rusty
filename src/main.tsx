import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ThemeRuntime } from "./components/ThemeRuntime";
import { applyThemeProperties, resolveTheme } from "./theme";
import { useWorkspaceStore } from "./store";
import "./index.css";

const activeThemeId = useWorkspaceStore.getState().activeThemeId;
applyThemeProperties(resolveTheme(activeThemeId));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeRuntime />
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
