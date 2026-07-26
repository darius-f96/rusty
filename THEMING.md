# Axiom theming

The application uses semantic theme tokens. Components describe the role of a
color (`surface`, `foreground`, `status`, `log`, or `editor`) instead of using a
palette color directly.

## Adding a theme

Add one entry to `themeSeeds` in `src/theme.ts`. A theme seed contains its name,
explicit light/dark appearance, workbench surfaces, foregrounds, accent, border,
and syntax palette. Axiom derives the complete `AppTheme` contract—including
primary/secondary colors, control states, status colors, logs, terminal, diff,
and accessible muted text—from that entry. The Settings list is generated from
the same registry.

## Using colors in a component

Prefer the semantic variables:

- `--color-primary` and `--color-secondary` for product emphasis.
- `--color-fg-default`, `--color-fg-muted`, and `--color-fg-strong` for text.
- `--color-surface-*` for the app, workspace, panels, inputs, and overlays.
- `--color-border-*` and `--color-interaction-*` for component states.
- `--color-status-{info,success,warning,danger}*` for statuses and actions.
- `--color-log-*`, `--color-terminal-background`, and `--syntax-*` for code-like UI.

The older `--bg-*`, `--text-*`, and `--accent-*` variables are compatibility
aliases and should not be used by new code. They remain temporarily for
unmigrated components and are isolated in the compatibility section of
`src/theme.ts`.

## Component styling

Component appearance belongs in a colocated CSS Module. Tailwind remains
available for straightforward layout while migration is in progress, but new
palette-specific colors and large arbitrary presentation strings are not
allowed. Runtime-calculated geometry—such as editor height, canvas position, or
resizing width—may remain inline.

## Typography

Typography preferences are independent of themes and are persisted under
`axiom_typography_preferences`. The root runtime exposes these roles:

- `--font-size-ide` and `--font-size-ui-*` for application chrome.
- `--font-size-chat` and `--font-size-chat-*` for chat and Markdown.
- A numeric editor size passed through `src/editor/monacoOptions.ts` for Monaco.

Use `.ide-typography-scope` at the application shell and
`.chat-typography-scope` around chat surfaces. Xterm buffer text and
user-authored React Flow node text intentionally remain independent.

Run `npm run theme:check` and `npm run build` after changing UI colors. Fixed
brand artwork and user-selectable sticky-note colors are intentional exceptions.
