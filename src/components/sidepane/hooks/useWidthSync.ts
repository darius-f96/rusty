/**
 * useWidthSync.ts
 *
 * Restores the pane width from localStorage when the storage key changes
 * (e.g. when a different node type is selected).
 */

import { useEffect } from "react";

/**
 * Synchronises the pane's CSS width with the value persisted in localStorage
 * identified by `storageKey`.
 *
 * The effect writes the stored width directly to the container's inline style
 * and updates the state via the provided `setWidth` callback.
 *
 * @param storageKey   - localStorage key used to persist width.
 * @param setWidth     - State setter to update the React width value.
 * @param containerRef - Ref to the outermost pane container element.
 */
export function useWidthSync(
  storageKey: string,
  setWidth: (width: number) => void,
  containerRef: React.RefObject<HTMLDivElement | null>
): void {
  useEffect(() => {
    const stored = localStorage.getItem(storageKey);

    if (stored) {
      const val = parseInt(stored, 10);
      if (!isNaN(val) && val > 200 && val < 1200) {
        setWidth(val);
        if (containerRef.current) {
          containerRef.current.style.width = `${val}px`;
        }
        return;
      }
    }

    const defaultWidth = 500;
    setWidth(defaultWidth);
    if (containerRef.current) {
      containerRef.current.style.width = `${defaultWidth}px`;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
}
