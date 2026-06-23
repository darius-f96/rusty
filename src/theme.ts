export const theme = {
  // Application Layout Colors
  bgApp: "#282c34",         // Primary app layout background (One Dark Editor Bg)
  bgSidebar: "#21252b",     // Sidebar background
  bgHeader: "#1e2227",      // Top tab bar background
  bgEditor: "#282c34",      // Monaco editor background
  border: "#181a1f",        // Borders & separators
  borderActive: "#61afef",  // Active state outline/borders (One Dark Blue)
  accent: "#61afef",        // Brand colors (One Dark Blue)
  accentBg: "rgba(97, 175, 239, 0.15)", // Hover selection background
  
  // Font Colors
  textNormal: "#abb2bf",    // Normal content text
  textMuted: "#5c6370",     // Muted text (comments)
  textLight: "#ffffff",     // Bright header text

  // Monaco Editor Code Syntax Highlighting Tokens
  syntax: {
    comments: "#5c6370",    // Grey comments
    keywords: "#c678dd",    // Purple keywords
    strings: "#98c379",     // Emerald green strings
    numbers: "#d19a66",     // Peach/orange numbers
    functions: "#61afef",   // Light blue functions
    variables: "#abb2bf",   // Normal variable text
    types: "#e5c07b",       // Gold/yellow types & classes
  }
};
export type AppTheme = typeof theme;
