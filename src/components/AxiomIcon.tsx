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
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Clean, premium geometric icon: stylized letter A using intersecting lines representing logic gates / coordinates */}
      <path d="M12 2L2 20h20L12 2z" stroke="currentColor" strokeWidth="2" />
      <path d="M12 2v18" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" className="opacity-60" />
      <path d="M7 14h10" stroke="var(--accent-color)" strokeWidth="2.5" />
      <circle cx="12" cy="10" r="1.5" fill="var(--accent-color)" stroke="none" />
    </svg>
  );
};
