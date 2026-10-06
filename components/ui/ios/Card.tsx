import type { HTMLAttributes, ReactNode } from "react";

export default function Card({
  hero,
  pressable,
  className = "",
  testId,
  children,
  ...rest
}: {
  hero?: boolean;
  pressable?: boolean;
  className?: string;
  testId?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`ios-card ${hero ? "ios-hero" : ""} ${pressable ? "ios-pressable" : ""} ${className}`}
      data-testid={testId}
      {...rest}
    >
      {children}
    </div>
  );
}
