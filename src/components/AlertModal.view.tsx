import React from "react";
import { CheckCircle2, AlertCircle, Info, AlertTriangle } from "lucide-react";
import { Modal } from "./Modal";

export const variantConfig = {
  success: { Icon: CheckCircle2, iconClass: "text-emerald-400", titleDefault: "Success" },
  error: { Icon: AlertCircle, iconClass: "text-rose-400", titleDefault: "Error" },
  info: { Icon: Info, iconClass: "text-[var(--accent-color)]", titleDefault: "Info" },
  danger: { Icon: AlertTriangle, iconClass: "text-rose-400", titleDefault: "Warning" },
} as const;

export type NotificationVariant = keyof typeof variantConfig;

interface AlertModalViewProps {
  notification: {
    variant: NotificationVariant;
    title?: string;
    message: string;
  } | null;
  clear: () => void;
}

export const AlertModalView: React.FC<AlertModalViewProps> = ({ notification, clear }) => {
  if (!notification) return null;

  const cfg = variantConfig[notification.variant];
  const isDanger = notification.variant === "error" || notification.variant === "danger";

  return (
    <Modal
      title={notification.title || cfg.titleDefault}
      icon={cfg.Icon}
      iconClassName={cfg.iconClass}
      onClose={clear}
      onConfirm={clear}
      confirmLabel="OK"
      variant={isDanger ? "danger" : "default"}
      width="w-[420px]"
    >
      <div className={`flex items-start space-x-3 text-xs font-mono leading-relaxed ${isDanger ? "text-rose-200" : "text-[var(--text-normal)]"}`}>
        <cfg.Icon size={18} className={`flex-shrink-0 mt-0.5 ${cfg.iconClass}`} />
        <span className="whitespace-pre-wrap">{notification.message}</span>
      </div>
    </Modal>
  );
};
