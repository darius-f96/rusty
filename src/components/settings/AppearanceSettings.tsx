import { themeOptions } from "../../theme";
import { useWorkspaceStore } from "../../store";
import { Field, Select } from "../ui";
import styles from "./AppearanceSettings.module.css";

export function AppearanceSettings() {
  const activeThemeId = useWorkspaceStore((state) => state.activeThemeId);
  const setActiveThemeId = useWorkspaceStore((state) => state.setActiveThemeId);

  return (
    <section className={styles.section} aria-labelledby="appearance-settings-title">
      <div>
        <h3 className={styles.title} id="appearance-settings-title">Appearance</h3>
        <p className={styles.description}>Choose the color theme used throughout Axiom.</p>
      </div>
      <Field id="appearance-theme-select" label="Theme">
        <Select
          id="appearance-theme-select"
          value={activeThemeId}
          onChange={(event) => setActiveThemeId(event.currentTarget.value)}
          options={themeOptions.map((themeOption) => ({
            value: themeOption.id,
            label: themeOption.name,
          }))}
        />
      </Field>
    </section>
  );
}
