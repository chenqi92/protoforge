import { useState } from "react";
import { Zap, Send as SendIcon, X, Plug } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";

export function WsWorkspace() {
  const activeTab = useAppStore((s) => s.getActiveTab());
  const updateTab = useAppStore((s) => s.updateTab);
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState("");
  const [messages] = useState<{ type: "sent" | "received"; text: string; time: string }[]>([]);

  if (!activeTab) return null;
  const url = activeTab.wsUrl || "ws://localhost:8080";

  return (
    <div className="h-full flex flex-col overflow-hidden bg-bg-app">
      {/* Top Connection Bar Area */}
      <div className="shrink-0 p-4 pb-2">
        <div className="flex items-center h-12 rounded-[var(--radius-lg)] bg-bg-primary border border-border-default shadow-sm focus-within:ring-2 focus-within:ring-accent-muted focus-within:border-accent transition-all p-1">
          {/* Protocol Badge */}
          <div className="relative h-full shrink-0">
            <div className="flex items-center justify-center gap-1.5 h-full px-4 rounded-[var(--radius-md)] text-[13px] font-bold text-white bg-amber-500 min-w-[90px] shadow-sm">
              <Zap className="w-3.5 h-3.5" />
              WS
            </div>
          </div>
          
          {/* URL Input */}
          <input
            value={url}
            onChange={(e) => updateTab(activeTab.id, { wsUrl: e.target.value })}
            placeholder="输入 WebSocket 服务端地址，如 ws://localhost:8080"
            className="flex-1 h-full px-4 bg-transparent text-[13px] font-mono text-text-primary outline-none placeholder:text-text-tertiary"
          />
          
          {/* Connect Button */}
          <button 
            onClick={() => setConnected(!connected)}
            className={cn(
              "h-full px-6 rounded-[var(--radius-md)] flex items-center gap-2 text-[13px] font-semibold text-white ml-1 shrink-0 transition-all",
              connected 
                ? "bg-red-500 hover:bg-red-600 hover:shadow-md active:scale-[0.98]" 
                : "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 hover:shadow-md active:scale-[0.98]"
            )}
          >
            {connected ? <X className="w-4 h-4" /> : <Plug className="w-4 h-4" />}
            {connected ? "断开连接" : "连接"}
          </button>
        </div>
      </div>

      {/* Main Area */}
      <div className="flex-1 flex flex-col overflow-hidden p-4 pt-2">
        <div className="flex-1 flex flex-col bg-bg-primary rounded-2xl border border-border-default shadow-sm overflow-hidden panel">
          {/* Status Header */}
          <div className="flex items-center px-4 py-3 bg-bg-secondary/40 border-b border-border-default shrink-0">
            <div className="flex items-center gap-2">
              <div className={cn("w-2 h-2 rounded-full", connected ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse" : "bg-text-disabled")} />
              <span className="text-[13px] font-medium text-text-secondary">{connected ? "已连接" : "未连接"}</span>
            </div>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-auto p-5 bg-bg-input/30">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-text-disabled">
                <div className="w-16 h-16 rounded-full bg-bg-secondary flex items-center justify-center mb-4 border border-border-default shadow-sm">
                  <Zap className="w-8 h-8 opacity-20 text-amber-500" />
                </div>
                <p className="text-[14px] font-medium text-text-secondary">WebSocket 调试</p>
                <p className="text-[12px] mt-1">连接到服务器开始收发消息</p>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((m, i) => (
                  <div key={i} className={cn("flex", m.type === "sent" ? "justify-end" : "justify-start")}>
                    <div className={cn(
                      "max-w-[70%] px-4 py-2.5 rounded-2xl text-[13px] font-mono break-words shadow-sm",
                      m.type === "sent" 
                        ? "bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-500/20 text-amber-900 dark:text-amber-100 rounded-tr-sm" 
                        : "bg-bg-elevated border border-border-default text-text-secondary rounded-tl-sm"
                    )}>
                      {m.text}
                      <div className="text-[10px] opacity-50 mt-1.5 text-right">{m.time}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Message Input Bar */}
          <div className="shrink-0 p-3 bg-bg-secondary/20 border-t border-border-default">
            <div className="flex items-end gap-2">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="在此输入消息内容..."
                disabled={!connected}
                className="flex-1 max-h-[120px] min-h-[44px] h-[44px] p-3 text-[13px] font-mono bg-bg-input border border-border-default rounded-xl focus:border-amber-500 focus:ring-1 focus:ring-amber-500/50 transition-all outline-none resize-y"
              />
              <button 
                disabled={!connected || !message.trim()} 
                className="h-[44px] px-5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl flex items-center justify-center gap-1.5 text-[13px] font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm active:scale-95 shrink-0"
              >
                <SendIcon className="w-4 h-4" />
                发送
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
