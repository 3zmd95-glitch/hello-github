"use client";

import { ListRow } from "@/components/ui/ios/List";
import Switch from "@/components/ui/ios/Switch";

/** A labelled on/off row inside an editor sheet (an inset list of one); the switch is named by the label. */
export default function SwitchRow({
  label,
  checked,
  onChange,
  disabled,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <div className="ios-list">
      <ListRow
        title={label}
        trailing={
          <Switch
            checked={checked}
            onChange={onChange}
            label={label}
            disabled={disabled}
            testId={testId}
          />
        }
      />
    </div>
  );
}
