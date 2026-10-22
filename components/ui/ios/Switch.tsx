"use client";

export default function Switch({
  checked,
  onChange,
  label,
  disabled,
  testId,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  testId?: string;
  id?: string;
}) {
  return (
    <input
      id={id}
      type="checkbox"
      role="switch"
      className="ios-switch"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      aria-checked={checked}
      data-testid={testId}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}
