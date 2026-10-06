import type { ReactNode } from "react";

export default function EmptyState({
  icon,
  title,
  hint,
  action,
  testId,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-6 text-center" data-testid={testId}>
      <span className="ios-ic fill h-12 w-12 rounded-2xl">{icon}</span>
      <p className="text-[15px] font-semibold">{title}</p>
      {hint && <p className="text-ink-2 max-w-[28ch] text-[13px]">{hint}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
