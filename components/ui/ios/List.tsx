import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";

/** A grouped list: a small header (with optional trailing content: a count chip, a `HeadLink`) over the rows. */
export function ListGroup({
  header,
  trailing,
  className = "",
  testId,
  children,
  ...rest
}: {
  header?: string;
  trailing?: ReactNode;
  className?: string;
  testId?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  return (
    <section className={`flex flex-col gap-1.5 ${className}`} data-testid={testId} {...rest}>
      {header && (
        <div className="flex items-center justify-between gap-2 pe-4">
          <h2 className="ios-gh text-[13px]">{header}</h2>
          {trailing}
        </div>
      )}
      <div className="ios-list">{children}</div>
    </section>
  );
}

/** One row: icon square, title + sub, trailing content or a forward chevron. Renders a link, a button or a div. */
export function ListRow({
  icon,
  iconTone = "tint",
  title,
  sub,
  trailing,
  chevron,
  href,
  onClick,
  testId,
  className = "",
  ...rest
}: {
  icon?: ReactNode;
  iconTone?: "tint" | "warn" | "fill";
  title: ReactNode;
  sub?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  href?: string;
  onClick?: () => void;
  testId?: string;
  className?: string;
} & Omit<HTMLAttributes<HTMLElement>, "title" | "onClick">) {
  const body = (
    <>
      {icon && <span className={`ios-ic ${iconTone === "tint" ? "" : iconTone}`}>{icon}</span>}
      <span className="ios-tx">
        <b>{title}</b>
        {sub && <small>{sub}</small>}
      </span>
      {trailing}
      {chevron && (
        <ChevronLeft
          size={18}
          strokeWidth={1.75}
          className="text-muted ltr:rotate-180"
          aria-hidden
        />
      )}
    </>
  );
  const cls = `ios-row ${className}`;
  const sep = icon ? undefined : "16";
  if (href)
    return (
      <Link href={href} className={cls} data-testid={testId} data-sep={sep} {...rest}>
        {body}
      </Link>
    );
  if (onClick)
    return (
      <button
        type="button"
        onClick={onClick}
        className={cls}
        data-testid={testId}
        data-sep={sep}
        {...rest}
      >
        {body}
      </button>
    );
  return (
    <div className={cls} data-testid={testId} data-sep={sep} {...rest}>
      {body}
    </div>
  );
}
