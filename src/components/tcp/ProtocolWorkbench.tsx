import type { ReactNode } from "react";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import { cn } from "@/lib/utils";
import type { ConnectionStats, DataFormat, TcpMessage } from "@/types/tcp";
import { MessageDetailPanel } from "./MessageDetailPanel";
import { MessageLog } from "./MessageLog";

interface ProtocolWorkbenchProps {
  sidebar: ReactNode;
  messageAreaClassName?: string;
  compact?: boolean;
  messages: TcpMessage[];
  selectedMessageId?: string | null;
  onSelectMessage: (message: TcpMessage) => void;
  onClearMessages: () => void;
  displayFormat: DataFormat;
  setDisplayFormat: (format: DataFormat) => void;
  connected?: boolean;
  statusText?: string;
  stats?: ConnectionStats;
  sendPanel: ReactNode;
}

interface ProtocolSidebarSectionProps {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  compact?: boolean;
  showDescriptionInCompact?: boolean;
}

export function ProtocolSidebarSection({
  title,
  description,
  action,
  children,
  className,
  compact = false,
  showDescriptionInCompact = false,
}: ProtocolSidebarSectionProps) {
  return (
    <section className={cn("wb-subpanel overflow-hidden", className)}>
      <div className={cn("wb-pane-header shrink-0", compact && "px-3 py-2")}>
        <div className="min-w-0">
          <div className={cn("font-semibold text-text-primary", compact ? "pf-text-xxs" : "pf-text-xs")}>
            {title}
          </div>
          {description && (!compact || showDescriptionInCompact) ? (
            <div className="mt-0.5 pf-text-xxs leading-5 text-text-tertiary">
              {description}
            </div>
          ) : null}
        </div>
        {action}
      </div>
      <div className={cn(compact ? "p-2.5" : "p-3")}>{children}</div>
    </section>
  );
}

export function ProtocolWorkbench({
  sidebar,
  messageAreaClassName,
  compact = false,
  messages,
  selectedMessageId,
  onSelectMessage,
  onClearMessages,
  displayFormat,
  setDisplayFormat,
  connected,
  statusText,
  stats,
  sendPanel,
}: ProtocolWorkbenchProps) {
  const selectedMessage = selectedMessageId
    ? messages.find((item) => item.id === selectedMessageId) ?? null
    : null;

  return (
    <div className={cn("wb-workbench-grid min-h-0 min-w-0 max-w-full flex-1", compact && "wb-workbench-grid--compact")}>
      <div className={cn("wb-workbench-sidebar", compact && "wb-workbench-sidebar--compact")}>
        <div className={cn("min-h-0 flex-1 overflow-auto", compact ? "p-2.5" : "p-3")}>
          <div className={cn(compact ? "space-y-2.5" : "space-y-3")}>
            {sidebar}
            {sendPanel}
          </div>
        </div>
      </div>

      <div className="wb-workbench-main">
        <div className={cn("min-h-0 flex-1 overflow-hidden", messageAreaClassName)}>
          <PanelGroup orientation="vertical">
            <Panel defaultSize={64} minSize={34}>
              <MessageLog
                messages={messages}
                onClear={onClearMessages}
                displayFormat={displayFormat}
                setDisplayFormat={setDisplayFormat}
                selectedMessageId={selectedMessageId}
                onSelectMessage={onSelectMessage}
                connected={connected}
                statusText={statusText}
                stats={stats}
                embedded
              />
            </Panel>
            <PanelResizeHandle className="wb-workbench-divider wb-workbench-divider--flush" />
            <Panel defaultSize={36} minSize={18}>
              <MessageDetailPanel
                message={selectedMessage}
                displayFormat={displayFormat}
                compact={compact}
              />
            </Panel>
          </PanelGroup>
        </div>
      </div>
    </div>
  );
}
