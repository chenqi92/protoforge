import { motion } from "framer-motion";
import { Send, Zap, Network, Radio, Eye, Puzzle, Waves, Braces, ArrowRight, Sparkles, Server, Database, Workflow } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type WelcomeAction = "http" | "graphql" | "ws" | "sse" | "mqtt" | "tcpudp" | "loadtest" | "capture" | "mockserver" | "dbclient" | "workflow" | "plugins";

interface FeatureItem {
  action: WelcomeAction;
  icon: typeof Send;
  labelKey: string;
  descKey: string;
  color: string;
  iconColor: string;
}

const requestFeatures: FeatureItem[] = [
  { action: "http", icon: Send, labelKey: "welcome.httpRequest", descKey: "welcome.httpRequestDesc", color: "bg-accent-soft border-accent/20", iconColor: "text-blue-500 bg-blue-500/10" },
  { action: "graphql", icon: Braces, labelKey: "welcome.graphql", descKey: "welcome.graphqlDesc", color: "bg-accent-soft border-accent/20", iconColor: "text-fuchsia-500 bg-fuchsia-500/10" },
  { action: "ws", icon: Zap, labelKey: "welcome.websocket", descKey: "welcome.websocketDesc", color: "bg-accent-soft border-accent/20", iconColor: "text-amber-500 bg-amber-500/10" },
  { action: "sse", icon: Waves, labelKey: "welcome.sse", descKey: "welcome.sseDesc", color: "bg-accent-soft border-accent/20", iconColor: "text-orange-500 bg-orange-500/10" },
  { action: "mqtt", icon: Radio, labelKey: "welcome.mqtt", descKey: "welcome.mqttDesc", color: "bg-accent-soft border-accent/20", iconColor: "text-purple-500 bg-purple-500/10" },
];

const toolFeatures: FeatureItem[] = [
  { action: "tcpudp", icon: Network, labelKey: "welcome.tcpudp", descKey: "welcome.tcpudpDesc", color: "bg-accent-soft border-accent/20", iconColor: "text-indigo-500 bg-indigo-500/10" },
  { action: "capture", icon: Eye, labelKey: "welcome.capture", descKey: "welcome.captureDesc", color: "bg-accent-soft border-accent/20", iconColor: "text-cyan-500 bg-cyan-500/10" },
  { action: "loadtest", icon: Radio, labelKey: "welcome.loadtest", descKey: "welcome.loadtestDesc", color: "bg-accent-soft border-accent/20", iconColor: "text-rose-500 bg-rose-500/10" },
  { action: "mockserver", icon: Server, labelKey: "welcome.mockserver", descKey: "welcome.mockserverDesc", color: "bg-accent-soft border-accent/20", iconColor: "text-green-500 bg-green-500/10" },
  { action: "dbclient", icon: Database, labelKey: "welcome.dbclient", descKey: "welcome.dbclientDesc", color: "bg-accent-soft border-accent/20", iconColor: "text-amber-500 bg-amber-500/10" },
  { action: "workflow", icon: Workflow, labelKey: "welcome.workflow", descKey: "welcome.workflowDesc", color: "bg-accent-soft border-accent/20", iconColor: "text-indigo-500 bg-indigo-500/10" },
  { action: "plugins", icon: Puzzle, labelKey: "welcome.pluginSystem", descKey: "welcome.pluginSystemDesc", color: "bg-accent-soft border-accent/20", iconColor: "text-violet-500 bg-violet-500/10" },
];

interface WelcomePageProps {
  onAction?: (action: WelcomeAction) => void;
}

