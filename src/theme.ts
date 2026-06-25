export const theme = {
  // Application Layout Colors
  bgApp: "#0A0B0D",         // Primary app layout background (Very dark slate-black)
  bgSidebar: "#121316",     // Sidebar background (Dark charcoal card)
  bgHeader: "#0F1012",      // Top tab bar background (Darker slate-gray)
  bgEditor: "#17181C",      // Monaco editor background (Medium charcoal card)
  bgCanvas: "#1F2026",      // Flow canvas background (Slightly lighter slate-gray)
  border: "#202126",        // Borders & separators
  borderActive: "#00E5FF",  // Active state outline/borders (Glowing cyan/teal)
  accent: "#00E5FF",        // Brand colors (Glowing cyan/teal)
  accentBg: "rgba(0, 229, 255, 0.10)", // Hover selection background
  
  // Font Colors
  textNormal: "#A9ADC1",    // Normal content text (Slightly warmer gray)
  textMuted: "#6E7382",     // Muted text (Slate gray)
  textLight: "#F4F5F6",     // Bright header text

  // Monaco Editor Code Syntax Highlighting Tokens (matching picture)
  syntax: {
    comments: "#5F646D",    // Muted slate gray
    keywords: "#C678DD",    // Purple/pink for import, const, let, return, etc.
    strings: "#E28C6E",     // Salmon/amber for strings
    numbers: "#A573F6",     // Aurora purple for numbers
    functions: "#3CD6A3",   // Mint green for functions/React components
    variables: "#79C0FF",   // Light blue/cyan for variables (matching picture)
    types: "#4FA5E2",       // Light blue for types
  }
};
export type AppTheme = typeof theme;

