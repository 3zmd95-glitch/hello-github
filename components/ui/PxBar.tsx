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
  // Any real progress shows at least a 1 % sliver, so the first quest on a big island still moves the bar.
  const clamped = Math.max(0, Math.min(1, value));
  const pct = clamped > 0 ? Math.max(1, Math.round(clamped * 100)) : 0;
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
