import React from "react";
import { Search } from "lucide-react";
import { AxiomIcon } from "./AxiomIcon";

export const Header: React.FC = () => {
  return (
    <header className="w-full h-14 px-6 flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-app)] select-none z-30 flex-shrink-0">
      {/* Left Area: Logo */}
      <div className="flex items-center space-x-2.5">
        <div className="w-8 h-8 rounded-lg bg-[var(--bg-sidebar)] border border-[var(--border-color)] flex items-center justify-center text-[var(--accent-color)] shadow-md transition-all">
          <AxiomIcon size={18} className="animate-spin-slow" />
        </div>
        <span className="text-sm font-black tracking-wider text-[var(--text-light)] font-sans">
          Axiom
        </span>
      </div>

      {/* Middle Area: Non-functional Search Bar */}
      <div className="flex-1 max-w-md mx-auto relative px-4">
        <div className="relative group">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
          <input
            type="text"
            placeholder="Search workspace..."
            disabled
            className="w-full h-9 pl-9 pr-12 rounded-lg bg-[var(--bg-sidebar)] border border-[var(--border-color)] text-xs text-[var(--text-normal)] opacity-85 select-none cursor-not-allowed transition-all focus:outline-none"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center space-x-0.5 pointer-events-none">
            <kbd className="px-1.5 py-0.5 text-[9px] font-sans font-medium rounded border border-[var(--border-color)] bg-[var(--bg-app)] text-[var(--text-muted)]">⌘</kbd>
            <kbd className="px-1.5 py-0.5 text-[9px] font-sans font-medium rounded border border-[var(--border-color)] bg-[var(--bg-app)] text-[var(--text-muted)]">K</kbd>
          </div>
        </div>
      </div>

      {/* Right Area placeholder to balance flex layout */}
      <div className="w-[120px] flex justify-end" />
    </header>
  );
};

