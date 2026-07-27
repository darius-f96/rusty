import { useEffect } from "react";
import { loader } from "@monaco-editor/react";
import { useWorkspaceStore } from "../store";
import { applyThemeProperties, defineMonacoTheme, resolveTheme } from "../theme";
import { MonacoLspBinding } from "../services/monacoLspBinding";

/** Keeps CSS and non-CSS renderers synchronized with the persisted theme id. */
export function ThemeRuntime() {
  const activeThemeId = useWorkspaceStore((state) => state.activeThemeId);

  useEffect(() => {
    const theme = resolveTheme(activeThemeId);
    applyThemeProperties(theme);

    loader.init().then((monaco) => {
      defineMonacoTheme(monaco, theme);
      monaco.editor.setTheme("axiom-custom-theme");
      // No real LSP is attached yet (LSP_EDITOR_ENABLED is off), so Monaco's
      // built-in TS worker would otherwise flag false-positive module/JSX
      // errors with no awareness of this project's actual tsconfig.
      MonacoLspBinding.disableBuiltInTsDiagnostics(monaco);
    }).catch((error) => {
      console.warn("Failed to propagate theme to Monaco:", error);
    });
  }, [activeThemeId]);

  return null;
}
