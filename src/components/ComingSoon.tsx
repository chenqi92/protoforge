import { motion } from "framer-motion";
import { Zap, Network, Radio, Eye, Puzzle, Construction } from "lucide-react";
import { cn } from "@/lib/utils";

interface ComingSoonProps {
  module: string;
}

const moduleInfo: Record<string, { icon: typeof Zap; label: string; desc: string; color: string }> = {
  websocket: { icon: Zap, label: "WebSocket", desc: "实时双向通信调试 · 消息监控 · 自动重连 · 帧查看器", color: "text-amber-400" },
  tcp: { icon: Network, label: "TCP/UDP", desc: "原始 Socket 连接 · 数据包收发 · 十六进制查看 · 协议解析", color: "text-blue-400" },
  loadtest: { icon: Radio, label: "压测引擎", desc: "并发/阶梯/持续压测 · 实时 TPS/P99 面板 · 自动报告", color: "text-rose-400" },
  capture: { icon: Eye, label: "网络抓包", desc: "HTTP/HTTPS 代理 · 请求/响应拦截 · 重放 · 过滤器", color: "text-cyan-400" },
  plugins: { icon: Puzzle, label: "插件系统", desc: "WASM 运行时 · 协议解析插件 · 插件市场 · 自动更新", color: "text-violet-400" },
  settings: { icon: Construction, label: "设置", desc: "主题 · 快捷键 · 代理 · 证书 · 数据导入导出", color: "text-gray-400" },
};

export function ComingSoon({ module }: ComingSoonProps) {
  const info = moduleInfo[module] || { icon: Construction, label: module, desc: "模块开发中", color: "text-gray-400" };
  const Icon = info.icon;

  return (
    <div className="h-full flex items-center justify-center">
      <motion.div
        key={module}
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className="text-center max-w-sm"
      >
        <div className={cn(
          "w-16 h-16 rounded-2xl mx-auto mb-5 flex items-center justify-center",
          "bg-bg-elevated border border-border-default"
        )}>
          <Icon className={cn("w-7 h-7", info.color)} />
        </div>
        <h2 className="text-xl font-semibold text-text-primary mb-2">{info.label}</h2>
        <p className="text-sm text-text-tertiary leading-relaxed mb-6">{info.desc}</p>
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-bg-elevated border border-border-default rounded-full text-xs text-text-disabled">
          <Construction className="w-3.5 h-3.5" />
          <span>开发中 · 即将推出</span>
        </div>
      </motion.div>
    </div>
  );
}
