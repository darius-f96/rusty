import React, { useState, useEffect, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

interface Option {
  id: string;
  name: string;
}

interface OptionGroup {
  label: string;
  options: Option[];
}

interface CustomSelectProps {
  value: string;
  onChange: (val: string) => void;
  options?: Option[];
  groups?: OptionGroup[];
  placeholder?: string;
  className?: string;
  buttonClassName?: string;
  dropdownClassName?: string;
  direction?: "down" | "up";
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  value,
  onChange,
  options,
  groups,
  placeholder = "Select option...",
  className = "",
  buttonClassName = "",
  dropdownClassName = "",
  direction = "down"
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number; openUp: boolean } | null>(null);

  const allOptions = groups
    ? groups.flatMap((g) => g.options)
    : options || [];
  const selectedOption = allOptions.find(o => o.id === value);

  // Compute dropdown position from the trigger button's viewport rect.
  const updatePosition = () => {
    if (!buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    const dropH = 224; // approx max-height of the panel (max-h-56)
    const openUp = direction === "up" || (direction === "down" && r.bottom + dropH > window.innerHeight && r.top - dropH > 8);
    setPos({
      top: openUp ? r.top : r.bottom,
      left: r.left,
      minWidth: r.width,
      openUp,
    });
  };

  // Clamp horizontally so the panel never overflows the viewport right edge.
  useLayoutEffect(() => {
    if (!isOpen || !dropdownRef.current || !pos) return;
    const dw = dropdownRef.current.offsetWidth;
    const margin = 8;
    let left = pos.left;
    if (pos.left + dw > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - dw - margin);
    }
    if (left !== pos.left) {
      setPos((p) => (p ? { ...p, left } : p));
    }
  }, [isOpen, pos]);

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery("");
      setPos(null);
      return;
    }
    updatePosition();
    const onScroll = () => updatePosition();
    const onResize = () => updatePosition();
    // capture=true so scroll events inside scrollable ancestors reposition too
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, direction]);

  // Outside click: close only when the click is outside both trigger and panel.
  useEffect(() => {
    if (!isOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t)) return;
      if (dropdownRef.current?.contains(t)) return;
      setIsOpen(false);
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [isOpen]);

  // Reset search when opening/closing
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery("");
    }
  }, [isOpen]);

  const search = searchQuery.toLowerCase();
  const filteredGroups = groups
    ? groups
        .map((g) => ({
          ...g,
          options: g.options.filter((opt) => opt.name.toLowerCase().includes(search)),
        }))
        .filter((g) => g.options.length > 0)
    : null;
  const filteredOptions = !groups
    ? allOptions.filter((opt) => opt.name.toLowerCase().includes(search))
    : [];

  const showSearch = allOptions.length > 5;

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

  const hasResults = groups
    ? (filteredGroups && filteredGroups.length > 0)
    : filteredOptions.length > 0;

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

      {/* Dropdown Options List — portaled to document.body so it floats above
          overflow:hidden / overflow:auto containers and other panels. */}
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
