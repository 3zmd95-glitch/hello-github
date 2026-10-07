import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { HTMLAttributes, ReactNode, Ref } from "react";

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
  ref?: Ref<HTMLDivElement>;
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

/**
 * "Calendar ›": a header link with the forward chevron (flips in LTR). Its 44px hit area (an `::after`, so the layout
 * and the focus ring keep the text size) reaches 6px below the text and the rest (18.5px) above. In a card header that
 * is the gap to the content and the card's top padding (its last 2.5px in the space between cards); a `ListGroup`
 * header with trailing content gets 8px more air above for it. Either way it never covers the first row.
 */
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
      className="px-link relative inline-flex shrink-0 items-center gap-0.5 text-[13px] no-underline after:absolute after:inset-x-0 after:-bottom-1.5 after:h-11"
      data-testid={testId}
    >
      {children}
      <ChevronLeft size={14} strokeWidth={1.75} className="ltr:rotate-180" aria-hidden />
    </Link>
  );
}
