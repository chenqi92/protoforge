import { motion } from "framer-motion";
import { Send, Zap, Network, Radio, Eye, Puzzle, Waves } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type WelcomeAction = "http" | "ws" | "sse" | "mqtt" | "tcpudp" | "loadtest" | "capture" | "plugins";

interface FeatureItem {
  action: WelcomeAction;
  icon: typeof Send;
  labelKey: string;
  descKey: string;
  color: string;
  iconColor: string;
}

const requestFeatures: FeatureItem[] = [
  { action: "http", icon: Send, labelKey: "welcome.httpRequest", descKey: "welcome.httpRequestDesc", color: "from-blue-500/10 to-transparent border-blue-500/20", iconColor: "text-blue-500 bg-blue-500/10" },
  { action: "ws", icon: Zap, labelKey: "welcome.websocket", descKey: "welcome.websocketDesc", color: "from-amber-500/10 to-transparent border-amber-500/20", iconColor: "text-amber-500 bg-amber-500/10" },
  { action: "sse", icon: Waves, labelKey: "welcome.sse", descKey: "welcome.sseDesc", color: "from-orange-500/10 to-transparent border-orange-500/20", iconColor: "text-orange-500 bg-orange-500/10" },
  { action: "mqtt", icon: Radio, labelKey: "welcome.mqtt", descKey: "welcome.mqttDesc", color: "from-purple-500/10 to-transparent border-purple-500/20", iconColor: "text-purple-500 bg-purple-500/10" },
];

const toolFeatures: FeatureItem[] = [
  { action: "tcpudp", icon: Network, labelKey: "welcome.tcpudp", descKey: "welcome.tcpudpDesc", color: "from-indigo-500/10 to-transparent border-indigo-500/20", iconColor: "text-indigo-500 bg-indigo-500/10" },
  { action: "capture", icon: Eye, labelKey: "welcome.capture", descKey: "welcome.captureDesc", color: "from-cyan-500/10 to-transparent border-cyan-500/20", iconColor: "text-cyan-500 bg-cyan-500/10" },
  { action: "loadtest", icon: Radio, labelKey: "welcome.loadtest", descKey: "welcome.loadtestDesc", color: "from-rose-500/10 to-transparent border-rose-500/20", iconColor: "text-rose-500 bg-rose-500/10" },
  { action: "plugins", icon: Puzzle, labelKey: "welcome.pluginSystem", descKey: "welcome.pluginSystemDesc", color: "from-violet-500/10 to-transparent border-violet-500/20", iconColor: "text-violet-500 bg-violet-500/10" },
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
  items: FeatureItem[];
  onAction?: (action: WelcomeAction) => void;
}) {
  const { t } = useTranslation();

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
          const label = t(item.labelKey);
          return (
            <motion.button
              key={item.action}
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
                <h3 className="mb-1.5 text-sm font-semibold text-text-primary">{label}</h3>
                <p className="text-[12px] leading-relaxed text-text-tertiary">{t(item.descKey)}</p>
              </div>
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}

export function WelcomePage({ onAction }: WelcomePageProps) {
  const { t } = useTranslation();

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
            {t('welcome.badge')}
          </h1>
          <p className="mt-4 text-[15px] leading-7 text-text-secondary">
            {t('welcome.title')}
          </p>
          <p className="mt-2 text-[12px] text-text-disabled">
            {t('welcome.subtitle')}
          </p>
        </motion.div>

        <FeatureSection
          title={t('welcome.requestFeatures')}
          desc={t('welcome.httpRequestDesc')}
          items={requestFeatures}
          onAction={onAction}
        />

        <FeatureSection
          title={t('welcome.toolFeatures')}
          desc={t('welcome.tcpudpDesc')}
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
            <span>{t('welcome.newRequest')}</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="rounded-md border border-border-default bg-bg-secondary px-2 py-1 text-[11px] font-mono shadow-sm">Ctrl+K</kbd>
            <span>{t('welcome.commandPalette')}</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="rounded-md border border-border-default bg-bg-secondary px-2 py-1 text-[11px] font-mono shadow-sm">Ctrl+,</kbd>
            <span>{t('welcome.preferences')}</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
