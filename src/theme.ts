export type ThemeAppearance = "light" | "dark";

interface ThemeSeed {
  name: string;
  appearance: ThemeAppearance;
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
}

export interface ThemeStatusTokens {
  foreground: string;
  background: string;
  border: string;
  solid: string;
  solidForeground: string;
}

export interface AppTheme {
  id: string;
  name: string;
  appearance: ThemeAppearance;
  colors: {
    primary: string;
    primaryForeground: string;
    secondary: string;
    secondaryForeground: string;
    foreground: {
      default: string;
      muted: string;
      strong: string;
      inverse: string;
    };
  };
  workspace: {
    app: string;
    workspace: string;
    sidebar: string;
    header: string;
    panel: string;
    elevated: string;
    sunken: string;
    input: string;
    canvas: string;
    overlay: string;
  };
  borders: {
    default: string;
    subtle: string;
    strong: string;
    focus: string;
  };
  interaction: {
    hover: string;
    active: string;
    selected: string;
    focusRing: string;
    disabled: string;
  };
  status: {
    info: ThemeStatusTokens;
    success: ThemeStatusTokens;
    warning: ThemeStatusTokens;
    danger: ThemeStatusTokens;
  };
  editor: {
    background: string;
    foreground: string;
    lineNumber: string;
    lineNumberActive: string;
    lineHighlight: string;
    lineHighlightBorder: string;
    selection: string;
    inactiveSelection: string;
    selectionHighlight: string;
    cursor: string;
  };
  terminal: {
    background: string;
    foreground: string;
    cursor: string;
    selection: string;
  };
  logs: {
    background: string;
    surface: string;
    header: string;
    foreground: string;
    muted: string;
  };
  syntax: ThemeSeed["syntax"];
  diff: {
    addedBackground: string;
    addedTextBackground: string;
    addedGutter: string;
    removedBackground: string;
    removedTextBackground: string;
    removedGutter: string;
  };
}

