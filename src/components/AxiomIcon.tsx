import React from "react";

interface AxiomIconProps {
  size?: number;
  className?: string;
}

export const AxiomIcon: React.FC<AxiomIconProps> = ({ size = 20, className = "" }) => {
  return (
    <img
      src="/axiom-dark.png"
      alt="Axiom"
      className={`select-none object-contain rounded-sm ${className}`}
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
};

