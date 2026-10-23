"use client";

import type { ReactNode } from "react";
import { useWorld } from "@/components/shell/useWorld";
import { withoutEmoji } from "@/lib/i18n";

/**
 * One Settings section: pixel card with a title, an optional note and its controls. Under `[data-world="social"]`
 * globals.css gives `.px-card` the iOS look, and the title loses its leading emoji (Social titles carry none).
 */
export default function Card({
  id,
  title,
  note,
  children,
}: {
  id?: string;
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="px-card flex scroll-mt-20 flex-col gap-3">
      <div>
        <h2 className="text-base">{useWorld() === "social" ? withoutEmoji(title) : title}</h2>
        {note && <p className="text-muted text-xs">{note}</p>}
      </div>
      {children}
    </section>
  );
}
