import { fmtPct, fmtSigned } from "./format";

/**
 * A signed change with an arrow, colored by direction (green up, red down, muted flat). `value` null means
 * "no baseline yet": renders the `pending` text in muted ink instead.
 */
export default function Delta({
  value,
  pct,
  pending,
  testId,
  className = "",
}: {
  value: number | null;
  pct: number | null;
  pending: string;
  testId?: string;
  className?: string;
}) {
  if (value === null) {
    return (
      <span className={`text-muted text-xs ${className}`} data-testid={testId} data-dir="none">
        {pending}
      </span>
    );
  }
  const dir = value > 0 ? "up" : value < 0 ? "down" : "flat";
  const color = dir === "up" ? "text-accent" : dir === "down" ? "text-danger" : "text-muted";
  return (
    <span
      className={`num inline-flex items-center gap-1 text-xs font-semibold ${color} ${className}`}
      data-testid={testId}
      data-dir={dir}
      dir="ltr"
    >
      <span aria-hidden>{dir === "up" ? "▲" : dir === "down" ? "▼" : "▪"}</span>
      <span>{fmtSigned(value)}</span>
      {pct !== null && <span className="opacity-80">({fmtPct(pct)})</span>}
    </span>
  );
}
