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
  },
  oneMonokai: {
    bgApp: "#1E2024",
    bgSidebar: "#282C34",
    bgHeader: "#21252B",
    bgEditor: "#282C34",
    bgCanvas: "#21252B",
    border: "#1E2024",
    borderActive: "#98C379",
    accent: "#E06C75",
    accentBg: "rgba(224, 108, 117, 0.15)",
    textNormal: "#ABB2BF",
    textMuted: "#5C6370",
    textLight: "#FFFFFF",
    syntax: {
      comments: "#5C6370",
      keywords: "#F92672",
      strings: "#E6DB74",
      numbers: "#AE81FF",
      functions: "#66D9EF",
      variables: "#F8F8F2",
      types: "#A6E22E"
    }
  },
  andromeda: {
    bgApp: "#1B1D23",
    bgSidebar: "#23262E",
    bgHeader: "#1E2127",
    bgEditor: "#262A33",
    bgCanvas: "#23262E",
    border: "#1B1D23",
    borderActive: "#00E8C6",
    accent: "#00E8C6",
    accentBg: "rgba(0, 232, 198, 0.15)",
    textNormal: "#D7DAE0",
    textMuted: "#6A7285",
    textLight: "#FFFFFF",
    syntax: {
      comments: "#6A7285",
      keywords: "#C74DED",
      strings: "#96E072",
      numbers: "#F39C12",
      functions: "#00E8C6",
      variables: "#E06C75",
      types: "#FFE66D"
    }
  },
  atomOneLight: {
    isLight: true,
    bgApp: "#F9F9F9",
    bgSidebar: "#F0F0F0",
    bgHeader: "#EAEAEA",
    bgEditor: "#FAFAFA",
    bgCanvas: "#F0F0F0",
    border: "#E5E5E5",
    borderActive: "#4078F2",
    accent: "#4078F2",
    accentBg: "rgba(64, 120, 242, 0.10)",
    textNormal: "#383A42",
    textMuted: "#A0A1A7",
    textLight: "#000000",
    syntax: {
      comments: "#A0A1A7",
      keywords: "#A626A4",
      strings: "#50A14F",
      numbers: "#986801",
      functions: "#4078F2",
      variables: "#E45649",
      types: "#C18401"
    }
  },
  noctis: {
    bgApp: "#161B22",
    bgSidebar: "#1B222C",
    bgHeader: "#131820",
    bgEditor: "#212B3B",
    bgCanvas: "#1B222C",
    border: "#11161E",
    borderActive: "#FFB454",
    accent: "#FFB454",
    accentBg: "rgba(255, 180, 84, 0.15)",
    textNormal: "#C5D4DD",
    textMuted: "#627D98",
    textLight: "#FFFFFF",
    syntax: {
      comments: "#627D98",
      keywords: "#FF7E79",
      strings: "#6CE0AD",
      numbers: "#FFD166",
      functions: "#4CC3FF",
      variables: "#DFEAF0",
      types: "#FFB454"
    }
  },
  panda: {
    bgApp: "#242526",
    bgSidebar: "#292A2B",
    bgHeader: "#1F2021",
    bgEditor: "#2E2F30",
    bgCanvas: "#292A2B",
    border: "#1E1F20",
    borderActive: "#FF75B5",
    accent: "#FF75B5",
    accentBg: "rgba(255, 117, 181, 0.15)",
    textNormal: "#E6E6E6",
    textMuted: "#676B6E",
    textLight: "#FFFFFF",
    syntax: {
      comments: "#676B6E",
      keywords: "#FF75B5",
      strings: "#19F9D8",
      numbers: "#FFB86C",
      functions: "#45A9F9",
      variables: "#E6E6E6",
      types: "#B084EB"
    }
  },
  ruby: {
    bgApp: "#1A0A0E",
    bgSidebar: "#261016",
    bgHeader: "#1F0B10",
    bgEditor: "#2D141C",
    bgCanvas: "#261016",
    border: "#150508",
    borderActive: "#E0115F",
    accent: "#E0115F",
    accentBg: "rgba(224, 17, 95, 0.15)",
    textNormal: "#F5E1E6",
    textMuted: "#8A606D",
    textLight: "#FFFFFF",
    syntax: {
      comments: "#8A606D",
      keywords: "#E0115F",
      strings: "#D4AF37",
      numbers: "#FF758F",
      functions: "#FF4D6D",
      variables: "#FFEBF0",
      types: "#F72585"
    }
  },
  blulocoLight: {
    isLight: true,
    bgApp: "#F4F6F9",
    bgSidebar: "#EAEFF5",
    bgHeader: "#E2E8F0",
    bgEditor: "#F9FAFC",
    bgCanvas: "#EAEFF5",
    border: "#D1DBE5",
    borderActive: "#0062E6",
    accent: "#0062E6",
    accentBg: "rgba(0, 98, 230, 0.10)",
    textNormal: "#2A3F55",
    textMuted: "#7E90A3",
    textLight: "#1A202C",
    syntax: {
      comments: "#7E90A3",
      keywords: "#C2185B",
      strings: "#2E7D32",
      numbers: "#B06000",
      functions: "#0062E6",
      variables: "#2D3748",
      types: "#6200EE"
    }
  }
};

export const theme = themes.spaceDust; // Fallback

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
