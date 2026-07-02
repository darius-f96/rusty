import React, { useState, useEffect, useRef, useLayoutEffect } from "react";
import { CustomSelectView } from "./CustomSelect.view";

export interface Option {
  id: string;
  name: string;
}

export interface OptionGroup {
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
  const hasResults = groups
    ? (filteredGroups && filteredGroups.length > 0)
    : filteredOptions.length > 0;

  return (
    <CustomSelectView
      value={value}
      placeholder={placeholder}
      className={className}
      buttonClassName={buttonClassName}
      dropdownClassName={dropdownClassName}
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      pos={pos}
      containerRef={containerRef}
      buttonRef={buttonRef}
      dropdownRef={dropdownRef}
      selectedOption={selectedOption}
      showSearch={showSearch}
      hasResults={!!hasResults}
      filteredGroups={filteredGroups}
      filteredOptions={filteredOptions}
      onChange={onChange}
    />
  );
};