const themeSeeds: Record<string, ThemeSeed> = {
  dark: {
    name: "Slate Dark",
    appearance: "dark",
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
    name: "Warm Sepia",
    appearance: "light",
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
    name: "One Dark Pro",
    appearance: "dark",
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
    name: "Sakura Blossom",
    appearance: "dark",
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
    name: "Space Dust",
    appearance: "dark",
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
    name: "GoldSrc",
    appearance: "dark",
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
    name: "One Monokai",
    appearance: "dark",
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
    name: "Andromeda",
    appearance: "dark",
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
    name: "Atom One Light",
    appearance: "light",
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
    name: "Noctis",
    appearance: "dark",
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
    name: "Panda Theme",
    appearance: "dark",
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
    name: "Ruby",
    appearance: "dark",
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
    name: "Bluloco Light",
    appearance: "light",
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

function hexChannels(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  const expanded = normalized.length === 3
    ? normalized.split("").map((part) => part + part).join("")
    : normalized.slice(0, 6);
  return [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16)) as [number, number, number];
}

function withAlpha(hex: string, alpha: number): string {
  const [red, green, blue] = hexChannels(hex);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/** Monaco theme colors only accept hex notation, including #RRGGBBAA for alpha. */
function withHexAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "").slice(0, 6);
  const alphaHex = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${normalized}${alphaHex}`;
}

function mixHex(base: string, mix: string, amount: number): string {
  const baseChannels = hexChannels(base);
  const mixChannels = hexChannels(mix);
  const channels = baseChannels.map((value, index) => Math.round(value + (mixChannels[index] - value) * amount));
  return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function relativeLuminance(color: string): number {
  const [red, green, blue] = hexChannels(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function contrastRatio(first: string, second: string): number {
  const brightest = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darkest = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (brightest + 0.05) / (darkest + 0.05);
}

function ensureContrast(foreground: string, background: string, minimum: number): string {
  if (contrastRatio(foreground, background) >= minimum) return foreground;
  const target = relativeLuminance(background) > 0.5 ? "#000000" : "#FFFFFF";
  for (let amount = 0.05; amount <= 1; amount += 0.05) {
    const candidate = mixHex(foreground, target, amount);
    if (contrastRatio(candidate, background) >= minimum) return candidate;
  }
  return target;
}

function readableForeground(background: string): string {
  const dark = "#111827";
  const light = "#FFFFFF";
  return contrastRatio(background, dark) >= contrastRatio(background, light) ? dark : light;
}

function statusTokens(foreground: string, appearance: ThemeAppearance): ThemeStatusTokens {
  const solid = appearance === "light" ? foreground : mixHex(foreground, "#000000", 0.45);
  return {
    foreground,
    background: withAlpha(foreground, appearance === "light" ? 0.1 : 0.16),
    border: withAlpha(foreground, appearance === "light" ? 0.28 : 0.38),
    solid,
    solidForeground: readableForeground(solid),
  };
}

function createTheme(id: string, seed: ThemeSeed): AppTheme {
  const appearance = seed.appearance;
  const isLight = appearance === "light";
  const status = isLight
    ? { info: "#0369A1", success: "#047857", warning: "#A15C00", danger: "#BE123C" }
    : { info: "#7DD3FC", success: "#6EE7B7", warning: "#FCD34D", danger: "#FDA4AF" };
  const logBackground = mixHex(seed.bgEditor, isLight ? "#000000" : "#FFFFFF", isLight ? 0.035 : 0.025);
  const mutedForeground = ensureContrast(seed.textMuted, seed.bgApp, 4.5);
  const syntax = {
    ...seed.syntax,
    comments: ensureContrast(seed.syntax.comments, seed.bgEditor, 3),
  };

  return {
    id,
    name: seed.name,
    appearance,
    colors: {
      primary: seed.accent,
      primaryForeground: readableForeground(seed.accent),
      secondary: syntax.types,
      secondaryForeground: readableForeground(syntax.types),
      foreground: {
        default: seed.textNormal,
        muted: mutedForeground,
        strong: seed.textLight,
        inverse: isLight ? "#FFFFFF" : "#111827",
      },
    },
    workspace: {
      app: seed.bgApp,
      workspace: seed.bgEditor,
      sidebar: seed.bgSidebar,
      header: seed.bgHeader,
      panel: seed.bgEditor,
      elevated: mixHex(seed.bgSidebar, isLight ? "#FFFFFF" : "#FFFFFF", isLight ? 0.45 : 0.035),
      sunken: mixHex(seed.bgSidebar, "#000000", isLight ? 0.04 : 0.12),
      input: seed.bgApp,
      canvas: seed.bgCanvas,
      overlay: "rgba(0, 0, 0, 0.55)",
    },
    borders: {
      default: seed.border,
      subtle: withAlpha(seed.border, 0.62),
      strong: seed.borderActive,
      focus: seed.accent,
    },
    interaction: {
      hover: withAlpha(seed.accent, isLight ? 0.09 : 0.12),
      active: withAlpha(seed.accent, isLight ? 0.15 : 0.2),
      selected: seed.accentBg,
      focusRing: withAlpha(seed.accent, 0.28),
      disabled: withAlpha(mutedForeground, 0.45),
    },
    status: {
      info: statusTokens(status.info, appearance),
      success: statusTokens(status.success, appearance),
      warning: statusTokens(status.warning, appearance),
      danger: statusTokens(status.danger, appearance),
    },
    editor: {
      background: seed.bgEditor,
      foreground: seed.textNormal,
      lineNumber: mutedForeground,
      lineNumberActive: seed.textLight,
      lineHighlight: mixHex(seed.bgEditor, seed.textNormal, isLight ? 0.045 : 0.065),
      lineHighlightBorder: "#00000000",
      selection: withAlpha(seed.textNormal, isLight ? 0.16 : 0.22),
      inactiveSelection: withAlpha(seed.textNormal, isLight ? 0.1 : 0.14),
      selectionHighlight: withAlpha(seed.textNormal, isLight ? 0.08 : 0.11),
      cursor: ensureContrast(
        mixHex(seed.bgEditor, seed.textNormal, isLight ? 0.55 : 0.48),
        seed.bgEditor,
        3,
      ),
    },
    terminal: {
      background: logBackground,
      foreground: seed.textNormal,
      cursor: seed.accent,
      selection: withAlpha(seed.accent, isLight ? 0.25 : 0.35),
    },
    logs: {
      background: logBackground,
      surface: mixHex(logBackground, isLight ? "#000000" : "#FFFFFF", isLight ? 0.025 : 0.025),
      header: mixHex(logBackground, isLight ? "#000000" : "#FFFFFF", isLight ? 0.05 : 0.04),
      foreground: seed.textNormal,
      muted: mutedForeground,
    },
    syntax,
    diff: isLight
      ? {
          addedBackground: withHexAlpha("#16A34A", 0.12),
          addedTextBackground: withHexAlpha("#16A34A", 0.2),
          addedGutter: withHexAlpha("#16A34A", 0.42),
          removedBackground: withHexAlpha("#DC2626", 0.1),
          removedTextBackground: withHexAlpha("#DC2626", 0.18),
          removedGutter: withHexAlpha("#DC2626", 0.4),
        }
      : {
          addedBackground: withHexAlpha("#1F9D55", 0.11),
          addedTextBackground: withHexAlpha("#1F9D55", 0.22),
          addedGutter: withHexAlpha("#1F9D55", 0.38),
          removedBackground: withHexAlpha("#E5484D", 0.11),
          removedTextBackground: withHexAlpha("#E5484D", 0.22),
          removedGutter: withHexAlpha("#E5484D", 0.38),
        },
  };
}

export const themes: Record<string, AppTheme> = Object.fromEntries(
  Object.entries(themeSeeds).map(([id, seed]) => [id, createTheme(id, seed)]),
);

export const themeOptions = Object.values(themes).map(({ id, name }) => ({ id, name }));
export const theme = themes.spaceDust;

export function resolveTheme(themeId: string): AppTheme {
  return themes[themeId] || themes.spaceDust;
}

const cssVariables = (themeDefinition: AppTheme): Record<string, string> => ({
  "--color-primary": themeDefinition.colors.primary,
  "--color-primary-foreground": themeDefinition.colors.primaryForeground,
  "--color-secondary": themeDefinition.colors.secondary,
  "--color-secondary-foreground": themeDefinition.colors.secondaryForeground,
  "--color-secondary-bg": withAlpha(themeDefinition.colors.secondary, themeDefinition.appearance === "light" ? 0.1 : 0.16),
  "--color-secondary-border": withAlpha(themeDefinition.colors.secondary, 0.35),
  "--color-fg-default": themeDefinition.colors.foreground.default,
  "--color-fg-muted": themeDefinition.colors.foreground.muted,
  "--color-fg-strong": themeDefinition.colors.foreground.strong,
  "--color-fg-inverse": themeDefinition.colors.foreground.inverse,
  "--color-surface-app": themeDefinition.workspace.app,
  "--color-surface-workspace": themeDefinition.workspace.workspace,
  "--color-surface-sidebar": themeDefinition.workspace.sidebar,
  "--color-surface-header": themeDefinition.workspace.header,
  "--color-surface-panel": themeDefinition.workspace.panel,
  "--color-surface-elevated": themeDefinition.workspace.elevated,
  "--color-surface-sunken": themeDefinition.workspace.sunken,
  "--color-surface-input": themeDefinition.workspace.input,
  "--color-surface-canvas": themeDefinition.workspace.canvas,
  "--color-surface-overlay": themeDefinition.workspace.overlay,
  "--color-border-default": themeDefinition.borders.default,
  "--color-border-subtle": themeDefinition.borders.subtle,
  "--color-border-strong": themeDefinition.borders.strong,
  "--color-border-focus": themeDefinition.borders.focus,
  "--color-interaction-hover": themeDefinition.interaction.hover,
  "--color-interaction-active": themeDefinition.interaction.active,
  "--color-interaction-selected": themeDefinition.interaction.selected,
  "--color-focus-ring": themeDefinition.interaction.focusRing,
  "--color-disabled": themeDefinition.interaction.disabled,
  "--color-log-background": themeDefinition.logs.background,
  "--color-log-surface": themeDefinition.logs.surface,
  "--color-log-header": themeDefinition.logs.header,
  "--color-log-foreground": themeDefinition.logs.foreground,
  "--color-log-muted": themeDefinition.logs.muted,
  "--color-editor-background": themeDefinition.editor.background,
  "--color-terminal-background": themeDefinition.terminal.background,
  "--color-status-info": themeDefinition.status.info.foreground,
  "--color-status-info-bg": themeDefinition.status.info.background,
  "--color-status-info-border": themeDefinition.status.info.border,
  "--color-status-info-solid": themeDefinition.status.info.solid,
  "--color-status-info-solid-foreground": themeDefinition.status.info.solidForeground,
  "--color-status-success": themeDefinition.status.success.foreground,
  "--color-status-success-bg": themeDefinition.status.success.background,
  "--color-status-success-border": themeDefinition.status.success.border,
  "--color-status-success-solid": themeDefinition.status.success.solid,
  "--color-status-success-solid-foreground": themeDefinition.status.success.solidForeground,
  "--color-status-warning": themeDefinition.status.warning.foreground,
  "--color-status-warning-bg": themeDefinition.status.warning.background,
  "--color-status-warning-border": themeDefinition.status.warning.border,
  "--color-status-warning-solid": themeDefinition.status.warning.solid,
  "--color-status-warning-solid-foreground": themeDefinition.status.warning.solidForeground,
  "--color-status-danger": themeDefinition.status.danger.foreground,
  "--color-status-danger-bg": themeDefinition.status.danger.background,
  "--color-status-danger-border": themeDefinition.status.danger.border,
  "--color-status-danger-solid": themeDefinition.status.danger.solid,
  "--color-status-danger-solid-foreground": themeDefinition.status.danger.solidForeground,
  "--syntax-comment": themeDefinition.syntax.comments,
  "--syntax-keyword": themeDefinition.syntax.keywords,
  "--syntax-string": themeDefinition.syntax.strings,
  "--syntax-number": themeDefinition.syntax.numbers,
  "--syntax-function": themeDefinition.syntax.functions,
  "--syntax-variable": themeDefinition.syntax.variables,
  "--syntax-type": themeDefinition.syntax.types,

  // Compatibility aliases while existing components move to semantic tokens.
  "--bg-app": themeDefinition.workspace.app,
  "--bg-sidebar": themeDefinition.workspace.sidebar,
  "--bg-header": themeDefinition.workspace.header,
  "--bg-editor": themeDefinition.editor.background,
  "--bg-canvas": themeDefinition.workspace.canvas,
  "--border-color": themeDefinition.borders.default,
  "--border-active": themeDefinition.borders.strong,
  "--text-normal": themeDefinition.colors.foreground.default,
  "--text-muted": themeDefinition.colors.foreground.muted,
  "--text-light": themeDefinition.colors.foreground.strong,
  "--text-color": themeDefinition.colors.foreground.strong,
  "--accent-color": themeDefinition.colors.primary,
  "--accent-bg": themeDefinition.interaction.selected,
});

/** Applies every CSS-consumable token and browser-level appearance hint. */
export function applyThemeProperties(themeDefinition: AppTheme) {
  const root = document.documentElement;
  Object.entries(cssVariables(themeDefinition)).forEach(([property, value]) => root.style.setProperty(property, value));
  root.dataset.theme = themeDefinition.id;
  root.dataset.appearance = themeDefinition.appearance;
  root.style.colorScheme = themeDefinition.appearance;

  const favicon = document.querySelector("link[rel='icon']");
  if (favicon) {
    favicon.setAttribute("href", themeDefinition.appearance === "light" ? "/axiom-light.png" : "/axiom-dark.png");
    favicon.setAttribute("type", "image/png");
  }
}

/** Registers the active application theme with Monaco. */
export function defineMonacoTheme(monaco: any, t: AppTheme) {
  monaco.editor.defineTheme("axiom-custom-theme", {
    base: t.appearance === "light" ? "vs" : "vs-dark",
    inherit: true,
    semanticHighlighting: true,
    rules: [
      { token: "", foreground: t.editor.foreground.replace("#", "") },
      { token: "comment", foreground: t.syntax.comments.replace("#", ""), fontStyle: "italic" },
      { token: "keyword", foreground: t.syntax.keywords.replace("#", "") },
      { token: "keyword.control", foreground: t.syntax.keywords.replace("#", "") },
      { token: "operator", foreground: t.syntax.keywords.replace("#", "") },
      { token: "string", foreground: t.syntax.strings.replace("#", "") },
      { token: "string.escape", foreground: t.syntax.numbers.replace("#", "") },
      { token: "number", foreground: t.syntax.numbers.replace("#", "") },
      { token: "regexp", foreground: t.syntax.strings.replace("#", "") },
      { token: "type", foreground: t.syntax.types.replace("#", "") },
      { token: "class", foreground: t.syntax.types.replace("#", "") },
      { token: "function", foreground: t.syntax.functions.replace("#", "") },
      { token: "function.declaration", foreground: t.syntax.functions.replace("#", "") },
      { token: "variable", foreground: t.syntax.variables.replace("#", "") },
      { token: "identifier", foreground: t.syntax.variables.replace("#", "") },
    ],
    colors: {
      "focusBorder": t.editor.lineHighlightBorder,
      "contrastActiveBorder": t.editor.lineHighlightBorder,
      "editor.background": t.editor.background,
      "editor.foreground": t.editor.foreground,
      "editorLineNumber.foreground": t.editor.lineNumber,
      "editorLineNumber.activeForeground": t.editor.lineNumberActive,
      "editor.lineHighlightBackground": t.editor.lineHighlight,
      "editor.lineHighlightBorder": t.editor.lineHighlightBorder,
      "editor.selectionBackground": t.editor.selection,
      "editor.inactiveSelectionBackground": t.editor.inactiveSelection,
      "editor.selectionHighlightBackground": t.editor.selectionHighlight,
      "editor.selectionHighlightBorder": t.editor.lineHighlightBorder,
      "editor.wordHighlightBorder": t.editor.lineHighlightBorder,
      "editor.wordHighlightStrongBorder": t.editor.lineHighlightBorder,
      "editor.rangeHighlightBorder": t.editor.lineHighlightBorder,
      "editorBracketMatch.border": t.editor.lineHighlightBorder,
      "editor.snippetTabstopHighlightBorder": t.editor.lineHighlightBorder,
      "editor.snippetFinalTabstopHighlightBorder": t.editor.lineHighlightBorder,
      "editorOverviewRuler.selectionHighlightForeground": t.editor.lineHighlightBorder,
      "editorCursor.foreground": t.editor.cursor,
      "diffEditor.insertedTextBackground": t.diff.addedTextBackground,
      "diffEditor.removedTextBackground": t.diff.removedTextBackground,
      "diffEditor.insertedLineBackground": t.diff.addedBackground,
      "diffEditor.removedLineBackground": t.diff.removedBackground,
      "diffEditorGutter.insertedLineBackground": t.diff.addedGutter,
      "diffEditorGutter.removedLineBackground": t.diff.removedGutter,
    },
  });
}
