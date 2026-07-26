import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ThemeRuntime } from "./components/ThemeRuntime";
import { TypographyRuntime } from "./components/runtime/TypographyRuntime";
import { applyThemeProperties, resolveTheme } from "./theme";
import { applyTypographyProperties } from "./preferences/typography";
import { useWorkspaceStore } from "./store";
import "./index.css";

const activeThemeId = useWorkspaceStore.getState().activeThemeId;
applyThemeProperties(resolveTheme(activeThemeId));
applyTypographyProperties(useWorkspaceStore.getState().typographyPreferences);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeRuntime />
      <TypographyRuntime />
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