function FeatureCard({ item, index, onAction }: { item: FeatureItem; index: number; onAction?: (action: WelcomeAction) => void }) {
  const { t } = useTranslation();
  const Icon = item.icon;
  return (
    <motion.button
      type="button"
      initial={{ y: 12, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.08 + index * 0.04, duration: 0.32, ease: "easeOut" }}
      onClick={() => onAction?.(item.action)}
      className={cn(
        // Linear aesthetic: subtle surface stack — light mode uses pure white cards on off-white bg,
        // dark mode uses near-zero white opacity and hover-via-opacity-step (no shadows on dark).
        "group relative overflow-hidden rounded-2xl border p-4 text-left transition-colors duration-200",
        "bg-card border-border-subtle hover:border-border-default hover:bg-muted",
        "dark:bg-white/[0.02] dark:hover:bg-white/[0.045] dark:border-white/[0.06] dark:hover:border-white/[0.09]",
        "active:scale-[0.99]"
      )}
    >
      <div className="relative z-10 flex items-start gap-3">
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-[1.04]", item.iconColor)}>
          <Icon className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="pf-text-sm font-[590] tracking-[-0.01em] text-text-primary leading-tight">{t(item.labelKey)}</h3>
          <p className="mt-1 pf-text-xs leading-relaxed text-text-tertiary line-clamp-2">{t(item.descKey)}</p>
        </div>
        <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-disabled opacity-0 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0.5" />
      </div>
    </motion.button>
  );
}

export function WelcomePage({ onAction }: WelcomePageProps) {
  const { t } = useTranslation();
  const isMac = navigator.platform?.toLowerCase().includes("mac");
  const mod = isMac ? "⌘" : "Ctrl";

  return (
    <div className="h-full w-full overflow-y-auto bg-transparent">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-10 py-10">
        {/* Hero */}
        <motion.div
          initial={{ y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="flex flex-col items-center text-center"
        >
          <div className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-accent/[0.06] px-3 py-1 pf-text-xs font-[510] text-accent">
            <Sparkles className="h-3 w-3" />
            <span>{t('welcome.badge')}</span>
          </div>
          {/* Linear-style display: weight 510, aggressive negative tracking, tight line-height */}
          <h1 className="text-[40px] font-[510] leading-[1.05] tracking-[-0.03em] text-text-primary">
            {t('welcome.title')}
          </h1>
          <p className="mt-3 max-w-lg pf-text-base leading-relaxed text-text-secondary">
            {t('welcome.subtitle')}
          </p>
        </motion.div>

        {/* Request Features */}
        <section>
          <motion.div
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.06, duration: 0.35 }}
            className="mb-3"
          >
            <h2 className="pf-text-base font-[590] tracking-[-0.015em] text-text-primary">{t('welcome.requestFeatures')}</h2>
            <p className="mt-0.5 pf-text-xs text-text-disabled">{t('welcome.requestFeaturesDesc')}</p>
          </motion.div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {requestFeatures.map((item, index) => (
              <FeatureCard key={item.action} item={item} index={index} onAction={onAction} />
            ))}
          </div>
        </section>

        {/* Tool Features */}
        <section>
          <motion.div
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.18, duration: 0.35 }}
            className="mb-3"
          >
            <h2 className="pf-text-base font-[590] tracking-[-0.015em] text-text-primary">{t('welcome.toolFeatures')}</h2>
            <p className="mt-0.5 pf-text-xs text-text-disabled">{t('welcome.toolFeaturesDesc')}</p>
          </motion.div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-2">
            {toolFeatures.map((item, index) => (
              <FeatureCard key={item.action} item={item} index={index + requestFeatures.length} onAction={onAction} />
            ))}
          </div>
        </section>

        {/* Keyboard Shortcuts */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.35 }}
          className="flex flex-wrap items-center justify-center gap-6 border-t border-border-subtle pt-5 pf-text-xs text-text-tertiary"
        >
          <div className="flex items-center gap-1.5">
            <kbd className="rounded-md border border-border-default bg-background px-1.5 py-0.5 pf-text-xxs font-mono font-[510] text-text-secondary">{mod}+N</kbd>
            <span>{t('welcome.newRequest')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <kbd className="rounded-md border border-border-default bg-background px-1.5 py-0.5 pf-text-xxs font-mono font-[510] text-text-secondary">{mod}+K</kbd>
            <span>{t('welcome.commandPalette')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <kbd className="rounded-md border border-border-default bg-background px-1.5 py-0.5 pf-text-xxs font-mono font-[510] text-text-secondary">{mod}+,</kbd>
            <span>{t('welcome.preferences')}</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
