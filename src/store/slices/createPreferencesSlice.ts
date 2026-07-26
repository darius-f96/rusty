import {
  loadTypographyPreferences,
  saveTypographyPreferences,
  TYPOGRAPHY_DEFAULTS,
  type TypographyPreferences,
} from "../../preferences/typography";
import {
  loadKeyboardShortcuts,
  saveKeyboardShortcuts,
  SHORTCUT_DEFAULTS,
  type ShortcutAction,
} from "../../preferences/shortcuts";
import type { WorkspaceSliceCreator } from "../sliceTypes";

export const createPreferencesSlice: WorkspaceSliceCreator = (set) => ({
  typographyPreferences: loadTypographyPreferences(),
  setTypographyPreference: (key: keyof TypographyPreferences, value: number) => set((state) => ({
    typographyPreferences: saveTypographyPreferences({
      ...state.typographyPreferences,
      [key]: value,
    }),
  })),
  resetTypographyPreferences: () => set({
    typographyPreferences: saveTypographyPreferences({ ...TYPOGRAPHY_DEFAULTS }),
  }),

  keyboardShortcuts: loadKeyboardShortcuts(),
  setKeyboardShortcut: (action: ShortcutAction, shortcut: string) => set((state) => ({
    keyboardShortcuts: saveKeyboardShortcuts({
      ...state.keyboardShortcuts,
      [action]: shortcut,
    }),
  })),
  resetKeyboardShortcuts: () => set({
    keyboardShortcuts: saveKeyboardShortcuts({ ...SHORTCUT_DEFAULTS }),
  }),
});
