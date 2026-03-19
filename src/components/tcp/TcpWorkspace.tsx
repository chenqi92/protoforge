import { Network, ArrowUpDown, ServerCog } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";

export function TcpWorkspace() {
  const activeTab = useAppStore((s) => s.getActiveTab());
  const updateTab = useAppStore((s) => s.updateTab);

  if (!activeTab) return null;
  const isTcp = activeTab.protocol === "tcp";

  return (
    <div className="h-full flex flex-col overflow-hidden bg-bg-app">
      {/* Top Connection Bar Area */}
      <div className="shrink-0 p-4 pb-2">
        <div className="flex items-center h-12 rounded-[var(--radius-lg)] bg-bg-primary border border-border-default shadow-sm focus-within:ring-2 focus-within:ring-accent-muted focus-within:border-accent transition-all p-1">
          {/* Protocol Badge */}
          <div className="relative h-full shrink-0">
            <div className={cn(
              "flex items-center justify-center gap-1.5 h-full px-4 rounded-[var(--radius-md)] text-[13px] font-bold text-white min-w-[90px] shadow-sm",
              isTcp ? "bg-blue-500" : "bg-cyan-500"
            )}>
              <Network className="w-3.5 h-3.5" />
              {isTcp ? "TCP" : "UDP"}
            </div>
          </div>
          
          {/* Host Input */}
          <input
            value={activeTab.tcpHost || ""}
            onChange={(e) => updateTab(activeTab.id, { tcpHost: e.target.value })}
            placeholder="主机地址 (如 localhost 或 127.0.0.1)"
            className="flex-1 h-full px-4 bg-transparent text-[13px] font-mono text-text-primary outline-none placeholder:text-text-tertiary border-r border-border-default"
          />
          
          {/* Port Input */}
          <input
            value={activeTab.tcpPort || ""}
            onChange={(e) => updateTab(activeTab.id, { tcpPort: parseInt(e.target.value) || 0 })}
            placeholder="端口"
            type="number"
            className="w-24 h-full px-4 bg-transparent text-[13px] font-mono text-text-primary outline-none placeholder:text-text-tertiary text-center"
          />
          
          {/* Connect Button */}
          <button className={cn(
            "h-full px-6 rounded-[var(--radius-md)] flex items-center gap-2 text-[13px] font-semibold text-white ml-1 shrink-0 transition-all",
            isTcp 
              ? "bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 hover:shadow-md active:scale-[0.98]" 
              : "bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 hover:shadow-md active:scale-[0.98]"
          )}>
            <ArrowUpDown className="w-4 h-4" />
            连接
          </button>
        </div>
      </div>

      {/* Main Area Placeholder */}
      <div className="flex-1 p-4 pt-2">
        <div className="h-full flex items-center justify-center bg-bg-primary rounded-2xl border border-border-default shadow-sm overflow-hidden panel">
          <div className="text-center flex flex-col items-center">
            <div className={cn(
              "w-20 h-20 rounded-2xl flex items-center justify-center border shadow-sm mb-6",
              isTcp ? "bg-blue-500/10 border-blue-500/20" : "bg-cyan-500/10 border-cyan-500/20"
            )}>
              <ServerCog className={cn("w-10 h-10", isTcp ? "text-blue-500" : "text-cyan-500")} />
            </div>
            <h2 className="text-xl font-bold text-text-primary mb-2">
              {isTcp ? "TCP Socket" : "UDP Socket"} 测试客户端
            </h2>
            <p className="text-[13px] text-text-secondary max-w-sm leading-relaxed mb-6">
              支持发送和接收二进制数据、十六进制查看、自动冲刷以及心跳保活功能。
            </p>
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-bg-secondary border border-border-default rounded-full text-[12px] font-medium text-text-tertiary shadow-sm">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
              </span>
              核心功能开发中，敬请期待
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
