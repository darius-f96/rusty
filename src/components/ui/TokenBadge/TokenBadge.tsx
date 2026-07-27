import { Zap } from "lucide-react";
import { formatCompactTokenCount } from "../../../services/tokenFormat";
import styles from "./TokenBadge.module.css";

export interface TokenUsageLike {
  input: number;
  output: number;
  totalTokens?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface TokenBadgeProps {
  /** Either a raw token count or a usage breakdown (total is derived from input+output when not provided). */
  usage: number | TokenUsageLike;
  /** Highlights the badge to indicate the run is still streaming. */
  live?: boolean;
  className?: string;
}

function totalFromUsage(usage: number | TokenUsageLike): number {
  if (typeof usage === "number") return usage;
  return usage.totalTokens ?? usage.input + usage.output;
}

function titleFromUsage(usage: number | TokenUsageLike): string | undefined {
  if (typeof usage === "number") return undefined;
  const parts = [`${usage.input.toLocaleString()} in`, `${usage.output.toLocaleString()} out`];
  if (usage.cacheRead) parts.push(`${usage.cacheRead.toLocaleString()} cache read`);
  if (usage.cacheWrite) parts.push(`${usage.cacheWrite.toLocaleString()} cache write`);
  return parts.join(" · ");
}

export function TokenBadge({ usage, live = false, className = "" }: TokenBadgeProps) {
  const total = totalFromUsage(usage);
  if (total <= 0) return null;
  return (
    <span
      className={`${styles.badge} ${live ? styles.live : ""} ${className}`}
      title={titleFromUsage(usage)}
    >
      <Zap size={10} />
      {formatCompactTokenCount(total)} tok
    </span>
  );
}
