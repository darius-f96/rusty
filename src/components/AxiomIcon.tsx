import React from "react";

interface AxiomIconProps {
  size?: number;
  className?: string;
}

export const AxiomIcon: React.FC<AxiomIconProps> = ({ size = 20, className = "" }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M16 5.5 L25.5 25.5 L6.5 25.5 Z"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M11 19 L21 19"
        stroke="var(--accent-color)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="16" cy="12" r="1.6" fill="var(--accent-color)" />
      <circle cx="13.8" cy="16.6" r="1.6" fill="var(--accent-color)" />
      <circle cx="18.2" cy="16.6" r="1.6" fill="var(--accent-color)" />
    </svg>
  );
};
