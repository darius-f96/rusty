import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, X } from "lucide-react";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  kind?: "warning" | "danger" | "info";
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  kind = "warning",
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    if (open) {
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          onCancel();
        }
      };
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [open, onCancel]);

  if (!open) return null;

  const kindStyles = {
    warning: {
      icon: "text-amber-400",
      button: "bg-amber-600 hover:bg-amber-500",
    },
    danger: {
      icon: "text-rose-400",
      button: "bg-rose-600 hover:bg-rose-500",
    },
    info: {
      icon: "text-violet-400",
      button: "bg-violet-600 hover:bg-violet-500",
    },
  };

  const styles = kindStyles[kind];

  const modalContent = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      onClick={onCancel}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
          <div className="flex items-center space-x-2">
            <AlertTriangle size={16} className={styles.icon} />
            <span className="font-sans text-sm font-semibold text-[var(--text-light)]">{title}</span>
          </div>
          <button
            onClick={onCancel}
            className="text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors p-1 rounded"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          <p className="text-xs font-sans text-[var(--text-normal)] leading-relaxed">{message}</p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-2 px-4 py-3 border-t border-[var(--border-color)] bg-[var(--bg-app)]/50">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-mono text-[var(--text-muted)] hover:text-[var(--text-light)] bg-[var(--bg-sidebar)] hover:bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`px-3 py-1.5 text-xs font-mono font-bold text-white ${styles.button} rounded-lg transition-colors shadow-md`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};