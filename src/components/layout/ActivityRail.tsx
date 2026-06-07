import { useMemo } from "react";
import {
  Activity,
  Database,
  Gauge,
  Globe,
  type LucideIcon,
  Puzzle,
  Radio,
  Server,
  Video,
  Waves,
  Wrench,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/common/Tooltip";
import {
  FORGE_DOMAINS,
  FORGE_GROUPS,
  openForgeDomain,
  useAppStore,
  type ForgeDomain,
  type ForgeDomainId,
  type ForgeGroupId,
} from "@/stores/appStore";

const DOMAIN_ICONS: Record<string, LucideIcon> = {
  globe: Globe,
  radio: Radio,
  server: Server,
  zap: Zap,
  database: Database,
  video: Video,
  gauge: Gauge,
  waves: Waves,
  wrench: Wrench,
  puzzle: Puzzle,
};

interface ActivityRailProps {
  /** Activity-log dock open state (the next stage wires the dock itself). */
  activityLogOpen: boolean;
  onToggleActivityLog: () => void;
  /** Opens the plugin market modal (the modal-only domain). */
  onOpenPlugins: () => void;
}

export function ActivityRail({ activityLogOpen, onToggleActivityLog, onOpenPlugins }: ActivityRailProps) {
  const { t, i18n } = useTranslation();
  const zh = i18n.language?.startsWith("zh") ?? true;
  const tt = (a: ForgeDomain) => (zh ? a.zh : a.en);

  // getActiveDomain() returns a primitive string, so subscribing is loop-safe.
  const activeDomain = useAppStore((s) => s.getActiveDomain());

  // Count open contexts per domain — derived from raw slices (getUnifiedTabs()
  // returns a fresh array and must not be used as a store selector directly).
  const tabs = useAppStore((s) => s.tabs);
  const toolSessions = useAppStore((s) => s.toolSessions);
  const counts = useMemo(() => {
    const map: Partial<Record<ForgeDomainId, number>> = {};
    for (const tab of useAppStore.getState().getUnifiedTabs()) {
      map[tab.domain] = (map[tab.domain] ?? 0) + 1;
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, toolSessions]);

  const groups = useMemo(() => {
    return FORGE_GROUPS.map((g) => ({
      ...g,
      domains: FORGE_DOMAINS.filter((d) => d.group === g.id),
    })).filter((g) => g.domains.length > 0);
  }, []);

  return (
    <div
      className="flex h-full w-[var(--rail-w)] shrink-0 flex-col items-center gap-0.5 overflow-hidden border-r border-border-default bg-bg-sidebar py-2"
      data-rail
    >
      {groups.map((group, groupIndex) => (
        <RailGroup key={group.id} id={group.id} withSeparator={groupIndex > 0}>
          {group.domains.map((domain) => {
            const Icon = DOMAIN_ICONS[domain.icon] ?? Globe;
            const isActive = activeDomain === domain.id;
            const count = counts[domain.id];

            return (
              <Tooltip key={domain.id} content={tt(domain)} position="right">
                <button
                  type="button"
                  onClick={() => openForgeDomain(domain.id, { onOpenPluginModal: onOpenPlugins })}
                  aria-label={tt(domain)}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "group relative flex h-9 w-[38px] items-center justify-center rounded-lg transition-colors duration-[var(--transition-fast)]",
                    isActive
                      ? "bg-accent-soft text-accent"
                      : "text-text-tertiary hover:bg-bg-hover hover:text-text-primary",
                  )}
                >
                  {isActive ? (
                    <span className="absolute left-[-8px] top-2 bottom-2 w-[3px] rounded-full bg-accent" />
                  ) : null}
                  <Icon className="h-[18px] w-[18px]" />
                  {count ? (
                    <span className="absolute right-0.5 top-[3px] flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-[3px] text-[9px] font-bold leading-none text-white">
                      {count}
                    </span>
                  ) : null}
                </button>
              </Tooltip>
            );
          })}
        </RailGroup>
      ))}

      <div className="flex-1" />

      <Tooltip content={t('activityLog.title')} position="right">
        <button
          type="button"
          onClick={onToggleActivityLog}
          aria-label={t('activityLog.title')}
          aria-pressed={activityLogOpen}
          className={cn(
            "relative flex h-9 w-[38px] items-center justify-center rounded-lg transition-colors duration-[var(--transition-fast)]",
            activityLogOpen
              ? "bg-accent-soft text-accent"
              : "text-text-tertiary hover:bg-bg-hover hover:text-text-primary",
          )}
        >
          {activityLogOpen ? (
            <span className="absolute left-[-8px] top-2 bottom-2 w-[3px] rounded-full bg-accent" />
          ) : null}
          <Activity className="h-[18px] w-[18px]" />
        </button>
      </Tooltip>
    </div>
  );
}

function RailGroup({
  id,
  withSeparator,
  children,
}: {
  id: ForgeGroupId;
  withSeparator: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      {withSeparator ? <div className="my-1.5 h-px w-6 bg-border-default" data-rail-sep /> : null}
      <div className="flex w-full flex-col items-center gap-0.5" data-rail-group={id}>
        {children}
      </div>
    </>
  );
}
