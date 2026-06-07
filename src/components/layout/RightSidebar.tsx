/**
 * RightSidebar — 全局右侧侧边栏（仅插件面板）
 *
 * Forge IA 下活动日志改由底部 ActivityLogDock 承载，此处只作为
 * 插件扩展点（协议解析 / 工具箱）的落点。当没有安装相关插件时整体不渲染。
 *
 * 通过 react-resizable-panels 集成到 App 布局中。
 */

import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { FileCode2, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { usePluginStore } from '@/stores/pluginStore';
import { ProtocolParserPanel } from '@/components/plugins/ProtocolParserPanel';
import { ToolboxPanel } from '@/components/plugins/ToolboxPanel';

type RightSidebarView = 'parser' | 'toolbox';

interface RightSidebarProps {
  panelCollapsed: boolean;
  onTogglePanel: () => void;
}

const parserNavItem = { id: 'parser' as RightSidebarView, icon: FileCode2, labelKey: 'rightSidebar.parser' };
const toolboxNavItem = { id: 'toolbox' as RightSidebarView, icon: Wrench, labelKey: 'rightSidebar.toolbox' };

export function RightSidebar({ panelCollapsed, onTogglePanel }: RightSidebarProps) {
  const { t } = useTranslation();
  const [activeView, setActiveView] = useState<RightSidebarView>('parser');
  const [parserInitialData, setParserInitialData] = useState<string | undefined>(undefined);

  const installedPlugins = usePluginStore((s) => s.installedPlugins);
  const hasParserPlugin = installedPlugins.some((p) => p.pluginType === 'protocol-parser');
  const hasToolboxPlugin = installedPlugins.some((p) => p.id === 'devtools-toolbox');
  const navItems = useMemo(() => {
    const items: typeof parserNavItem[] = [];
    if (hasParserPlugin) items.push(parserNavItem);
    if (hasToolboxPlugin) items.push(toolboxNavItem);
    return items;
  }, [hasParserPlugin, hasToolboxPlugin]);

  // 若当前视图对应的插件被卸载，切回第一个可用视图
  useEffect(() => {
    if (activeView === 'parser' && !hasParserPlugin) setActiveView(hasToolboxPlugin ? 'toolbox' : 'parser');
    if (activeView === 'toolbox' && !hasToolboxPlugin) setActiveView(hasParserPlugin ? 'parser' : 'toolbox');
  }, [hasParserPlugin, hasToolboxPlugin, activeView]);

  // 监听来自活动日志 / MessageLog 的解析请求
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.data) {
        setParserInitialData(detail.data);
        setActiveView('parser');
        if (panelCollapsed) onTogglePanel();
      }
    };
    window.addEventListener('parse-protocol', handler);
    return () => window.removeEventListener('parse-protocol', handler);
  }, [panelCollapsed, onTogglePanel]);

  const handleNavClick = (view: RightSidebarView) => {
    if (panelCollapsed) {
      setActiveView(view);
      onTogglePanel();
    } else if (activeView === view) {
      onTogglePanel();
    } else {
      setActiveView(view);
    }
  };

  // 没有插件落点时整体不渲染（保持 Forge 三栏 IA：rail / sidebar / workarea）
  if (navItems.length === 0) return null;

  return (
    <div className="h-full flex overflow-hidden min-w-0">
      {/* ── Detail Panel ── */}
      {!panelCollapsed && (
        <div className="flex-1 h-full flex flex-col bg-bg-sidebar overflow-hidden min-w-0">
          {activeView === 'parser' && hasParserPlugin && (
            <ProtocolParserPanel initialData={parserInitialData} className="flex-1 min-h-0" />
          )}
          {activeView === 'toolbox' && hasToolboxPlugin && <ToolboxPanel />}
        </div>
      )}

      {/* ── Icon Rail (右边缘) ── */}
      <div className="w-[48px] h-full flex flex-col items-center py-3 gap-1 bg-bg-sidebar border-l border-border-sidebar shrink-0">
        {navItems.map(({ id, icon: Icon, labelKey }) => {
          const label = t(labelKey, id === 'parser' ? '协议解析' : '工具箱');
          const isActive = activeView === id && !panelCollapsed;
          return (
            <button
              key={id}
              onClick={() => handleNavClick(id)}
              className={cn(
                'relative flex h-[34px] w-[34px] items-center justify-center pf-rounded-sm transition-all duration-150',
                isActive
                  ? 'text-accent bg-accent-soft'
                  : 'text-text-tertiary hover:bg-bg-hover hover:text-text-primary'
              )}
              title={label}
            >
              {isActive && (
                <motion.div
                  layoutId="right-sidebar-active-indicator"
                  className="absolute inset-0 pf-rounded-sm bg-accent-soft"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <Icon className={cn('relative w-[18px] h-[18px]', isActive && 'drop-shadow-sm')} strokeWidth={isActive ? 2.2 : 1.8} />
            </button>
          );
        })}
        <div className="flex-1" />
      </div>
    </div>
  );
}
