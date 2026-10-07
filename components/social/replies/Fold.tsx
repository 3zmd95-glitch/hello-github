import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A disclosure group: a `<details>` whose `<summary>` is an iOS row (icon, title, a forward chevron that turns down
 * while open). The row sits in a span inside the summary: Safari does not lay out a flex `<summary>` itself.
 */
export default function Fold({
  icon,
  title,
  testId,
  summaryTestId,
  className = "",
  children,
}: {
  icon?: ReactNode;
  title: string;
  testId?: string;
  summaryTestId?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details className={`ios-list ar-fold ${className}`} data-testid={testId}>
      <summary data-testid={summaryTestId}>
        <span className="ios-row" data-sep={icon ? undefined : "16"}>
          {icon && <span className="ios-ic">{icon}</span>}
          <span className="ios-tx">
            <b>{title}</b>
          </span>
          <ChevronLeft size={18} strokeWidth={1.75} className="ar-chev text-muted" aria-hidden />
        </span>
      </summary>
      <div className="ar-fold-body">{children}</div>
    </details>
  );
}
