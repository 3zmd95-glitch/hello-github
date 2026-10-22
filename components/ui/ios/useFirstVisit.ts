"use client";

import { useEffect, useState } from "react";

const seen = new Set<string>();

/** True on the first visit of a screen in this page load (entrance stagger), false on later visits. */
export function useFirstVisit(key: string): boolean {
  const [first] = useState(() => !seen.has(key));
  useEffect(() => {
    seen.add(key);
  }, [key]);
  return first;
}
