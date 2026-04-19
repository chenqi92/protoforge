// 工具箱内容统一容器 — 所有内置工具的根布局
//
// 设计要点：
//   - 默认居左：内容贴着左侧工具列表，便于视线移动
//   - 固定宽度（不是 max-width + w-full）：拖动分割线让面板变窄时
//     内容不会被挤压变形；溢出部分由父级 overflow-auto 处理（横向滚动）
//   - 两种宽度：表单类 720px / 画布类 1024px
//
// 用法：
//   <ToolboxToolPane>                  // 表单类工具
//   <ToolboxToolPane variant="wide">   // 画布/编辑类工具（如图片合并）

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  /**
   * - "form": 表单/配置类工具，固定 720px 宽
   * - "wide": 画布/编辑类工具（如图片合并），固定 1024px 宽
   */
  variant?: "form" | "wide";
  className?: string;
  children: ReactNode;
}

export function ToolboxToolPane({ variant = "form", className, children }: Props) {
  return (
    <div
      className={cn(
        // shrink-0 防止 flex 父级把它压缩；固定宽度由 variant 决定
        "flex shrink-0 flex-col p-6",
        variant === "form" ? "w-[720px] gap-6" : "w-[1024px] gap-5",
        className,
      )}
    >
      {children}
    </div>
  );
}
