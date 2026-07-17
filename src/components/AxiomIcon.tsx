import React from "react";
import { useWorkspaceStore } from "../store";
import { resolveTheme } from "../theme";

interface AxiomIconProps {
  size?: number;
  className?: string;
}

export const AxiomIcon: React.FC<AxiomIconProps> = ({ size = 20, className = "" }) => {
  const activeThemeId = useWorkspaceStore((state) => state.activeThemeId);
  const isLight = resolveTheme(activeThemeId).appearance === "light";

  return (
    <img
      src={isLight ? "/axiom-light.png" : "/axiom-dark.png"}
      alt="Axiom"
      className={`select-none object-contain rounded-sm ${className}`}
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
};
