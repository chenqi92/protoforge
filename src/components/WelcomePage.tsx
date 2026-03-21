import { motion } from "framer-motion";
import { Send, Zap, Network, Radio, Eye, Puzzle, Waves } from "lucide-react";
import { cn } from "@/lib/utils";

export type WelcomeAction = "http" | "ws" | "sse" | "mqtt" | "tcpudp" | "loadtest" | "capture" | "plugins";

const requestFeatures: Array<{
  action: WelcomeAction;
  icon: typeof Send;
  label: string;
  desc: string;
  color: string;
  iconColor: string;
}> = [
  { action: "http", icon: Send, label: "HTTP 请求", desc: "环境变量、前后置脚本、响应分析", color: "from-blue-500/10 to-transparent border-blue-500/20", iconColor: "text-blue-500 bg-blue-500/10" },
  { action: "ws", icon: Zap, label: "WebSocket", desc: "实时连接、消息监控、自动重连", color: "from-amber-500/10 to-transparent border-amber-500/20", iconColor: "text-amber-500 bg-amber-500/10" },
  { action: "sse", icon: Waves, label: "SSE", desc: "流式事件订阅、实时查看推送数据", color: "from-orange-500/10 to-transparent border-orange-500/20", iconColor: "text-orange-500 bg-orange-500/10" },
  { action: "mqtt", icon: Radio, label: "MQTT", desc: "主题订阅、消息发布、连接凭证配置", color: "from-purple-500/10 to-transparent border-purple-500/20", iconColor: "text-purple-500 bg-purple-500/10" },
];

const toolFeatures: Array<{
  action: WelcomeAction;
  icon: typeof Network;
  label: string;
  desc: string;
  color: string;
  iconColor: string;
}> = [
  { action: "tcpudp", icon: Network, label: "TCP/UDP", desc: "Socket 调试、协议收发、十六进制查看", color: "from-indigo-500/10 to-transparent border-indigo-500/20", iconColor: "text-indigo-500 bg-indigo-500/10" },
  { action: "capture", icon: Eye, label: "网络抓包", desc: "HTTP 代理、请求录制、证书导出", color: "from-cyan-500/10 to-transparent border-cyan-500/20", iconColor: "text-cyan-500 bg-cyan-500/10" },
  { action: "loadtest", icon: Radio, label: "压测引擎", desc: "并发控制、实时 TPS、P99 延迟", color: "from-rose-500/10 to-transparent border-rose-500/20", iconColor: "text-rose-500 bg-rose-500/10" },
  { action: "plugins", icon: Puzzle, label: "插件系统", desc: "WASM 运行时、协议解析扩展", color: "from-violet-500/10 to-transparent border-violet-500/20", iconColor: "text-violet-500 bg-violet-500/10" },
];

interface WelcomePageProps {
  onAction?: (action: WelcomeAction) => void;
}

function FeatureSection({
  title,
  desc,
  items,
  onAction,
}: {
  title: string;
  desc: string;
  items: Array<{
    action: WelcomeAction;
    icon: typeof Send;
    label: string;
    desc: string;
    color: string;
    iconColor: string;
  }>;
  onAction?: (action: WelcomeAction) => void;
}) {
  return (
    <section>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[18px] font-semibold text-text-primary">{title}</h2>
          <p className="mt-1 text-[13px] text-text-tertiary">{desc}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {items.map((item, index) => {
          const Icon = item.icon;
          return (
            <motion.button
              key={item.label}
              type="button"
              initial={{ y: 16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: index * 0.04, duration: 0.32 }}
              onClick={() => onAction?.(item.action)}
              className={cn(
                "group relative overflow-hidden rounded-[22px] border border-border-default/75 bg-bg-primary/50 p-5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] transition-all duration-300",
                "hover:border-border-strong/80 hover:bg-bg-primary/68 hover:shadow-[0_12px_36px_rgba(15,23,42,0.08)] active:scale-[0.985]",
                item.color
              )}
            >
              <div className="absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-white/90 to-transparent opacity-70 dark:via-white/12" />
              <div className="relative z-10">
                <div className={cn("mb-4 flex h-10 w-10 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110", item.iconColor)}>
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mb-1.5 text-sm font-semibold text-text-primary">{item.label}</h3>
                <p className="text-[12px] leading-relaxed text-text-tertiary">{item.desc}</p>
              </div>
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}

export function WelcomePage({ onAction }: WelcomePageProps) {
  return (
    <div className="h-full w-full overflow-y-auto bg-transparent px-8 py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-10">
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="max-w-2xl"
        >
          <h1 className="text-4xl font-extrabold tracking-tight text-text-primary">
            请求工作台与工具工作台已经分层
          </h1>
          <p className="mt-4 text-[15px] leading-7 text-text-secondary">
            请求类协议使用上方 tab 管理会话，TCP/UDP、抓包、压测作为独立工作台切换，不再和请求文档混排。
          </p>
          <p className="mt-2 text-[12px] text-text-disabled">
            顶部工具工作台支持直接拖出为独立窗口，独立窗口内也可以一键合并回主界面。
          </p>
        </motion.div>

        <FeatureSection
          title="请求工作台"
          desc="这些会话会出现在上方请求 tab 中，适合并行调试不同协议连接。"
          items={requestFeatures}
          onAction={onAction}
        />

        <FeatureSection
          title="工具工作台"
          desc="这些模块是完整的一级工作台，用于流量观察、Socket 调试和压力测试。"
          items={toolFeatures}
          onAction={onAction}
        />

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.4 }}
          className="flex flex-wrap items-center gap-8 border-t border-border-subtle/70 pt-6 text-[13px] text-text-disabled"
        >
          <div className="flex items-center gap-2">
            <kbd className="rounded-md border border-border-default bg-bg-secondary px-2 py-1 text-[11px] font-mono shadow-sm">Ctrl+N</kbd>
            <span>新建请求</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="rounded-md border border-border-default bg-bg-secondary px-2 py-1 text-[11px] font-mono shadow-sm">Ctrl+K</kbd>
            <span>命令面板</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="rounded-md border border-border-default bg-bg-secondary px-2 py-1 text-[11px] font-mono shadow-sm">Ctrl+,</kbd>
            <span>偏好设置</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
