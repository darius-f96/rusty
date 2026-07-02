import React from "react";
import { Search } from "lucide-react";
import { AxiomIcon } from "./AxiomIcon";

interface HeaderViewProps {
  onSearchOpen: () => void;
}

export const HeaderView: React.FC<HeaderViewProps> = ({ onSearchOpen }) => {
  return (
    <header className="w-full h-10 px-4 flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-app)] select-none z-30 flex-shrink-0">
      {/* Left Area: Logo */}
      <div className="flex items-center space-x-2">
        <AxiomIcon size={20} />
        <span className="text-xs font-black tracking-wider text-[var(--text-light)] font-sans">
          Axiom
        </span>
      </div>

      {/* Middle Area: Interactive Search Bar */}
      <div className="flex-1 max-w-sm mx-auto relative px-4">
        <div className="relative group">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
          <input
            type="text"
            placeholder="Search workspace..."
            readOnly
            onClick={onSearchOpen}
            className="w-full h-7 pl-8 pr-12 rounded-md bg-[var(--bg-sidebar)] border border-[var(--border-color)] text-[11px] text-[var(--text-normal)] opacity-85 select-none cursor-pointer transition-all focus:outline-none hover:border-[var(--accent-color)]/40"
          />
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center space-x-0.5 pointer-events-none">
            <kbd className="px-1 py-0.2 text-[8px] font-sans font-medium rounded border border-[var(--border-color)] bg-[var(--bg-app)] text-[var(--text-muted)]">⌘</kbd>
            <kbd className="px-1 py-0.2 text-[8px] font-sans font-medium rounded border border-[var(--border-color)] bg-[var(--bg-app)] text-[var(--text-muted)]">K</kbd>
          </div>
        </div>
      </div>

      {/* Right Area placeholder to balance flex layout */}
      <div className="w-[100px] flex justify-end" />
    </header>
  );
};
