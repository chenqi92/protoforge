// SegmentedControl — unified segmented toggle component
// Replaces all hand-rolled toggle button groups across the app
// Uses the established wb-tool-segment CSS pattern for consistent styling

import { cn } from "@/lib/utils";

export interface SegmentOption<T extends string = string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

interface SegmentedControlProps<T extends string = string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
}

export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  disabled = false,
  size = "md",
  className,
}: SegmentedControlProps<T>) {
  return (
    <div className={cn("wb-tool-segment", size === "sm" && "wb-tool-segment-sm", className)}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          disabled={disabled}
          className={cn(value === opt.value && "is-active")}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}
