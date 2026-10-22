"use client";

import { useEffect, type ReactNode } from "react";
import { useChrome } from "./chrome";

/** Large iOS page title (34px) with an optional eyebrow line and subtitle; registers the compact title. */
export default function PageHeader({
  title,
  sub,
  eyebrow,
  trailing,
  testId,
}: {
  title: string;
  sub?: string;
  eyebrow?: string;
  trailing?: ReactNode;
  testId?: string;
}) {
  const setTitle = useChrome((s) => s.setTitle);
  useEffect(() => {
    setTitle(title);
    return () => setTitle("");
  }, [title, setTitle]);
  return (
    <header className="ios-lt flex items-end justify-between gap-3" data-testid={testId}>
      <div className="min-w-0">
        {eyebrow && <span className="ios-eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {trailing}
    </header>
  );
}
