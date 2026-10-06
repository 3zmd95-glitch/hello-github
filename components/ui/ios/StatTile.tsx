"use client";

import type { ReactNode } from "react";
import { useCountUp } from "./useCountUp";

export default function StatTile({
  label,
  value,
  decimals = 0,
  suffix = "",
  prefix = "",
  delta,
  countUp = true,
  className = "",
  testId,
}: {
  label: string;
  value: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  delta?: ReactNode;
  countUp?: boolean;
  className?: string;
  testId?: string;
}) {
  const shown = useCountUp(value, { decimals, enabled: countUp });
  return (
    <div className={`ios-stat ${className}`} data-testid={testId}>
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
