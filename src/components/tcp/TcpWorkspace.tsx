import { Network, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";

export function TcpWorkspace() {
  const activeTab = useAppStore((s) => s.getActiveTab());
  const updateTab = useAppStore((s) => s.updateTab);

  if (!activeTab) return null;
  const isTcp = activeTab.protocol === "tcp";

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Connection bar */}
      <div className="shrink-0 px-4 py-3 bg-bg-secondary border-b border-border-subtle">
        <div className="flex items-center gap-0">
          <div className={cn("h-[34px] px-3 flex items-center rounded-l-[var(--radius-md)] text-white text-[12px] font-bold", isTcp ? "bg-blue-500" : "bg-cyan-500")}>
            {isTcp ? "TCP" : "UDP"}
          </div>
          <input
            value={activeTab.tcpHost || "localhost"}
            onChange={(e) => updateTab(activeTab.id, { tcpHost: e.target.value })}
            placeholder="主机地址"
            className="flex-1 h-[34px] px-3 bg-bg-input border-y border-border-default text-[13px] font-mono text-text-primary outline-none focus:border-border-focus"
          />
          <input
            value={activeTab.tcpPort || 8080}
            onChange={(e) => updateTab(activeTab.id, { tcpPort: parseInt(e.target.value) || 0 })}
            placeholder="端口"
            className="w-20 h-[34px] px-3 bg-bg-input border-y border-l-0 border-border-default text-[13px] font-mono text-text-primary outline-none focus:border-border-focus text-center"
            type="number"
          />
          <button className="h-[34px] px-5 rounded-r-[var(--radius-md)] flex items-center gap-2 text-[13px] font-semibold text-white gradient-accent hover:opacity-90 transition-all">
            <ArrowUpDown className="w-4 h-4" />
            连接
          </button>
        </div>
      </div>

      {/* Placeholder */}
      <div className="flex-1 flex items-center justify-center text-text-disabled">
        <div className="text-center">
          <Network className="w-8 h-8 mx-auto mb-3 opacity-20" />
          <p className="text-sm">{isTcp ? "TCP" : "UDP"} 连接测试</p>
          <p className="text-[11px] mt-1">数据收发 · 十六进制查看 · 协议解析</p>
          <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 bg-bg-elevated border border-border-default rounded-full text-[11px]">
            <span>🚧 开发中</span>
          </div>
        </div>
      </div>
    </div>
  );
}
