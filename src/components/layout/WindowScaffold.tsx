import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface WindowScaffoldProps {
  header: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function WindowScaffold({
  header,
  children,
  footer,
  className,
  bodyClassName,
}: WindowScaffoldProps) {
  return (
    <div
      className={cn(
        "flex h-screen min-h-0 flex-col overflow-hidden bg-bg-primary",
        className
      )}
    >
      {header}
      <div className={cn("flex-1 min-h-0 overflow-hidden", bodyClassName)}>
        {children}
      </div>
      {footer}
    </div>
  );
}
