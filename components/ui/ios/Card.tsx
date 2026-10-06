import { ChevronLeft } from "lucide-react";
import Link from "next/link";
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

/** A card's header row (mockup `.h2`): a small grey title, optional trailing content (a chip, a `HeadLink`). */
export function CardHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-2">
      <h2 className="text-ink-2 text-[13px] font-semibold">{title}</h2>
      {children}
    </div>
  );
}

/** "Calendar ›": a header link with the forward chevron (flips in LTR); its hit area reaches past the text. */
export function HeadLink({
  href,
  testId,
  children,
}: {
  href: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="px-link -my-2 inline-flex shrink-0 items-center gap-0.5 py-2 text-[13px] no-underline"
      data-testid={testId}
    >
      {children}
      <ChevronLeft size={14} strokeWidth={1.75} className="ltr:rotate-180" aria-hidden />
    </Link>
  );
}
