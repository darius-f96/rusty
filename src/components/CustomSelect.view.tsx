import React, { RefObject } from "react";
import { createPortal } from "react-dom";
import { Option, OptionGroup } from "./CustomSelect";

interface CustomSelectViewProps {
  value: string;
  placeholder: string;
  className: string;
  buttonClassName: string;
  dropdownClassName: string;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  pos: { top: number; left: number; minWidth: number; openUp: boolean } | null;
  containerRef: RefObject<HTMLDivElement | null>;
  buttonRef: RefObject<HTMLButtonElement | null>;
  dropdownRef: RefObject<HTMLDivElement | null>;
  selectedOption: Option | undefined;
  showSearch: boolean;
  hasResults: boolean;
  filteredGroups: OptionGroup[] | null;
  filteredOptions: Option[];
  onChange: (val: string) => void;
}

export const CustomSelectView: React.FC<CustomSelectViewProps> = ({
  value,
  placeholder,
  className,
  buttonClassName,
  dropdownClassName,
  isOpen,
  setIsOpen,
  searchQuery,
  setSearchQuery,
  pos,
  containerRef,
  buttonRef,
  dropdownRef,
  selectedOption,
  showSearch,
  hasResults,
  filteredGroups,
  filteredOptions,
  onChange,
}) => {
  const renderOption = (opt: Option) => {
    const isSelected = opt.id === value;
    return (
      <div
        key={opt.id}
        onClick={() => {
          onChange(opt.id);
          setIsOpen(false);
        }}
        className={`px-2.5 py-1.5 rounded-md cursor-pointer transition-colors text-[11px] text-left truncate ${
          isSelected
            ? "bg-[var(--accent-bg)]/35 text-[var(--text-light)] font-semibold"
            : "text-[var(--text-normal)] hover:bg-[var(--bg-app)] hover:text-[var(--text-light)]"
        }`}
        title={opt.name}
      >
        {opt.name}
      </div>
    );
  };

  return (
    <div ref={containerRef} className={`relative select-none font-sans text-xs ${className}`}>
      {/* Dropdown Button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={buttonClassName || "w-full flex items-center justify-between bg-[var(--bg-app)] text-[var(--text-normal)] border border-[var(--border-color)] focus:border-[var(--border-active)] rounded-lg px-2.5 py-1.5 outline-none cursor-pointer text-left transition-all hover:border-[var(--border-active)]/50"}
      >
        <span className="truncate">{selectedOption ? selectedOption.name : placeholder}</span>
        <svg
          className={`w-3.5 h-3.5 ml-2 text-[var(--text-muted)] transition-transform duration-200 flex-shrink-0 ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown Options List — portaled to document.body */}
      {isOpen && pos && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: "fixed",
            top: pos.openUp ? undefined : pos.top,
            bottom: pos.openUp ? Math.max(0, window.innerHeight - pos.top) : undefined,
            left: pos.left,
            minWidth: pos.minWidth,
          }}
          className={`bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-lg shadow-2xl z-[9999] animate-fadeIn p-1 flex flex-col max-h-56 ${dropdownClassName}`}
        >
          {showSearch && (
            <div className="p-1 border-b border-[var(--border-color)]/30 mb-1">
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] text-[var(--text-normal)] rounded px-2 py-1 text-[11px] focus:border-[var(--accent-color)] focus:outline-none placeholder:text-[var(--text-muted)]/70 font-mono"
              />
            </div>
          )}
          <div className="overflow-y-auto max-h-40 custom-scrollbar flex-1">
            {hasResults ? (
              filteredGroups ? (
                filteredGroups.map((g) => (
                  <div key={g.label} className="mb-1 last:mb-0">
                    <div className="px-2.5 pt-1 pb-0.5 text-[9px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)] select-none">
                      {g.label}
                    </div>
                    <div className="space-y-0.5">
                      {g.options.map(renderOption)}
                    </div>
                  </div>
                ))
              ) : (
                filteredOptions.map(renderOption)
              )
            ) : (
              <div className="px-2.5 py-1.5 text-[var(--text-muted)] text-center italic text-[11px]">
                No options found
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
