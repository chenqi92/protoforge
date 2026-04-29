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
export type ToolboxAccent =
  | "sky"
  | "violet"
  | "emerald"
  | "amber"
  | "rose"
  | "slate";

export interface ToolboxToolDef {
  id: ToolboxToolId;
  labelKey: string;
  descKey: string;
  icon: typeof Smartphone;
  group: string;
  /** 视觉色调 */
  accent: ToolboxAccent;
  /** 由插件提供时为 true */
  fromPlugin?: boolean;
  /** 插件 ID */
  pluginId?: string;
}

// 每个色调对应的静态 class（Tailwind 需可静态扫描，不能动态拼接）
interface AccentStyle {
  /** 激活态：卡片渐变 + 边框 + 阴影 */
  cardActive: string;
  /** 闲置态：图标背景 + 颜色 */
  iconIdle: string;
  /** 激活态：图标背景 + 颜色 */
  iconActive: string;
  /** 顶部点缀条 */
  topBar: string;
}

// Linear aesthetic: keep colored icons as functional identifiers, drop card gradients + tinted shadows + topBar decoration.
// Active card uses neutral surface + subtle accent border tint; idle uses whisper-thin border only.
const ACCENT_STYLES: Record<ToolboxAccent, AccentStyle> = {
  sky: {
    cardActive: "border-sky-500/40 bg-sky-500/[0.04]",
    iconIdle: "bg-sky-500/10 text-sky-600 dark:text-sky-400 group-hover:bg-sky-500/15",
    iconActive: "bg-sky-500/20 text-sky-600 dark:text-sky-400",
    topBar: "bg-sky-500/70",
  },
  violet: {
    cardActive: "border-violet-500/40 bg-violet-500/[0.04]",
    iconIdle: "bg-violet-500/10 text-violet-600 dark:text-violet-400 group-hover:bg-violet-500/15",
    iconActive: "bg-violet-500/20 text-violet-600 dark:text-violet-400",
    topBar: "bg-violet-500/70",
  },
  emerald: {
    cardActive: "border-emerald-500/40 bg-emerald-500/[0.04]",
    iconIdle: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-500/15",
    iconActive: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400",
    topBar: "bg-emerald-500/70",
  },
  amber: {
    cardActive: "border-amber-500/40 bg-amber-500/[0.04]",
    iconIdle: "bg-amber-500/10 text-amber-600 dark:text-amber-400 group-hover:bg-amber-500/15",
    iconActive: "bg-amber-500/20 text-amber-600 dark:text-amber-400",
    topBar: "bg-amber-500/70",
  },
  rose: {
    cardActive: "border-rose-500/40 bg-rose-500/[0.04]",
    iconIdle: "bg-rose-500/10 text-rose-600 dark:text-rose-400 group-hover:bg-rose-500/15",
    iconActive: "bg-rose-500/20 text-rose-600 dark:text-rose-400",
    topBar: "bg-rose-500/70",
  },
  slate: {
    cardActive: "border-slate-500/40 bg-slate-500/[0.04]",
    iconIdle: "bg-slate-500/10 text-slate-600 dark:text-slate-400 group-hover:bg-slate-500/15",
    iconActive: "bg-slate-500/20 text-slate-600 dark:text-slate-400",
    topBar: "bg-slate-500/70",
  },
};

// 内置工具定义
const BUILTIN_TOOLS: ToolboxToolDef[] = [
  {
    id: "screenshot-resizer",
    labelKey: "toolWorkbench.toolbox.screenshotResizer.name",
    descKey: "toolWorkbench.toolbox.screenshotResizer.desc",
    icon: Smartphone,
    group: "image",
    accent: "sky",
  },
  {
    id: "icon-generator",
    labelKey: "toolWorkbench.toolbox.iconGenerator.name",
    descKey: "toolWorkbench.toolbox.iconGenerator.desc",
    icon: AppWindow,
    group: "image",
    accent: "violet",
  },
  {
    id: "image-compressor",
    labelKey: "toolWorkbench.toolbox.imageCompressor.name",
    descKey: "toolWorkbench.toolbox.imageCompressor.desc",
    icon: FileArchive,
    group: "image",
    accent: "emerald",
  },
  {
    id: "image-merger",
    labelKey: "toolWorkbench.toolbox.imageMerger.name",
    descKey: "toolWorkbench.toolbox.imageMerger.desc",
    icon: Layers,
    group: "image",
    accent: "amber",
  },
  {
    id: "image-url-to-base64",
    labelKey: "toolWorkbench.toolbox.imageUrlToBase64.name",
    descKey: "toolWorkbench.toolbox.imageUrlToBase64.desc",
    icon: LinkIcon,
    group: "image",
    accent: "slate",
  },
  {
    id: "batch-renamer",
    labelKey: "toolWorkbench.toolbox.batchRenamer.name",
    descKey: "toolWorkbench.toolbox.batchRenamer.desc",
    icon: FolderEdit,
    group: "file",
    accent: "rose",
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
          accent: "slate",
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
      <Panel defaultSize={22} minSize="240px">
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

                  <div className="flex flex-wrap gap-2">
                    {tools.map((tool) => {
                      const Icon = tool.icon;
                      const isActive = activeTool === tool.id;
                      const style = ACCENT_STYLES[tool.accent] ?? ACCENT_STYLES.slate;
                      return (
                        <button
                          key={tool.id}
                          onClick={() => setActiveTool(tool.id)}
                          title={tool.fromPlugin ? tool.labelKey : t(tool.labelKey)}
                          className={cn(
                            "group relative flex h-[82px] w-[104px] shrink-0 flex-col items-center justify-center gap-1.5 overflow-hidden rounded-lg border px-2 py-2 text-center transition-colors",
                            isActive
                              ? cn(style.cardActive, "text-text-primary -translate-y-px")
                              : "border-border-subtle bg-bg-secondary/40 hover:-translate-y-0.5 hover:border-border-default hover:bg-bg-hover/70 hover:shadow-sm"
                          )}
                        >
                          {/* 顶部点缀渐变条 */}
                          <span
                            className={cn(
                              "pointer-events-none absolute inset-x-0 top-0 h-[2px] transition-opacity",
                              style.topBar,
                              isActive ? "opacity-100" : "opacity-0 group-hover:opacity-60"
                            )}
                          />
                          <div
                            className={cn(
                              "flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors",
                              isActive ? style.iconActive : style.iconIdle
                            )}
                          >
                            <Icon className="h-[16px] w-[16px]" />
                          </div>
                          <span
                            className={cn(
                              "line-clamp-2 pf-text-xs font-medium leading-tight transition-colors",
                              isActive ? "text-text-primary" : "text-text-secondary group-hover:text-text-primary"
                            )}
                          >
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

      {/* 主内容区：双向 overflow-auto — 当面板比工具内容窄时出现横向滚动条，
          内容固定宽度避免被挤压变形 */}
      <Panel defaultSize={78} minSize={40}>
        <div className="h-full overflow-auto">
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
