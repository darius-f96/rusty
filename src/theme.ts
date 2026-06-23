export const theme = {
  // Application Layout Colors
  bgApp: "#2e3440",         // Primary app layout background (Nord Polar Night nord0)
  bgSidebar: "#242933",     // Sidebar background (Nord Darker nord1/nord2 variant)
  bgHeader: "#242933",      // Top tab bar background
  bgEditor: "#2e3440",      // Monaco editor background (Nord Editor Bg)
  border: "#3b4252",        // Borders & separators (Nord nord1)
  borderActive: "#88c0d0",  // Active state outline/borders (Nord Frost nord8)
  accent: "#88c0d0",        // Brand colors (Nord Frost nord8)
  accentBg: "rgba(136, 192, 208, 0.15)", // Hover selection background
  
  // Font Colors
  textNormal: "#d8dee9",    // Normal content text (Nord Snow Storm nord4)
  textMuted: "#4c566a",     // Muted text (Nord polar night grey nord3)
  textLight: "#eceff4",     // Bright header text (Nord Snow Storm nord6)

  // Monaco Editor Code Syntax Highlighting Tokens
  syntax: {
    comments: "#4c566a",    // Nord polar night grey (nord3)
    keywords: "#81a1c1",    // Nord frost blue (nord9)
    strings: "#a3be8c",     // Nord aurora green (nord14)
    numbers: "#b48ead",     // Nord aurora purple (nord15)
    functions: "#88c0d0",   // Nord frost cyan (nord8)
    variables: "#d8dee9",   // Nord snow storm (nord4)
    types: "#8fbcbb",       // Nord frost teal (nord7)
  }
};
export type AppTheme = typeof theme;
