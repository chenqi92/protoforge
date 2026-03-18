import { motion } from "framer-motion";
import { Send, Zap, Network, Radio, Eye, Puzzle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

const features = [
  { icon: Send, label: "HTTP 客户端", desc: "API 调试 · 环境变量 · 前后置脚本", color: "from-emerald-500/20 to-emerald-500/5 border-emerald-500/20", iconColor: "text-emerald-400" },
  { icon: Zap, label: "WebSocket", desc: "实时连接 · 消息监控 · 自动重连", color: "from-amber-500/20 to-amber-500/5 border-amber-500/20", iconColor: "text-amber-400" },
  { icon: Network, label: "TCP/UDP", desc: "Socket 测试 · 协议解析 · 十六进制", color: "from-blue-500/20 to-blue-500/5 border-blue-500/20", iconColor: "text-blue-400" },
  { icon: Radio, label: "压测引擎", desc: "并发控制 · 实时 TPS · P99 延迟", color: "from-rose-500/20 to-rose-500/5 border-rose-500/20", iconColor: "text-rose-400" },
  { icon: Eye, label: "网络抓包", desc: "HTTP 代理 · 请求/响应录制", color: "from-cyan-500/20 to-cyan-500/5 border-cyan-500/20", iconColor: "text-cyan-400" },
  { icon: Puzzle, label: "插件系统", desc: "WASM 运行时 · 协议解析扩展", color: "from-violet-500/20 to-violet-500/5 border-violet-500/20", iconColor: "text-violet-400" },
];

export function WelcomePage() {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-2xl w-full">
        {/* Heading */}
        <motion.div
          initial={{ y: -10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="text-center mb-10"
        >
          <h1 className="text-3xl font-bold text-text-primary mb-2">
            欢迎使用 <span className="text-gradient">ProtoForge</span>
          </h1>
          <p className="text-text-tertiary text-sm">
            全功能网络协议工作站 · 选择左侧模块开始
          </p>
        </motion.div>

        {/* Feature grid */}
        <div className="grid grid-cols-2 gap-3">
          {features.map((f, i) => {
            const Icon = f.icon;
            return (
              <motion.div
                key={f.label}
                initial={{ y: 15, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.08 * i }}
                className={cn(
                  "group flex items-start gap-3 p-4 rounded-[var(--radius-lg)]",
                  "bg-gradient-to-br border cursor-default",
                  f.color,
                  "hover:scale-[1.02] transition-transform duration-200"
                )}
              >
                <div className={cn("w-9 h-9 rounded-[var(--radius-md)] flex items-center justify-center bg-bg-primary/40 shrink-0")}>
                  <Icon className={cn("w-4.5 h-4.5", f.iconColor)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text-primary mb-0.5">{f.label}</div>
                  <div className="text-[11px] text-text-tertiary leading-relaxed">{f.desc}</div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Quick start */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="mt-8 flex items-center justify-center gap-6 text-[12px] text-text-disabled"
        >
          <div className="flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 bg-bg-elevated border border-border-default rounded text-[10px] font-mono">Ctrl+N</kbd>
            <span>新建请求</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 bg-bg-elevated border border-border-default rounded text-[10px] font-mono">Ctrl+K</kbd>
            <span>搜索</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
