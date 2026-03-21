import { cn } from "@/lib/utils";

interface RequestWorkbenchHeaderProps {
  prefix: React.ReactNode;
  main: React.ReactNode;
  actions?: React.ReactNode;
  secondary?: React.ReactNode;
  className?: string;
  shellClassName?: string;
}

export function RequestWorkbenchHeader({
  prefix,
  main,
  actions,
  secondary,
  className,
  shellClassName,
}: RequestWorkbenchHeaderProps) {
  return (
    <div className={cn("shrink-0 px-3 pb-1 pt-1.5", className)}>
      <div
        className={cn(
          "wb-request-shell transition-all focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-muted",
          shellClassName
        )}
      >
        {prefix}
        <div className="wb-request-main">{main}</div>
        {actions ? <div className="wb-request-actions">{actions}</div> : null}
      </div>
      {secondary ? <div className="wb-request-secondary">{secondary}</div> : null}
    </div>
  );
}
