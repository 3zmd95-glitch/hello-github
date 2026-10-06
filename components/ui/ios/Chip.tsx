import type { HTMLAttributes, ReactNode } from "react";

export default function Chip({
  tone = "default",
  icon,
  className = "",
  children,
  ...rest
}: {
  tone?: "default" | "tint" | "warn";
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={`ios-chip ${tone === "default" ? "" : tone} ${className}`} {...rest}>
      {icon}
      {children}
    </span>
  );
}
