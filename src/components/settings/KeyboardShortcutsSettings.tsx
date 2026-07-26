import { useState } from "react";
import {
  formatShortcut,
  shortcutFromKeyboardEvent,
  SHORTCUT_DEFAULTS,
  type ShortcutAction,
} from "../../preferences/shortcuts";
import { useWorkspaceStore } from "../../store";
import { Button } from "../ui";
import styles from "./KeyboardShortcutsSettings.module.css";

const shortcuts: Array<{ action: ShortcutAction; label: string; description: string; id: string }> = [
  {
    action: "closeActiveTab",
    label: "Close active tab",
    description: "Closes the selected editor tab.",
    id: "shortcut-close-active-tab",
  },
  {
    action: "openSearch",
    label: "Open search",
    description: "Opens the workspace search palette.",
    id: "shortcut-open-search",
  },
  {
    action: "toggleExplorer",
    label: "Toggle explorer",
    description: "Shows or collapses the file explorer.",
    id: "shortcut-toggle-explorer",
  },
];

const protectedShortcuts = new Set([
  "Mod+R",
  "Mod+U",
  "Mod+Shift+I",
  "Mod+Shift+J",
  "Mod+Shift+C",
  "Mod+Alt+I",
]);

export function KeyboardShortcutsSettings() {
  const preferences = useWorkspaceStore((state) => state.keyboardShortcuts);
  const setShortcut = useWorkspaceStore((state) => state.setKeyboardShortcut);
  const reset = useWorkspaceStore((state) => state.resetKeyboardShortcuts);
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recordShortcut = (action: ShortcutAction, event: React.KeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setRecording(null);
      setError(null);
      return;
    }

    const shortcut = shortcutFromKeyboardEvent(event);
    if (!shortcut) return;
    if (!shortcut.includes("+")) {
      setError("Include Command/Ctrl, Option/Alt, or Shift.");
      return;
    }
    if (protectedShortcuts.has(shortcut)) {
      setError("That shortcut is reserved by the application.");
      return;
    }

    const conflict = shortcuts.find(({ action: candidate }) =>
      candidate !== action && preferences[candidate] === shortcut
    );
    if (conflict) {
      setError(`Already used by “${conflict.label}”.`);
      return;
    }

    setShortcut(action, shortcut);
    setRecording(null);
    setError(null);
  };

  return (
    <section className={styles.section} aria-labelledby="keyboard-shortcuts-title">
      <div className={styles.heading}>
        <div>
          <h3 className={styles.title} id="keyboard-shortcuts-title">Keyboard shortcuts</h3>
          <p className={styles.description}>Select a shortcut, then press the new key combination.</p>
        </div>
        <Button id="shortcuts-reset-all" variant="ghost" onClick={reset}>Reset all</Button>
      </div>
      <div className={styles.list}>
        {shortcuts.map(({ action, label, description, id }) => (
          <div className={styles.row} key={action}>
            <div>
              <label className={styles.label} htmlFor={id}>{label}</label>
              <p className={styles.description}>{description}</p>
            </div>
            <div className={styles.actions}>
              <button
                id={id}
                type="button"
                className={`${styles.recorder} ${recording === action ? styles.recording : ""}`}
                onClick={() => {
                  setRecording(action);
                  setError(null);
                }}
                onBlur={() => setRecording((current) => current === action ? null : current)}
                onKeyDown={(event) => recording === action && recordShortcut(action, event)}
                data-shortcut-recorder
                aria-describedby={recording === action && error ? "shortcut-recording-error" : undefined}
              >
                {recording === action ? "Press shortcut…" : formatShortcut(preferences[action])}
              </button>
              {preferences[action] !== SHORTCUT_DEFAULTS[action] && (
                <button
                  id={`${id}-reset`}
                  type="button"
                  className={styles.reset}
                  onClick={() => setShortcut(action, SHORTCUT_DEFAULTS[action])}
                  aria-label={`Reset ${label}`}
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {error && <p className={styles.error} id="shortcut-recording-error" role="alert">{error}</p>}
    </section>
  );
}
