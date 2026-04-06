// 工具箱工作区 — 左侧工具列表 + 右侧工具内容

import { memo, useState } from "react";
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
} from "lucide-react";
import { ScreenshotResizerTool } from "./ScreenshotResizerTool";
import { IconGeneratorTool } from "./IconGeneratorTool";
import { BatchRenamerTool } from "./BatchRenamerTool";

export type ToolboxToolId = "screenshot-resizer" | "icon-generator" | "batch-renamer";

interface ToolDef {
  id: ToolboxToolId;
  labelKey: string;
  descKey: string;
  icon: typeof Smartphone;
  group: "image" | "file";
}

const TOOLS: ToolDef[] = [
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
};

export const ToolboxWorkspace = memo(function ToolboxWorkspace() {
  const { t } = useTranslation();
  const [activeTool, setActiveTool] = useState<ToolboxToolId>("screenshot-resizer");

  // 按 group 分组
  const groups = TOOLS.reduce<Record<string, ToolDef[]>>((acc, tool) => {
    (acc[tool.group] ??= []).push(tool);
    return acc;
  }, {});

  return (
    <PanelGroup orientation="horizontal" className="h-full">
      {/* 侧栏 */}
      <Panel defaultSize={18} minSize="180px">
        <div className="flex h-full flex-col overflow-hidden border-r border-border-default/60">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-default/50 px-3">
            <span className="pf-text-xs font-semibold uppercase tracking-wider text-text-tertiary">
              {t("toolWorkbench.toolbox.sidebarTitle")}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {Object.entries(groups).map(([groupId, tools]) => {
              const meta = GROUP_META[groupId];
              const GroupIcon = meta?.icon;
              return (
                <div key={groupId} className="mb-3">
                  <div className="mb-1 flex items-center gap-1.5 px-2 py-1">
                    {GroupIcon && <GroupIcon className="h-3 w-3 text-text-disabled" />}
                    <span className="pf-text-xs font-medium uppercase tracking-wider text-text-disabled">
                      {t(meta?.labelKey ?? groupId)}
                    </span>
                  </div>

                  {tools.map((tool) => {
                    const Icon = tool.icon;
                    const isActive = activeTool === tool.id;
                    return (
                      <button
                        key={tool.id}
                        onClick={() => setActiveTool(tool.id)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                          isActive
                            ? "bg-accent/10 text-text-primary"
                            : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                        )}
                      >
                        <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-orange-500" : "text-text-tertiary")} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate pf-text-sm font-medium">{t(tool.labelKey)}</div>
                          <div className="truncate pf-text-xs text-text-tertiary">{t(tool.descKey)}</div>
                        </div>
                      </button>
                    );
                  })}
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
      <Panel defaultSize={82} minSize={40}>
        <div className="h-full overflow-y-auto">
          {activeTool === "screenshot-resizer" && <ScreenshotResizerTool />}
          {activeTool === "icon-generator" && <IconGeneratorTool />}
          {activeTool === "batch-renamer" && <BatchRenamerTool />}
        </div>
      </Panel>
    </PanelGroup>
  );
});
