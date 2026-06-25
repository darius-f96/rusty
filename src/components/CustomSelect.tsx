import React, { useState, useEffect, useRef } from "react";

interface Option {
  id: string;
  name: string;
}

interface CustomSelectProps {
  value: string;
  onChange: (val: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = "Select option...",
  className = ""
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const selectedOption = options.find(o => o.id === value);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  return (
    <div ref={containerRef} className={`relative select-none font-sans text-xs ${className}`}>
      {/* Dropdown Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between bg-[var(--bg-app)] text-[var(--text-normal)] border border-[var(--border-color)] focus:border-[var(--border-active)] rounded-lg px-2.5 py-1.5 outline-none cursor-pointer text-left transition-all hover:border-[var(--border-active)]/50"
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

      {/* Dropdown Options List */}
      {isOpen && (
        <div className="absolute left-0 right-0 mt-1 bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-lg shadow-2xl max-h-48 overflow-y-auto z-[100] animate-fadeIn p-1 custom-scrollbar">
          {options.length > 0 ? (
            options.map((opt) => {
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
            })
          ) : (
            <div className="px-2.5 py-1.5 text-[var(--text-muted)] text-center italic text-[11px]">
              No options available
            </div>
          )}
        </div>
      )}
    </div>
  );
};
