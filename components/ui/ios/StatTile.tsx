"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { useCountUp } from "./useCountUp";

export default function StatTile({
  label,
  value,
  decimals = 0,
  suffix = "",
  prefix = "",
  delta,
  countUp = true,
  start = true,
  className = "",
  testId,
  ...rest
}: {
  label: string;
  value: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  delta?: ReactNode;
  countUp?: boolean;
  /** Hold the count-up until true (the card is on screen). */
  start?: boolean;
  className?: string;
  testId?: string;
} & HTMLAttributes<HTMLDivElement>) {
  const shown = useCountUp(value, { decimals, enabled: countUp, start });
  return (
    <div className={`ios-stat ${className}`} data-testid={testId} {...rest}>
      <small>{label}</small>
      <b className="num">
        {prefix}
        {shown}
        {suffix}
      </b>
      {delta && <span className="ios-delta">{delta}</span>}
    </div>
  );
}
