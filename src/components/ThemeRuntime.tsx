import { useEffect } from "react";
import { loader } from "@monaco-editor/react";
import { useWorkspaceStore } from "../store";
import { applyThemeProperties, defineMonacoTheme, resolveTheme } from "../theme";

/** Keeps CSS and non-CSS renderers synchronized with the persisted theme id. */
export function ThemeRuntime() {
  const activeThemeId = useWorkspaceStore((state) => state.activeThemeId);

  useEffect(() => {
    const theme = resolveTheme(activeThemeId);
    applyThemeProperties(theme);

    loader.init().then((monaco) => {
      defineMonacoTheme(monaco, theme);
      monaco.editor.setTheme("axiom-custom-theme");
    }).catch((error) => {
      console.warn("Failed to propagate theme to Monaco:", error);
    });
  }, [activeThemeId]);

  return null;
}
