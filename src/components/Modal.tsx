import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X, Check, AlertTriangle } from "lucide-react";

type ModalIcon = React.ComponentType<{ size?: number; className?: string }>;

interface ModalProps {
  title: string;
  icon?: ModalIcon;
  iconClassName?: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Footer override. If omitted, a default Cancel + Confirm footer is rendered. */
  footer?: React.ReactNode;
  /** Confirm label for the default footer. */
  confirmLabel?: string;
  /** Disabled state for the default confirm button. */
  disableConfirm?: boolean;
  /** Default footer confirm handler. Required when using the default footer. */
  onConfirm?: () => void;
  /** Visual style of the confirm action. */
  variant?: "default" | "danger";
  /** Panel width class. Defaults to w-[440px]. */
  width?: string;
  /** Make the body scrollable (for tall content). */
  scrollable?: boolean;
}

export const Modal: React.FC<ModalProps> = ({
  title,
  icon: Icon,
  iconClassName = "text-[var(--accent-color)]",
  onClose,
  children,
  footer,
  confirmLabel = "Confirm",
  disableConfirm = false,
  onConfirm,
  variant = "default",
  width = "w-[440px]",
  scrollable = false,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes the modal.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [onClose]);

  const isDanger = variant === "danger";
  const confirmBtnClass = isDanger
    ? "bg-[var(--color-status-danger-solid)] hover:bg-[var(--color-status-danger-bg)]"
    : "bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/80";
  const confirmTextClass = isDanger
    ? "text-[var(--color-status-danger-solid-foreground)]"
    : "text-[var(--color-primary-foreground)]";

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-[var(--color-surface-overlay)] backdrop-blur-sm" onClick={onClose} />
      <div ref={panelRef} className={`relative bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl shadow-2xl ${width} max-h-[85vh] flex flex-col`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)]">
          <div className="flex items-center space-x-2">
            {Icon && <Icon size={16} className={iconClassName} />}
            <span className="text-sm font-bold text-[var(--text-light)]">{title}</span>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors" title="Close">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className={`${scrollable ? "flex-1 overflow-y-auto" : ""} p-5 space-y-4`}>
          {children}
        </div>

        {/* Footer */}
        {footer !== undefined ? (
          footer
        ) : (
          <div className="flex items-center justify-end space-x-2 px-5 py-3 border-t border-[var(--border-color)]">
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text-light)] rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={disableConfirm}
              className={`flex items-center space-x-1.5 px-4 py-1.5 ${confirmBtnClass} ${confirmTextClass} disabled:opacity-40 text-xs font-bold rounded-lg transition-colors`}
            >
              {isDanger ? <AlertTriangle size={13} /> : <Check size={13} />}
              <span>{confirmLabel}</span>
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
