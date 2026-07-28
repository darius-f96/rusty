/**
 * useActiveTabDefault.ts
 *
 * Sets the default active tab whenever the selected node changes.
 * - "chat" for global chat nodes.
 * - "description" for task nodes.
 * - "diff" for all other node types.
 */

import { useEffect } from "react";

export type SidePaneTab = "description" | "diff" | "chat" | "console" | "vfs";

/**
 * Resets `activeTab` to a sensible default when the selected node changes.
 *
 * @param selectedNode - The selected node object (may be undefined).
 * @param setActiveTab - State setter for the active tab.
 */
export function useActiveTabDefault(
  selectedNode: any,
  setActiveTab: (tab: SidePaneTab) => void
): void {
  useEffect(() => {
    if (!selectedNode) return;

    if (selectedNode.type === "globalChatNode") {
      setActiveTab("chat");
    } else if (selectedNode.type === "taskNode") {
      setActiveTab("description");
    } else {
      setActiveTab("diff");
    }
    // setActiveTab is a stable useState setter and intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode?.id, selectedNode?.type]);
}
