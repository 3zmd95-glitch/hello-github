import type { CSSProperties } from "react";

/** Segmented pixel progress bar. `value` is 0..1. */
export default function PxBar({
  value,
  color,
  small,
  label,
  className = "",
}: {
  value: number;
  color?: string;
  small?: boolean;
  label?: string;
  className?: string;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={label}
      className={`px-bar ${small ? "px-bar-sm" : ""} ${className}`}
      style={color ? ({ "--c": color } as CSSProperties) : undefined}
    >
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}
