"use client";

import { useEffect, useState } from "react";
import { dayKey } from "@/lib/streak";

/** Today's Riyadh day key; rolls over at midnight and when the app comes back to the foreground. */
export function useToday(): string {
  const [today, setToday] = useState(() => dayKey());
  useEffect(() => {
    const update = () => setToday(dayKey());
    const id = setInterval(update, 60_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return today;
}
