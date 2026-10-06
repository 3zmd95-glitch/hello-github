import type { ReactNode } from "react";

export default function Chip({
  tone = "default",
  icon,
  className = "",
  children,
}: {
  tone?: "default" | "tint" | "warn";
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={`ios-chip ${tone === "default" ? "" : tone} ${className}`}>
      {icon}
      {children}
    </span>
  );
}
