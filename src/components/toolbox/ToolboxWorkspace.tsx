// 工具箱工作区 — 左侧卡片式工具列表 + 右侧工具内容
// 支持内置工具和通过插件扩展的自定义工具

import { memo, useState, useMemo } from "react";
import {
  Panel,
  Group as PanelGroup,
  Separator as PanelResizeHandle,
} from "react-resizable-panels";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  Smartphone,
  AppWindow,
  FolderEdit,
  Image,
  FolderOpen,
  Puzzle,
} from "lucide-react";
import { usePluginStore } from "@/stores/pluginStore";
import { ScreenshotResizerTool } from "./ScreenshotResizerTool";
import { IconGeneratorTool } from "./IconGeneratorTool";
import { BatchRenamerTool } from "./BatchRenamerTool";

export type ToolboxToolId = string;

export interface ToolboxToolDef {
  id: ToolboxToolId;
  labelKey: string;
  descKey: string;
  icon: typeof Smartphone;
  group: string;
  /** 由插件提供时为 true */
  fromPlugin?: boolean;
  /** 插件 ID */
  pluginId?: string;
}

// 内置工具定义
const BUILTIN_TOOLS: ToolboxToolDef[] = [
  {
    id: "screenshot-resizer",
    labelKey: "toolWorkbench.toolbox.screenshotResizer.name",
    descKey: "toolWorkbench.toolbox.screenshotResizer.desc",
    icon: Smartphone,
    group: "image",
  },
  {
    id: "icon-generator",
    labelKey: "toolWorkbench.toolbox.iconGenerator.name",
    descKey: "toolWorkbench.toolbox.iconGenerator.desc",
    icon: AppWindow,
    group: "image",
  },
  {
    id: "batch-renamer",
    labelKey: "toolWorkbench.toolbox.batchRenamer.name",
    descKey: "toolWorkbench.toolbox.batchRenamer.desc",
    icon: FolderEdit,
    group: "file",
  },
];

const GROUP_META: Record<string, { labelKey: string; icon: typeof Image }> = {
  image: { labelKey: "toolWorkbench.toolbox.imageTools", icon: Image },
  file: { labelKey: "toolWorkbench.toolbox.fileTools", icon: FolderOpen },
  plugin: { labelKey: "toolWorkbench.toolbox.pluginTools", icon: Puzzle },
};

/** 渲染内置工具内容 */
function BuiltinToolContent({ toolId }: { toolId: string }) {
  switch (toolId) {
    case "screenshot-resizer": return <ScreenshotResizerTool />;
    case "icon-generator": return <IconGeneratorTool />;
    case "batch-renamer": return <BatchRenamerTool />;
    default: return null;
  }
}

export const ToolboxWorkspace = memo(function ToolboxWorkspace() {
  const { t } = useTranslation();
  const [activeTool, setActiveTool] = useState<ToolboxToolId>("screenshot-resizer");
  const installedPlugins = usePluginStore((s) => s.installedPlugins);

  // 合并内置 + 插件提供的工具
  const allTools = useMemo(() => {
    const tools: ToolboxToolDef[] = [...BUILTIN_TOOLS];

    // 查找 toolbox-tool 类型插件（预留扩展点）
    for (const plugin of installedPlugins) {
      if ((plugin.pluginType as string) === "toolbox-tool") {
        tools.push({
          id: `plugin-${plugin.id}`,
          labelKey: plugin.name,
          descKey: plugin.description,
          icon: Puzzle,
          group: "plugin",
          fromPlugin: true,
          pluginId: plugin.id,
        });
      }
    }
    return tools;
  }, [installedPlugins]);

  // 按 group 分组
  const groups = useMemo(() => {
    return allTools.reduce<Record<string, ToolboxToolDef[]>>((acc, tool) => {
      (acc[tool.group] ??= []).push(tool);
      return acc;
    }, {});
  }, [allTools]);

  const activeToolDef = allTools.find((t) => t.id === activeTool);

  return (
    <PanelGroup orientation="horizontal" className="h-full">
      {/* 左侧卡片网格 */}
      <Panel defaultSize={22} minSize="200px">
        <div className="flex h-full flex-col overflow-hidden">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-default/50 px-3">
            <span className="pf-text-xs font-semibold uppercase tracking-wider text-text-tertiary">
              {t("toolWorkbench.toolbox.sidebarTitle")}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-2.5">
            {Object.entries(groups).map(([groupId, tools]) => {
              const meta = GROUP_META[groupId] ?? GROUP_META.plugin;
              const GroupIcon = meta.icon;
              return (
                <div key={groupId} className="mb-4">
                  <div className="mb-2 flex items-center gap-1.5 px-1">
                    <GroupIcon className="h-3 w-3 text-text-disabled" />
                    <span className="pf-text-xs font-medium uppercase tracking-wider text-text-disabled">
                      {t(meta.labelKey)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    {tools.map((tool) => {
                      const Icon = tool.icon;
                      const isActive = activeTool === tool.id;
                      return (
                        <button
                          key={tool.id}
                          onClick={() => setActiveTool(tool.id)}
                          className={cn(
                            "group flex flex-col items-center gap-1.5 pf-rounded-md border px-2 py-2.5 text-center transition-colors",
                            isActive
                              ? "border-accent/40 bg-accent/8 text-text-primary"
                              : "border-border-subtle bg-transparent hover:border-border-default hover:bg-bg-hover/60"
                          )}
                        >
                          <div className={cn(
                            "flex h-7 w-7 items-center justify-center pf-rounded-sm transition-colors",
                            isActive
                              ? "bg-accent/15 text-accent"
                              : "text-text-tertiary group-hover:text-text-secondary"
                          )}>
                            <Icon className="h-[15px] w-[15px]" />
                          </div>
                          <span className={cn(
                            "line-clamp-2 pf-text-xs font-medium leading-tight",
                            isActive ? "text-text-primary" : "text-text-secondary"
                          )}>
                            {tool.fromPlugin ? tool.labelKey : t(tool.labelKey)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Panel>

      <PanelResizeHandle className="relative w-[7px] shrink-0 cursor-col-resize group flex items-center justify-center">
        <div className="absolute inset-y-0 left-[3px] w-px bg-border-default/40 group-hover:bg-accent/40 transition-colors" />
      </PanelResizeHandle>

      {/* 主内容区 */}
      <Panel defaultSize={78} minSize={40}>
        <div className="h-full overflow-y-auto">
          {activeToolDef && !activeToolDef.fromPlugin && (
            <BuiltinToolContent toolId={activeToolDef.id} />
          )}
          {activeToolDef?.fromPlugin && (
            <div className="flex h-full items-center justify-center p-8">
              <div className="text-center">
                <Puzzle className="mx-auto mb-3 h-10 w-10 text-text-disabled" />
                <p className="pf-text-sm text-text-tertiary">
                  {activeToolDef.labelKey}
                </p>
              </div>
            </div>
          )}
        </div>
      </Panel>
    </PanelGroup>
  );
});
