export interface AppTheme {
  bgApp: string;
  bgSidebar: string;
  bgHeader: string;
  bgEditor: string;
  bgCanvas: string;
  border: string;
  borderActive: string;
  accent: string;
  accentBg: string;
  textNormal: string;
  textMuted: string;
  textLight: string;
  syntax: {
    comments: string;
    keywords: string;
    strings: string;
    numbers: string;
    functions: string;
    variables: string;
    types: string;
  };
  isLight?: boolean;
}

export const themes: Record<string, AppTheme> = {
  dark: {
    bgApp: "#0A0B0D",
    bgSidebar: "#121316",
    bgHeader: "#0F1012",
    bgEditor: "#17181C",
    bgCanvas: "#1F2026",
    border: "#202126",
    borderActive: "#00E5FF",
    accent: "#00E5FF",
    accentBg: "rgba(0, 229, 255, 0.10)",
    textNormal: "#A9ADC1",
    textMuted: "#6E7382",
    textLight: "#F4F5F6",
    syntax: {
      comments: "#5F646D",
      keywords: "#C678DD",
      strings: "#E28C6E",
      numbers: "#A573F6",
      functions: "#3CD6A3",
      variables: "#79C0FF",
      types: "#4FA5E2"
    }
  },
  sepia: {
    isLight: true,
    bgApp: "#F4ECD8",
    bgSidebar: "#EADFB4",
    bgHeader: "#E5D9AC",
    bgEditor: "#FDF6E3",
    bgCanvas: "#EADFB4",
    border: "#D3C6A2",
    borderActive: "#B58900",
    accent: "#B58900",
    accentBg: "rgba(181, 137, 0, 0.10)",
    textNormal: "#586E75",
    textMuted: "#93A1A1",
    textLight: "#073642",
    syntax: {
      comments: "#93A1A1",
      keywords: "#859900",
      strings: "#2AA198",
      numbers: "#D33682",
      functions: "#268BD2",
      variables: "#CB4B16",
      types: "#B58900"
    }
  },
  oneDark: {
    bgApp: "#181A1F",
    bgSidebar: "#21252B",
    bgHeader: "#1E2227",
    bgEditor: "#282C34",
    bgCanvas: "#21252B",
    border: "#181A1F",
    borderActive: "#61AFEF",
    accent: "#61AFEF",
    accentBg: "rgba(97, 175, 239, 0.10)",
    textNormal: "#ABB2BF",
    textMuted: "#5C6370",
    textLight: "#FFFFFF",
    syntax: {
      comments: "#5C6370",
      keywords: "#C678DD",
      strings: "#98C379",
      numbers: "#D19A66",
      functions: "#61AFEF",
      variables: "#E06C75",
      types: "#E5C07B"
    }
  },
  sakura: {
    bgApp: "#1D141C",
    bgSidebar: "#231B22",
    bgHeader: "#1A1119",
    bgEditor: "#2B202A",
    bgCanvas: "#231B22",
    border: "#150D14",
    borderActive: "#FF79C6",
    accent: "#FF79C6",
    accentBg: "rgba(255, 121, 198, 0.10)",
    textNormal: "#E2D9E0",
    textMuted: "#6C5969",
    textLight: "#FFFFFF",
    syntax: {
      comments: "#6C5969",
      keywords: "#D162B1",
      strings: "#8BC399",
      numbers: "#F1B57A",
      functions: "#59B1E6",
      variables: "#F27A9C",
      types: "#E1AF7B"
    }
  },
  spaceDust: {
    bgApp: "#061217",
    bgSidebar: "#0F242C",
    bgHeader: "#040E12",
    bgEditor: "#0A1C23",
    bgCanvas: "#0F242C",
    border: "#03090C",
    borderActive: "#E17B34",
    accent: "#E17B34",
    accentBg: "rgba(225, 123, 52, 0.10)",
    textNormal: "#96C5D0",
    textMuted: "#4E6E75",
    textLight: "#FFFFFF",
    syntax: {
      comments: "#4E6E75",
      keywords: "#EC5F67",
      strings: "#EAD170",
      numbers: "#4DB5BD",
      functions: "#57C7FF",
      variables: "#F99157",
      types: "#A1C659"
    }
  },
  goldsrc: {
    bgApp: "#1f241b",
    bgSidebar: "#424c3b",
    bgHeader: "#2f362a",
    bgEditor: "#1f241b",
    bgCanvas: "#2f362a",
    border: "#364130",
    borderActive: "#85917d",
    accent: "#b9c900",
    accentBg: "rgba(185, 201, 0, 0.15)",
    textNormal: "#d4d4d4",
    textMuted: "#686868",
    textLight: "#ffffff",
    syntax: {
      comments: "#686868",
      keywords: "#88a176",
      strings: "#fbaa10",
      numbers: "#e4c342",
      functions: "#b9c900",
      variables: "#eaffc6",
      types: "#50ff00"
    }
  }
};

export const theme = themes.dark; // Fallback

/** Injects theme colors into CSS custom properties on document root */
export function applyThemeProperties(t: AppTheme) {
  const root = document.documentElement;
  root.style.setProperty("--bg-app", t.bgApp);
  root.style.setProperty("--bg-sidebar", t.bgSidebar);
  root.style.setProperty("--bg-header", t.bgHeader);
  root.style.setProperty("--bg-editor", t.bgEditor);
  root.style.setProperty("--bg-canvas", t.bgCanvas);
  root.style.setProperty("--border-color", t.border);
  root.style.setProperty("--border-active", t.borderActive);
  root.style.setProperty("--text-normal", t.textNormal);
  root.style.setProperty("--text-muted", t.textMuted);
  root.style.setProperty("--text-light", t.textLight);
  root.style.setProperty("--accent-color", t.accent);
  root.style.setProperty("--accent-bg", t.accentBg);

  // Update application favicon based on theme brightness
  const favicon = document.querySelector("link[rel='icon']");
  if (favicon) {
    favicon.setAttribute("href", t.isLight ? "/axiom-light.png" : "/axiom-dark.png");
    favicon.setAttribute("type", "image/png");
  }
}


/** Registers theme configuration with monaco editor runtime */
export function defineMonacoTheme(monaco: any, t: AppTheme) {
  monaco.editor.defineTheme("axiom-custom-theme", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: t.textNormal.replace("#", "") },
      { token: "comment", foreground: t.syntax.comments.replace("#", ""), fontStyle: "italic" },
      { token: "keyword", foreground: t.syntax.keywords.replace("#", "") },
      { token: "string", foreground: t.syntax.strings.replace("#", "") },
      { token: "number", foreground: t.syntax.numbers.replace("#", "") },
      { token: "regexp", foreground: t.syntax.strings.replace("#", "") },
      { token: "type", foreground: t.syntax.types.replace("#", "") },
      { token: "class", foreground: t.syntax.types.replace("#", "") },
      { token: "function", foreground: t.syntax.functions.replace("#", "") },
      { token: "variable", foreground: t.syntax.variables.replace("#", "") },
    ],
    colors: {
      "editor.background": t.bgEditor,
      "editor.foreground": t.textNormal,
      "editorLineNumber.foreground": t.textMuted,
      "editorLineNumber.activeForeground": t.textLight,
      "editor.lineHighlightBackground": t.bgSidebar + "33",
      "editor.selectionBackground": t.accent + "44",
      "editorCursor.foreground": t.accent,
    },
  });
}
