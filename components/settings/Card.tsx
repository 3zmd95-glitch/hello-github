import type { ReactNode } from "react";

/** One Settings section: pixel card with a title, an optional note and its controls. */
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
        <h2 className="text-base">{title}</h2>
        {note && <p className="text-muted text-xs">{note}</p>}
      </div>
      {children}
    </section>
  );
}
