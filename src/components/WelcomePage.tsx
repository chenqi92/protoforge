import { motion } from "framer-motion";
import { Send, Zap, Network, Radio, Eye, Puzzle } from "lucide-react";
import { cn } from "@/lib/utils";
import logoSvg from "@/assets/logo.svg";

export type WelcomeAction = "http" | "ws" | "tcpudp" | "loadtest" | "capture" | "plugins";

const features: { action: WelcomeAction; icon: typeof Send; label: string; desc: string; color: string; iconColor: string }[] = [
  { action: "http", icon: Send, label: "HTTP 客户端", desc: "API 调试 · 环境变量 · 前后置脚本", color: "from-blue-500/10 to-transparent border-blue-500/20", iconColor: "text-blue-500 bg-blue-500/10" },
  { action: "ws", icon: Zap, label: "WebSocket", desc: "实时连接 · 消息监控 · 自动重连", color: "from-amber-500/10 to-transparent border-amber-500/20", iconColor: "text-amber-500 bg-amber-500/10" },
  { action: "tcpudp", icon: Network, label: "TCP/UDP", desc: "Socket 测试 · 协议解析 · 十六进制", color: "from-indigo-500/10 to-transparent border-indigo-500/20", iconColor: "text-indigo-500 bg-indigo-500/10" },
  { action: "loadtest", icon: Radio, label: "压测引擎", desc: "并发控制 · 实时 TPS · P99 延迟", color: "from-rose-500/10 to-transparent border-rose-500/20", iconColor: "text-rose-500 bg-rose-500/10" },
  { action: "capture", icon: Eye, label: "网络抓包", desc: "HTTP 代理 · 请求/响应录制", color: "from-cyan-500/10 to-transparent border-cyan-500/20", iconColor: "text-cyan-500 bg-cyan-500/10" },
  { action: "plugins", icon: Puzzle, label: "插件系统", desc: "WASM 运行时 · 协议解析扩展", color: "from-violet-500/10 to-transparent border-violet-500/20", iconColor: "text-violet-500 bg-violet-500/10" },
];

interface WelcomePageProps {
  onAction?: (action: WelcomeAction) => void;
}

export function WelcomePage({ onAction }: WelcomePageProps) {
  return (
    <div className="h-full w-full flex items-center justify-center p-8 bg-bg-primary overflow-y-auto">
      <div className="max-w-3xl w-full">
        {/* Heading */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="text-center mb-16"
        >
          <img src={logoSvg} alt="ProtoForge" className="w-16 h-16 rounded-2xl shadow-lg shadow-blue-500/20 mb-6 mx-auto" />
          <h1 className="text-4xl font-extrabold text-text-primary mb-4 tracking-tight">
            探索 <span className="text-gradient">ProtoForge</span>
          </h1>
          <p className="text-text-secondary text-base max-w-md mx-auto leading-relaxed">
            新一代协议调试与性能测试工作站。选择下方模块快速开始你的研发之旅。
          </p>
        </motion.div>

        {/* Feature grid */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f, i) => {
            const Icon = f.icon;
            return (
              <motion.div
                key={f.label}
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.1 + i * 0.05, duration: 0.4 }}
                onClick={() => onAction?.(f.action)}
                className={cn(
                  "group relative p-5 rounded-2xl bg-gradient-to-br border border-border-default",
                  "hover:border-transparent hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)] transition-all duration-300 cursor-pointer overflow-hidden",
                  "active:scale-[0.97]",
                  f.color
                )}
              >
                <div className="absolute inset-0 bg-white/40 dark:bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <div className="relative z-10">
                  <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110 duration-300", f.iconColor)}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="text-sm font-semibold text-text-primary mb-1.5">{f.label}</h3>
                  <p className="text-[12px] text-text-tertiary leading-relaxed">{f.desc}</p>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Quick start shortcuts */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.5 }}
          className="mt-16 flex items-center justify-center gap-8 text-[13px] text-text-disabled"
        >
          <div
            onClick={() => onAction?.("http")}
            className="flex items-center gap-2 group cursor-pointer hover:text-text-secondary transition-colors"
          >
            <kbd className="px-2 py-1 bg-bg-secondary border border-border-default rounded-md text-[11px] font-mono shadow-sm group-hover:border-border-strong transition-colors">Ctrl+N</kbd>
            <span>新建请求</span>
          </div>
          <div className="flex items-center gap-2 group cursor-pointer hover:text-text-secondary transition-colors">
            <kbd className="px-2 py-1 bg-bg-secondary border border-border-default rounded-md text-[11px] font-mono shadow-sm group-hover:border-border-strong transition-colors">Ctrl+K</kbd>
            <span>全局搜索</span>
          </div>
          <div className="flex items-center gap-2 group cursor-pointer hover:text-text-secondary transition-colors">
            <kbd className="px-2 py-1 bg-bg-secondary border border-border-default rounded-md text-[11px] font-mono shadow-sm group-hover:border-border-strong transition-colors">Ctrl+,</kbd>
            <span>偏好设置</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
