import { useState } from "react";
import { Zap, Send as SendIcon, X, MessageSquare, Plug } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";

export function WsWorkspace() {
  const activeTab = useAppStore((s) => s.getActiveTab());
  const updateTab = useAppStore((s) => s.updateTab);
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<{ type: "sent" | "received"; text: string; time: string }[]>([]);

  if (!activeTab) return null;
  const url = activeTab.wsUrl || "ws://localhost:8080";

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* URL bar */}
      <div className="shrink-0 px-4 py-3 bg-bg-secondary border-b border-border-subtle">
        <div className="flex items-center gap-0">
          <div className="h-[34px] px-3 flex items-center bg-amber-500 rounded-l-[var(--radius-md)] text-white text-[12px] font-bold">
            WS
          </div>
          <input
            value={url}
            onChange={(e) => updateTab(activeTab.id, { wsUrl: e.target.value })}
            placeholder="ws://localhost:8080"
            className="flex-1 h-[34px] px-3 bg-bg-input border-y border-border-default text-[13px] font-mono text-text-primary outline-none focus:border-border-focus transition-colors"
          />
          <button className={cn(
            "h-[34px] px-5 rounded-r-[var(--radius-md)] flex items-center gap-2 text-[13px] font-semibold text-white transition-all",
            connected ? "bg-red-500 hover:bg-red-600" : "gradient-accent hover:opacity-90"
          )}>
            {connected ? <X className="w-4 h-4" /> : <Plug className="w-4 h-4" />}
            {connected ? "断开" : "连接"}
          </button>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-auto p-4">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-text-disabled">
              <div className="text-center">
                <Zap className="w-8 h-8 mx-auto mb-3 opacity-20" />
                <p className="text-sm">连接 WebSocket 服务器开始通信</p>
                <p className="text-[11px] mt-1">支持文本和二进制消息</p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {messages.map((m, i) => (
                <div key={i} className={cn("flex", m.type === "sent" ? "justify-end" : "justify-start")}>
                  <div className={cn(
                    "max-w-[70%] px-3 py-2 rounded-[var(--radius-md)] text-[12px] font-mono",
                    m.type === "sent" ? "bg-accent/20 text-text-primary" : "bg-bg-elevated text-text-secondary"
                  )}>
                    {m.text}
                    <div className="text-[10px] text-text-disabled mt-1">{m.time}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Send bar */}
        <div className="shrink-0 px-4 py-3 border-t border-border-subtle bg-bg-secondary/50">
          <div className="flex items-center gap-2">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="输入消息..."
              className="input-field flex-1 text-[12px] font-mono"
              disabled={!connected}
            />
            <button disabled={!connected || !message.trim()} className="btn-primary flex items-center gap-1.5 text-[12px] disabled:opacity-40">
              <SendIcon className="w-3.5 h-3.5" />
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
