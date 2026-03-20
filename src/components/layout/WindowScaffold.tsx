import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface WindowScaffoldProps {
  header: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  bodyClassName?: string;
  stageClassName?: string;
}

export function WindowScaffold({
  header,
  children,
  footer,
  className,
  bodyClassName,
  stageClassName,
}: WindowScaffoldProps) {
  return (
    <div className="h-screen overflow-hidden bg-bg-app p-3">
      <div
        className={cn(
          "relative flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] border border-white/70 bg-bg-primary/94 shadow-[0_24px_64px_rgba(15,23,42,0.14)] backdrop-blur-xl dark:border-white/6 dark:bg-[#111214]/94 dark:shadow-[0_24px_64px_rgba(0,0,0,0.44)]",
          className
        )}
      >
        <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/90 to-transparent dark:via-white/10" />
        {header}
        <div className={cn("flex-1 min-h-0 overflow-hidden p-2 pt-0", bodyClassName)}>
          <div
            className={cn(
              "flex h-full min-h-0 flex-col overflow-hidden rounded-[18px] border border-border-default/65 bg-bg-primary/72 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)] dark:bg-bg-primary/82 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
              stageClassName
            )}
          >
            {children}
          </div>
        </div>
        {footer}
      </div>
    </div>
  );
}
