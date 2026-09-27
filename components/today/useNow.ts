"use client";

import { useSyncExternalStore } from "react";

const noop = () => {};
const never = () => noop;
const tick = (onChange: () => void) => {
  const id = setInterval(onChange, 1000);
  return () => clearInterval(id);
};
const nowSeconds = () => Math.floor(Date.now() / 1000) * 1000;
const zero = () => 0;

/**
 * Epoch ms rounded to the second, re-read every second while `active` (0 when not, and on the server), so a
 * countdown re-renders once a second without storing the clock in React state.
 */
export function useNow(active: boolean): number {
  return useSyncExternalStore(active ? tick : never, active ? nowSeconds : zero, zero);
}
