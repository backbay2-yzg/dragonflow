import { AlertTriangle, Check, Clock, XCircle } from "lucide-react";
import type { TaskStatus } from "../../bindings/github.com/dragonflow/desktop/internal/domain/models";
import { STATUS_META, type StatusIndicator } from "../utils/format";

interface StatusBadgeProps {
  status: TaskStatus | string;
  size?: "xs" | "sm";
  className?: string;
}

function renderIndicator(indicator: StatusIndicator) {
  switch (indicator) {
    case "pulse":
      return <span className="df-pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-current" />;
    case "dot":
    case "idle":
      return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />;
    case "waiting":
      return <Clock className="h-3 w-3 shrink-0" />;
    case "check":
      return <Check className="h-3 w-3 shrink-0" />;
    case "alert":
      return <AlertTriangle className="h-3 w-3 shrink-0" />;
    case "error":
      return <XCircle className="h-3 w-3 shrink-0" />;
  }
}

export function StatusBadge({ status, size = "xs", className = "" }: StatusBadgeProps) {
  const meta = STATUS_META[status] ?? {
    label: status,
    tone: "neutral" as const,
    indicator: "idle" as const,
    badgeClass: "df-badge-neutral",
    pulsing: false,
  };

  const sizeClass =
    size === "sm" ? "px-2.5 py-0.5 text-[12.5px] gap-1.5" : "px-2 py-0.5 text-[12px] gap-1";

  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium leading-tight ${sizeClass} ${meta.badgeClass} ${className}`}
    >
      {renderIndicator(meta.indicator)}
      <span>{meta.label}</span>
    </span>
  );
}
