// 工具箱工作区 — 左侧分组工具列表 + 右侧工具内容
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
  FileArchive,
  Layers,
  Image,
  FolderOpen,
  Puzzle,
  Link as LinkIcon,
} from "lucide-react";
import { usePluginStore } from "@/stores/pluginStore";
import { ScreenshotResizerTool } from "./ScreenshotResizerTool";
import { IconGeneratorTool } from "./IconGeneratorTool";
import { BatchRenamerTool } from "./BatchRenamerTool";
import { ImageCompressorTool } from "./ImageCompressorTool";
import { ImageMergerTool } from "./ImageMergerTool";
import { ImageUrlToBase64Tool } from "./ImageUrlToBase64Tool";

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
    id: "image-compressor",
    labelKey: "toolWorkbench.toolbox.imageCompressor.name",
    descKey: "toolWorkbench.toolbox.imageCompressor.desc",
    icon: FileArchive,
    group: "image",
  },
  {
    id: "image-merger",
    labelKey: "toolWorkbench.toolbox.imageMerger.name",
    descKey: "toolWorkbench.toolbox.imageMerger.desc",
    icon: Layers,
    group: "image",
  },
  {
    id: "image-url-to-base64",
    labelKey: "toolWorkbench.toolbox.imageUrlToBase64.name",
    descKey: "toolWorkbench.toolbox.imageUrlToBase64.desc",
    icon: LinkIcon,
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
    case "image-compressor": return <ImageCompressorTool />;
    case "image-merger": return <ImageMergerTool />;
    case "image-url-to-base64": return <ImageUrlToBase64Tool />;
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
  const HeaderIcon = activeToolDef?.icon ?? Puzzle;

  return (
    <PanelGroup orientation="horizontal" className="h-full">
      {/* 左侧分组工具列表 */}
      <Panel defaultSize={22} minSize="240px">
        <div className="flex h-full flex-col overflow-hidden border-r border-border-default bg-bg-sidebar">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-default px-3">
            <span className="pf-text-xs font-semibold uppercase tracking-wider text-text-tertiary">
              {t("toolWorkbench.toolbox.sidebarTitle")}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-2.5">
            {Object.entries(groups).map(([groupId, tools]) => {
              const meta = GROUP_META[groupId] ?? GROUP_META.plugin;
              const GroupIcon = meta.icon;
              return (
                <div key={groupId} className="mb-3.5">
                  {/* 分组标题 .sechead */}
                  <div className="mb-1 flex items-center gap-1.5 px-1.5 py-1">
                    <GroupIcon className="h-3 w-3 text-text-tertiary" />
                    <span className="pf-text-xxs font-semibold uppercase tracking-wider text-text-tertiary">
                      {t(meta.labelKey)}
                    </span>
                  </div>

                  <div className="flex flex-col gap-0.5">
                    {tools.map((tool) => {
                      const Icon = tool.icon;
                      const isActive = activeTool === tool.id;
                      return (
                        <button
                          key={tool.id}
                          onClick={() => setActiveTool(tool.id)}
                          title={tool.fromPlugin ? tool.labelKey : t(tool.labelKey)}
                          className={cn(
                            // .tree-row 风格：紧凑行 + 26px accent 图标方块（间距 6px / gap-1.5 对齐原型）
                            "group relative flex h-10 w-full items-center gap-1.5 rounded-[5px] px-1.5 text-left transition-colors",
                            isActive
                              ? "bg-accent-soft"
                              : "hover:bg-bg-hover"
                          )}
                        >
                          {/* sel 左侧 accent 竖条 */}
                          {isActive && (
                            <span className="absolute inset-y-[5px] left-0 w-0.5 rounded-sm bg-accent" />
                          )}
                          <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md border border-border-default bg-bg-secondary text-accent">
                            <Icon className="h-[14px] w-[14px]" />
                          </div>
                          <div className="flex min-w-0 flex-col">
                            <span
                              className={cn(
                                "truncate pf-text-xs font-medium leading-tight",
                                isActive ? "text-text-primary" : "text-text-secondary group-hover:text-text-primary"
                              )}
                            >
                              {tool.fromPlugin ? tool.labelKey : t(tool.labelKey)}
                            </span>
                            <span className="truncate pf-text-xxs leading-tight text-text-tertiary">
                              {tool.fromPlugin ? tool.descKey : t(tool.descKey)}
                            </span>
                          </div>
                          {tool.fromPlugin && (
                            <Puzzle className="ml-auto h-3 w-3 shrink-0 text-text-tertiary" />
                          )}
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
        <div className="absolute inset-y-0 left-[3px] w-px bg-border-default group-hover:bg-accent/40 transition-colors" />
      </PanelResizeHandle>

      {/* 主内容区：双向 overflow-auto — 当面板比工具内容窄时出现横向滚动条，
          内容固定宽度避免被挤压变形 */}
      <Panel defaultSize={78} minSize={40}>
        <div className="flex h-full flex-col overflow-hidden bg-bg-app">
          {/* 工具头部：accent-soft 图标方块 + 名称/副标题 */}
          {activeToolDef && (
            <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border-default px-4">
              <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <HeaderIcon className="h-4 w-4" />
              </div>
              <div className="flex min-w-0 flex-col">
                <span className="truncate pf-text-sm font-semibold text-text-primary">
                  {activeToolDef.fromPlugin ? activeToolDef.labelKey : t(activeToolDef.labelKey)}
                </span>
                <span className="truncate pf-text-xs text-text-tertiary">
                  {activeToolDef.fromPlugin ? activeToolDef.descKey : t(activeToolDef.descKey)}
                </span>
              </div>
              {activeToolDef.fromPlugin && (
                <span className="pf-pill acc ml-auto">
                  <Puzzle className="h-2.5 w-2.5" />
                  {t("toolWorkbench.toolbox.pluginTools")}
                </span>
              )}
            </div>
          )}

          <div className="flex-1 overflow-auto">
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
        </div>
      </Panel>
    </PanelGroup>
  );
});
