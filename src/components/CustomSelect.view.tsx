import React, { RefObject } from "react";
import { createPortal } from "react-dom";
import { Option, OptionGroup } from "./CustomSelect";
import styles from "./CustomSelect.module.css";

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
        className={`${styles.option} ${isSelected ? styles.selected : ""}`}
        title={opt.name}
      >
        {opt.name}
      </div>
    );
  };

  return (
    <div ref={containerRef} className={`${styles.root} ${className}`}>
      {/* Dropdown Button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={buttonClassName || styles.button}
      >
        <span className={styles.label}>{selectedOption ? selectedOption.name : placeholder}</span>
        <svg
          className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ""}`}
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
          data-custom-select-dropdown
          style={{
            position: "fixed",
            top: pos.openUp ? undefined : pos.top,
            bottom: pos.openUp ? Math.max(0, window.innerHeight - pos.top) : undefined,
            left: pos.left,
            minWidth: pos.minWidth,
          }}
          className={`${styles.dropdown} ${dropdownClassName}`}
        >
          {showSearch && (
            <div className={styles.searchWrap}>
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={styles.search}
              />
            </div>
          )}
          <div className={styles.options}>
            {hasResults ? (
              filteredGroups ? (
                filteredGroups.map((g) => (
                  <div key={g.label} className={styles.group}>
                    <div className={styles.groupLabel}>
                      {g.label}
                    </div>
                    <div className={styles.groupOptions}>
                      {g.options.map(renderOption)}
                    </div>
                  </div>
                ))
              ) : (
                filteredOptions.map(renderOption)
              )
            ) : (
              <div className={styles.empty}>
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
