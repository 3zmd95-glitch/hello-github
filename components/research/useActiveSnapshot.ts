"use client";

import { useMemo, useState } from "react";

/** Retain the last active request while a mounted panel is hidden. Existing work may finish,
 * but background settings or cache changes cannot start another request. */
export function useActiveSnapshot<T>(value: T, enabled: boolean): T | null {
  const current = JSON.stringify(value);
  const [snapshot, setSnapshot] = useState(enabled ? current : "");
  if (enabled && current !== snapshot) setSnapshot(current);
  const selected = enabled ? current : snapshot;
  return useMemo(() => (selected ? (JSON.parse(selected) as T) : null), [selected]);
}
