// 图片合并工具 — 画布式编辑
//   - 模板布局（按图片数量分组）+ 横向/纵向/网格快速预设
//   - 自由拖拽 / 角点拖拽缩放（保持纵横比）/ 90° 旋转
//   - 自动吸附对齐 + 实时间距标注
//   - 响应式画布、PNG/JPEG/PDF 导出

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { open, save } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  ImagePlus,
  Save as SaveIcon,
  Rows3,
  Columns3,
  Grid2x2,
  Grid3x3,
  RotateCw,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Magnet,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { mergeImages, type MergeResult } from "@/services/toolboxService";
import { ToolboxToolPane } from "./ToolboxToolPane";

// ====== 类型 ======

type Rotation = 0 | 90 | 180 | 270;

interface MergeItem {
  id: string;
  src: string;
  url: string;
  naturalW: number;
  naturalH: number;
  /** 画布坐标系：未旋转盒子的左上角 */
  x: number;
  y: number;
  /** 渲染尺寸（旋转前）。旋转 90/270 后视觉占位会交换宽高 */
  w: number;
  h: number;
  rotation: Rotation;
}

interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface TemplateCell {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Template {
  id: string;
  /** 需要的图片数量；为 0 表示通用模板（适配任意数量） */
  count: number;
  cells: TemplateCell[];
}

// ====== 几何工具 ======

function rotatedBBox(item: MergeItem): BBox {
  if (item.rotation === 90 || item.rotation === 270) {
    return { x: item.x, y: item.y, w: item.h, h: item.w };
  }
  return { x: item.x, y: item.y, w: item.w, h: item.h };
}

function getOverallBBox(items: MergeItem[]): { minX: number; minY: number; maxX: number; maxY: number } {
  if (items.length === 0) return { minX: 0, minY: 0, maxX: 800, maxY: 600 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const item of items) {
    const b = rotatedBBox(item);
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
  }
  return { minX, minY, maxX, maxY };
}

interface GapIndicator {
  key: string;
  axis: "h" | "v";
  cx: number;
  cy: number;
  size: number;
}

function computeGapIndicators(items: MergeItem[]): GapIndicator[] {
  const boxes = items.map((it) => ({ id: it.id, ...rotatedBBox(it) }));
  const out: GapIndicator[] = [];

  for (const a of boxes) {
    let rightDist = Infinity;
    let rightTarget: typeof a | null = null;
    for (const b of boxes) {
      if (b.id === a.id) continue;
      const dist = b.x - (a.x + a.w);
      if (dist <= 0) continue;
      const yOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (yOverlap <= 0) continue;
      if (dist < rightDist) {
        rightDist = dist;
        rightTarget = b;
      }
    }
    if (rightTarget && rightDist >= 1) {
      const yStart = Math.max(a.y, rightTarget.y);
      const yEnd = Math.min(a.y + a.h, rightTarget.y + rightTarget.h);
      out.push({
        key: `h-${a.id}-${rightTarget.id}`,
        axis: "h",
        cx: a.x + a.w + rightDist / 2,
        cy: (yStart + yEnd) / 2,
        size: rightDist,
      });
    }

    let belowDist = Infinity;
    let belowTarget: typeof a | null = null;
    for (const b of boxes) {
      if (b.id === a.id) continue;
      const dist = b.y - (a.y + a.h);
      if (dist <= 0) continue;
      const xOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      if (xOverlap <= 0) continue;
      if (dist < belowDist) {
        belowDist = dist;
        belowTarget = b;
      }
    }
    if (belowTarget && belowDist >= 1) {
      const xStart = Math.max(a.x, belowTarget.x);
      const xEnd = Math.min(a.x + a.w, belowTarget.x + belowTarget.w);
      out.push({
        key: `v-${a.id}-${belowTarget.id}`,
        axis: "v",
        cx: (xStart + xEnd) / 2,
        cy: a.y + a.h + belowDist / 2,
        size: belowDist,
      });
    }
  }
  return out;
}

// ====== 通用预设布局（任意数量图片）======

const TARGET_DIM = 800;

function applyHorizontal(items: MergeItem[], gap: number): MergeItem[] {
  let x = 0;
  return items.map((item) => {
    const scale = TARGET_DIM / item.naturalH;
    const w = item.naturalW * scale;
    const next = { ...item, x, y: 0, w, h: TARGET_DIM, rotation: 0 as Rotation };
    x += w + gap;
    return next;
  });
}

function applyVertical(items: MergeItem[], gap: number): MergeItem[] {
  let y = 0;
  return items.map((item) => {
    const scale = TARGET_DIM / item.naturalW;
    const h = item.naturalH * scale;
    const next = { ...item, x: 0, y, w: TARGET_DIM, h, rotation: 0 as Rotation };
    y += h + gap;
    return next;
  });
}

function applyGridGeneric(items: MergeItem[], cols: number, gap: number): MergeItem[] {
  if (items.length === 0) return [];
  const cellW = TARGET_DIM / Math.max(1, cols);
  const rows = Math.ceil(items.length / cols);
  const scaledHeights = items.map((item) => (cellW / item.naturalW) * item.naturalH);
  const rowHeights = new Array(rows).fill(0);
  for (let i = 0; i < items.length; i++) {
    const r = Math.floor(i / cols);
    rowHeights[r] = Math.max(rowHeights[r], scaledHeights[i]);
  }
  const yOffsets = [0];
  for (let r = 1; r < rows; r++) {
    yOffsets.push(yOffsets[r - 1] + rowHeights[r - 1] + gap);
  }
  return items.map((item, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const w = cellW;
    const h = scaledHeights[i];
    const x = c * (cellW + gap);
    const y = yOffsets[r] + (rowHeights[r] - h) / 2;
    return { ...item, x, y, w, h, rotation: 0 as Rotation };
  });
}

// ====== 模板系统 ======

function templateBounds(cells: TemplateCell[]): { w: number; h: number } {
  let maxW = 0, maxH = 0;
  for (const c of cells) {
    if (c.x + c.w > maxW) maxW = c.x + c.w;
    if (c.y + c.h > maxH) maxH = c.y + c.h;
  }
  return { w: maxW || 1, h: maxH || 1 };
}

/**
 * 应用模板：把 items 的前 N 张按模板单元格布置。
 * 每张图片在单元格内按 contain 模式缩放（保持纵横比，居中）。
 * 单元格在与邻居相接的边内缩 gap/2，自动产生指定间距。
 */
function applyTemplate(template: Template, items: MergeItem[], gap: number): MergeItem[] {
  const used = items.slice(0, template.cells.length);
  if (used.length === 0) return items;
  const bounds = templateBounds(template.cells);
  const scale = TARGET_DIM / Math.max(bounds.w, bounds.h);

  const placed = used.map((item, i) => {
    const cell = template.cells[i];
    const cellX = cell.x * scale;
    const cellY = cell.y * scale;
    const cellW = cell.w * scale;
    const cellH = cell.h * scale;

    const insetLeft = cell.x > 0.001 ? gap / 2 : 0;
    const insetRight = cell.x + cell.w < bounds.w - 0.001 ? gap / 2 : 0;
    const insetTop = cell.y > 0.001 ? gap / 2 : 0;
    const insetBottom = cell.y + cell.h < bounds.h - 0.001 ? gap / 2 : 0;

    const innerX = cellX + insetLeft;
    const innerY = cellY + insetTop;
    const innerW = Math.max(1, cellW - insetLeft - insetRight);
    const innerH = Math.max(1, cellH - insetTop - insetBottom);

    const imgRatio = item.naturalW / item.naturalH;
    const cellRatio = innerW / innerH;
    let w: number, h: number;
    if (imgRatio > cellRatio) {
      w = innerW;
      h = innerW / imgRatio;
    } else {
      h = innerH;
      w = innerH * imgRatio;
    }
    const x = innerX + (innerW - w) / 2;
    const y = innerY + (innerH - h) / 2;

    return { ...item, x, y, w, h, rotation: 0 as Rotation };
  });

  // 保留未使用的 items（拼接在末尾不动它们）
  return [...placed, ...items.slice(template.cells.length)];
}

// 为简洁起见的辅助构造函数
const cell = (x: number, y: number, w: number, h: number): TemplateCell => ({ x, y, w, h });

const TEMPLATES: Template[] = [
  // ===== 1 张图 =====
  { id: "t1-single", count: 1, cells: [cell(0, 0, 1, 1)] },

  // ===== 2 张图 =====
  { id: "t2-h", count: 2, cells: [cell(0, 0, 1, 1), cell(1, 0, 1, 1)] },
  { id: "t2-v", count: 2, cells: [cell(0, 0, 1, 1), cell(0, 1, 1, 1)] },
  { id: "t2-h-2-1", count: 2, cells: [cell(0, 0, 2, 1), cell(2, 0, 1, 1)] },
  { id: "t2-h-1-2", count: 2, cells: [cell(0, 0, 1, 1), cell(1, 0, 2, 1)] },

  // ===== 3 张图 =====
  { id: "t3-h", count: 3, cells: [cell(0, 0, 1, 1), cell(1, 0, 1, 1), cell(2, 0, 1, 1)] },
  { id: "t3-v", count: 3, cells: [cell(0, 0, 1, 1), cell(0, 1, 1, 1), cell(0, 2, 1, 1)] },
  {
    id: "t3-1top-2bot",
    count: 3,
    cells: [cell(0, 0, 2, 1), cell(0, 1, 1, 1), cell(1, 1, 1, 1)],
  },
  {
    id: "t3-2top-1bot",
    count: 3,
    cells: [cell(0, 0, 1, 1), cell(1, 0, 1, 1), cell(0, 1, 2, 1)],
  },
  {
    id: "t3-1left-2right",
    count: 3,
    cells: [cell(0, 0, 1, 2), cell(1, 0, 1, 1), cell(1, 1, 1, 1)],
  },
  {
    id: "t3-2left-1right",
    count: 3,
    cells: [cell(0, 0, 1, 1), cell(0, 1, 1, 1), cell(1, 0, 1, 2)],
  },

  // ===== 4 张图 =====
  {
    id: "t4-2x2",
    count: 4,
    cells: [
      cell(0, 0, 1, 1), cell(1, 0, 1, 1),
      cell(0, 1, 1, 1), cell(1, 1, 1, 1),
    ],
  },
  {
    id: "t4-h",
    count: 4,
    cells: [cell(0, 0, 1, 1), cell(1, 0, 1, 1), cell(2, 0, 1, 1), cell(3, 0, 1, 1)],
  },
  {
    id: "t4-v",
    count: 4,
    cells: [cell(0, 0, 1, 1), cell(0, 1, 1, 1), cell(0, 2, 1, 1), cell(0, 3, 1, 1)],
  },
  {
    id: "t4-1top-3bot",
    count: 4,
    cells: [
      cell(0, 0, 3, 2),
      cell(0, 2, 1, 1), cell(1, 2, 1, 1), cell(2, 2, 1, 1),
    ],
  },
  {
    id: "t4-3top-1bot",
    count: 4,
    cells: [
      cell(0, 0, 1, 1), cell(1, 0, 1, 1), cell(2, 0, 1, 1),
      cell(0, 1, 3, 2),
    ],
  },
  {
    id: "t4-1left-3right",
    count: 4,
    cells: [
      cell(0, 0, 2, 3),
      cell(2, 0, 1, 1), cell(2, 1, 1, 1), cell(2, 2, 1, 1),
    ],
  },

  // ===== 5 张图 =====
  {
    id: "t5-h",
    count: 5,
    cells: [
      cell(0, 0, 1, 1), cell(1, 0, 1, 1), cell(2, 0, 1, 1),
      cell(3, 0, 1, 1), cell(4, 0, 1, 1),
    ],
  },
  {
    id: "t5-1top-4bot",
    count: 5,
    cells: [
      cell(0, 0, 4, 2),
      cell(0, 2, 1, 1), cell(1, 2, 1, 1), cell(2, 2, 1, 1), cell(3, 2, 1, 1),
    ],
  },
  {
    id: "t5-4top-1bot",
    count: 5,
    cells: [
      cell(0, 0, 1, 1), cell(1, 0, 1, 1), cell(2, 0, 1, 1), cell(3, 0, 1, 1),
      cell(0, 1, 4, 2),
    ],
  },
  {
    id: "t5-1left-4right-grid",
    count: 5,
    cells: [
      cell(0, 0, 2, 2),
      cell(2, 0, 1, 1), cell(3, 0, 1, 1),
      cell(2, 1, 1, 1), cell(3, 1, 1, 1),
    ],
  },
  {
    id: "t5-2top-3bot",
    count: 5,
    cells: [
      cell(0, 0, 3, 1), cell(3, 0, 3, 1),
      cell(0, 1, 2, 1), cell(2, 1, 2, 1), cell(4, 1, 2, 1),
    ],
  },

  // ===== 6 张图 =====
  {
    id: "t6-3x2",
    count: 6,
    cells: [
      cell(0, 0, 1, 1), cell(1, 0, 1, 1), cell(2, 0, 1, 1),
      cell(0, 1, 1, 1), cell(1, 1, 1, 1), cell(2, 1, 1, 1),
    ],
  },
  {
    id: "t6-2x3",
    count: 6,
    cells: [
      cell(0, 0, 1, 1), cell(1, 0, 1, 1),
      cell(0, 1, 1, 1), cell(1, 1, 1, 1),
      cell(0, 2, 1, 1), cell(1, 2, 1, 1),
    ],
  },
  {
    id: "t6-h",
    count: 6,
    cells: [
      cell(0, 0, 1, 1), cell(1, 0, 1, 1), cell(2, 0, 1, 1),
      cell(3, 0, 1, 1), cell(4, 0, 1, 1), cell(5, 0, 1, 1),
    ],
  },
  {
    id: "t6-1big-5",
    count: 6,
    cells: [
      cell(0, 0, 2, 2),
      cell(2, 0, 1, 1), cell(3, 0, 1, 1),
      cell(2, 1, 1, 1), cell(3, 1, 1, 1),
      cell(0, 2, 4, 1),
    ],
  },

  // ===== 7 张图 =====
  {
    id: "t7-1big-6",
    count: 7,
    cells: [
      cell(0, 0, 3, 2),
      cell(3, 0, 1, 1), cell(4, 0, 1, 1),
      cell(3, 1, 1, 1), cell(4, 1, 1, 1),
      cell(0, 2, 2, 1), cell(2, 2, 3, 1),
    ],
  },
  {
    id: "t7-3-4",
    count: 7,
    cells: [
      cell(0, 0, 4, 1), cell(4, 0, 4, 1), cell(8, 0, 4, 1),
      cell(0, 1, 3, 1), cell(3, 1, 3, 1), cell(6, 1, 3, 1), cell(9, 1, 3, 1),
    ],
  },
  {
    id: "t7-1top-3mid-3bot",
    count: 7,
    cells: [
      cell(0, 0, 3, 1),
      cell(0, 1, 1, 1), cell(1, 1, 1, 1), cell(2, 1, 1, 1),
      cell(0, 2, 1, 1), cell(1, 2, 1, 1), cell(2, 2, 1, 1),
    ],
  },

  // ===== 8 张图 =====
  {
    id: "t8-4x2",
    count: 8,
    cells: [
      cell(0, 0, 1, 1), cell(1, 0, 1, 1), cell(2, 0, 1, 1), cell(3, 0, 1, 1),
      cell(0, 1, 1, 1), cell(1, 1, 1, 1), cell(2, 1, 1, 1), cell(3, 1, 1, 1),
    ],
  },
  {
    id: "t8-2x4",
    count: 8,
    cells: [
      cell(0, 0, 1, 1), cell(1, 0, 1, 1),
      cell(0, 1, 1, 1), cell(1, 1, 1, 1),
      cell(0, 2, 1, 1), cell(1, 2, 1, 1),
      cell(0, 3, 1, 1), cell(1, 3, 1, 1),
    ],
  },
  {
    id: "t8-1big-7",
    count: 8,
    cells: [
      cell(0, 0, 2, 2),
      cell(2, 0, 1, 1), cell(3, 0, 1, 1),
      cell(2, 1, 1, 1), cell(3, 1, 1, 1),
      cell(0, 2, 1, 1), cell(1, 2, 1, 1), cell(2, 2, 2, 1),
    ],
  },

  // ===== 9 张图 =====
  {
    id: "t9-3x3",
    count: 9,
    cells: [
      cell(0, 0, 1, 1), cell(1, 0, 1, 1), cell(2, 0, 1, 1),
      cell(0, 1, 1, 1), cell(1, 1, 1, 1), cell(2, 1, 1, 1),
      cell(0, 2, 1, 1), cell(1, 2, 1, 1), cell(2, 2, 1, 1),
    ],
  },
  {
    id: "t9-1big-8",
    count: 9,
    cells: [
      cell(0, 0, 2, 2), cell(2, 0, 1, 1), cell(3, 0, 1, 1),
      cell(2, 1, 1, 1), cell(3, 1, 1, 1),
      cell(0, 2, 1, 1), cell(1, 2, 1, 1), cell(2, 2, 1, 1), cell(3, 2, 1, 1),
    ],
  },
];

// ====== 工具函数 ======

function loadImageDims(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error("加载失败"));
    img.src = url;
  });
}

function fileNameOf(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// ====== 主组件 ======

const CANVAS_PADDING = 24;
const SNAP_PIXELS = 10;
const MIN_ITEM_DIM = 24;

type LayoutPreset = "horizontal" | "vertical" | "grid2" | "grid3";
type ResizeCorner = "tl" | "tr" | "bl" | "br";

const PRESETS: { id: LayoutPreset; labelKey: string; icon: typeof Rows3 }[] = [
  { id: "horizontal", labelKey: "toolWorkbench.toolbox.imageMerger.layoutHorizontal", icon: Columns3 },
  { id: "vertical", labelKey: "toolWorkbench.toolbox.imageMerger.layoutVertical", icon: Rows3 },
  { id: "grid2", labelKey: "toolWorkbench.toolbox.imageMerger.layoutGrid2", icon: Grid2x2 },
  { id: "grid3", labelKey: "toolWorkbench.toolbox.imageMerger.layoutGrid3", icon: Grid3x3 },
];

type Interaction =
  | {
      kind: "drag";
      id: string;
      pointerId: number;
      startMouseX: number;
      startMouseY: number;
      startItemX: number;
      startItemY: number;
    }
  | {
      kind: "resize";
      id: string;
      pointerId: number;
      corner: ResizeCorner;
      startMouseX: number;
      startMouseY: number;
      startX: number;
      startY: number;
      startW: number;
      startH: number;
      aspect: number; // visualAspect = visW / visH
      rotated: boolean;
    }
  | null;

export function ImageMergerTool() {
  const { t } = useTranslation();
  const k = "toolWorkbench.toolbox.imageMerger";

  const [items, setItems] = useState<MergeItem[]>([]);
  const [gap, setGap] = useState(20);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [bgColor, setBgColor] = useState("#ffffff");
  const [transparent, setTransparent] = useState(false);
  const [format, setFormat] = useState<"png" | "jpeg" | "pdf">("png");
  const [jpegQuality, setJpegQuality] = useState(92);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<MergeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ====== 响应式画布尺寸 ======
  const containerRef = useRef<HTMLDivElement>(null);
  const [previewSize, setPreviewSize] = useState({ w: 800, h: 480 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(360, Math.floor(entry.contentRect.width));
        const h = Math.max(360, Math.min(680, Math.floor(w * 0.58)));
        setPreviewSize({ w, h });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 包围盒 + 画布尺寸（含 padding）
  const bbox = useMemo(() => getOverallBBox(items), [items]);
  const canvasW = useMemo(
    () => Math.max(100, bbox.maxX - bbox.minX + CANVAS_PADDING * 2),
    [bbox],
  );
  const canvasH = useMemo(
    () => Math.max(100, bbox.maxY - bbox.minY + CANVAS_PADDING * 2),
    [bbox],
  );
  const previewScale = useMemo(
    () => Math.min(previewSize.w / canvasW, previewSize.h / canvasH, 1),
    [canvasW, canvasH, previewSize],
  );

  const offsetX = -bbox.minX + CANVAS_PADDING;
  const offsetY = -bbox.minY + CANVAS_PADDING;

  const gapIndicators = useMemo(() => computeGapIndicators(items), [items]);

  // 当前数量匹配的模板
  const matchingTemplates = useMemo(() => {
    if (items.length === 0) return [];
    return TEMPLATES.filter((t) => t.count === items.length);
  }, [items.length]);

  // ====== 操作 ======

  const handleSelectImages = useCallback(async () => {
    const files = await open({
      multiple: true,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }],
    });
    if (!files) return;
    const paths = Array.isArray(files) ? files : [files];

    const loaded: MergeItem[] = await Promise.all(
      paths.map(async (path) => {
        const url = convertFileSrc(path);
        try {
          const dims = await loadImageDims(url);
          return {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            src: path,
            url,
            naturalW: dims.w,
            naturalH: dims.h,
            x: 0,
            y: 0,
            w: dims.w,
            h: dims.h,
            rotation: 0 as Rotation,
          };
        } catch {
          return null as unknown as MergeItem;
        }
      }),
    );
    const valid = loaded.filter(Boolean);
    setItems((prev) => applyHorizontal([...prev, ...valid], gap));
    setActiveTemplateId(null);
    setResult(null);
    setError(null);
  }, [gap]);

  const applyLayout = useCallback(
    (layout: LayoutPreset) => {
      setItems((prev) => {
        switch (layout) {
          case "horizontal":
            return applyHorizontal(prev, gap);
          case "vertical":
            return applyVertical(prev, gap);
          case "grid2":
            return applyGridGeneric(prev, 2, gap);
          case "grid3":
            return applyGridGeneric(prev, 3, gap);
        }
      });
      setActiveTemplateId(null);
    },
    [gap],
  );

  const applyTemplateById = useCallback(
    (templateId: string) => {
      const template = TEMPLATES.find((t) => t.id === templateId);
      if (!template) return;
      setItems((prev) => applyTemplate(template, prev, gap));
      setActiveTemplateId(templateId);
    },
    [gap],
  );

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    setSelectedId((prev) => (prev === id ? null : prev));
    setActiveTemplateId(null);
  }, []);

  const rotateItem = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const newRotation = (((it.rotation + 90) % 360) as Rotation);
        return { ...it, rotation: newRotation };
      }),
    );
    setActiveTemplateId(null);
  }, []);

  // ====== 交互（拖拽 / 缩放）状态机 ======
  const interactionRef = useRef<Interaction>(null);

  const handleItemPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, item: MergeItem) => {
      e.preventDefault();
      e.stopPropagation();
      setSelectedId(item.id);
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      interactionRef.current = {
        kind: "drag",
        id: item.id,
        pointerId: e.pointerId,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startItemX: item.x,
        startItemY: item.y,
      };
    },
    [],
  );

  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, item: MergeItem, corner: ResizeCorner) => {
      e.preventDefault();
      e.stopPropagation();
      setSelectedId(item.id);
      const target = e.currentTarget as Element;
      target.setPointerCapture?.(e.pointerId);
      const rotated = item.rotation === 90 || item.rotation === 270;
      const visW = rotated ? item.h : item.w;
      const visH = rotated ? item.w : item.h;
      interactionRef.current = {
        kind: "resize",
        id: item.id,
        pointerId: e.pointerId,
        corner,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startX: item.x,
        startY: item.y,
        startW: item.w,
        startH: item.h,
        aspect: visW / visH,
        rotated,
      };
      setActiveTemplateId(null);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const ds = interactionRef.current;
      if (!ds) return;

      if (ds.kind === "drag") {
        const dx = (e.clientX - ds.startMouseX) / previewScale;
        const dy = (e.clientY - ds.startMouseY) / previewScale;
        let newX = ds.startItemX + dx;
        let newY = ds.startItemY + dy;

        if (snapEnabled) {
          const snap = SNAP_PIXELS / previewScale;
          const dragged = items.find((it) => it.id === ds.id);
          if (dragged) {
            const future = { ...dragged, x: newX, y: newY };
            const db = rotatedBBox(future);

            for (const other of items) {
              if (other.id === ds.id) continue;
              const ob = rotatedBBox(other);

              if (Math.abs(db.x - (ob.x + ob.w + gap)) < snap) {
                newX = ob.x + ob.w + gap - (db.x - newX);
              } else if (Math.abs(db.x + db.w - (ob.x - gap)) < snap) {
                newX = ob.x - gap - db.w - (db.x - newX);
              } else if (Math.abs(db.x - ob.x) < snap) {
                newX = ob.x - (db.x - newX);
              } else if (Math.abs(db.x + db.w - (ob.x + ob.w)) < snap) {
                newX = ob.x + ob.w - db.w - (db.x - newX);
              }

              if (Math.abs(db.y - (ob.y + ob.h + gap)) < snap) {
                newY = ob.y + ob.h + gap - (db.y - newY);
              } else if (Math.abs(db.y + db.h - (ob.y - gap)) < snap) {
                newY = ob.y - gap - db.h - (db.y - newY);
              } else if (Math.abs(db.y - ob.y) < snap) {
                newY = ob.y - (db.y - newY);
              } else if (Math.abs(db.y + db.h - (ob.y + ob.h)) < snap) {
                newY = ob.y + ob.h - db.h - (db.y - newY);
              }
            }
          }
        }
        setItems((prev) => prev.map((it) => (it.id === ds.id ? { ...it, x: newX, y: newY } : it)));
        return;
      }

      if (ds.kind === "resize") {
        const dx = (e.clientX - ds.startMouseX) / previewScale;
        const dy = (e.clientY - ds.startMouseY) / previewScale;

        // 当前可视尺寸（含旋转）
        const startVisW = ds.rotated ? ds.startH : ds.startW;
        const startVisH = ds.rotated ? ds.startW : ds.startH;

        // 计算 br/tr/bl/tl 对应的可视尺寸增量
        let newVisW = startVisW;
        let newVisH = startVisH;
        switch (ds.corner) {
          case "br":
            newVisW = startVisW + dx;
            newVisH = startVisH + dy;
            break;
          case "tr":
            newVisW = startVisW + dx;
            newVisH = startVisH - dy;
            break;
          case "bl":
            newVisW = startVisW - dx;
            newVisH = startVisH + dy;
            break;
          case "tl":
            newVisW = startVisW - dx;
            newVisH = startVisH - dy;
            break;
        }

        // 保持纵横比 — 选 W/H 中变化更大的方向作为主导
        const aspect = ds.aspect;
        const ratioW = newVisW / startVisW;
        const ratioH = newVisH / startVisH;
        let scale: number;
        if (Math.abs(ratioW - 1) > Math.abs(ratioH - 1)) {
          scale = ratioW;
        } else {
          scale = ratioH;
        }
        // 限制最小尺寸
        const minScale = MIN_ITEM_DIM / Math.min(startVisW, startVisH);
        if (scale < minScale) scale = minScale;

        newVisW = startVisW * scale;
        newVisH = newVisW / aspect;

        // 更新 item.w / item.h（考虑旋转）
        const newItemW = ds.rotated ? newVisH : newVisW;
        const newItemH = ds.rotated ? newVisW : newVisH;

        // 计算锚点：相对的角不动
        // start 时角点位置（item.x/y 是未旋转盒子左上角；可视盒子也是 item.x/y）
        let newX = ds.startX;
        let newY = ds.startY;
        switch (ds.corner) {
          case "br": // 锚点 = TL，不变
            break;
          case "tr": // 锚点 = BL → 新 y = startY + (startVisH - newVisH)
            newY = ds.startY + (startVisH - newVisH);
            break;
          case "bl": // 锚点 = TR → 新 x = startX + (startVisW - newVisW)
            newX = ds.startX + (startVisW - newVisW);
            break;
          case "tl": // 锚点 = BR
            newX = ds.startX + (startVisW - newVisW);
            newY = ds.startY + (startVisH - newVisH);
            break;
        }

        setItems((prev) =>
          prev.map((it) =>
            it.id === ds.id
              ? { ...it, x: newX, y: newY, w: newItemW, h: newItemH }
              : it,
          ),
        );
      }
    },
    [items, previewScale, snapEnabled, gap],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const ds = interactionRef.current;
    if (ds && (e.currentTarget as Element).hasPointerCapture?.(ds.pointerId)) {
      (e.currentTarget as Element).releasePointerCapture?.(ds.pointerId);
    }
    interactionRef.current = null;
  }, []);

  const handleCanvasPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      setSelectedId(null);
    }
  }, []);

  // 键盘删除
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName ?? "";
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        removeItem(selectedId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, removeItem]);

  // 导出
  const handleExport = useCallback(async () => {
    if (items.length === 0) return;
    const ext = format === "jpeg" ? "jpg" : format === "pdf" ? "pdf" : "png";
    const dest = await save({
      filters: [{ name: format.toUpperCase(), extensions: [ext] }],
      defaultPath: `merged.${ext}`,
    });
    if (!dest) return;

    setProcessing(true);
    setResult(null);
    setError(null);
    try {
      const translated = items.map((it) => ({
        source: it.src,
        x: it.x + offsetX,
        y: it.y + offsetY,
        w: it.w,
        h: it.h,
        rotation: it.rotation,
      }));
      const res = await mergeImages(
        translated,
        {
          canvasW: Math.round(canvasW),
          canvasH: Math.round(canvasH),
          background: transparent ? "transparent" : bgColor,
          format,
          jpegQuality,
        },
        dest,
      );
      setResult(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setProcessing(false);
    }
  }, [items, offsetX, offsetY, canvasW, canvasH, transparent, bgColor, format, jpegQuality]);

  const canExport = items.length > 0 && !processing;

  return (
    <ToolboxToolPane variant="wide">
      {/* 顶部操作栏 */}
      <section className="flex flex-wrap items-center gap-4">
        <button onClick={handleSelectImages} className="wb-ghost-btn gap-2 px-3 py-2">
          <ImagePlus className="h-4 w-4" />
          {t(`${k}.addImages`)}
        </button>
        {items.length > 0 && (
          <>
            <span className="pf-text-sm text-text-secondary">
              {t(`${k}.itemCount`, { count: items.length })}
            </span>
            <button
              onClick={() => {
                setItems([]);
                setSelectedId(null);
                setActiveTemplateId(null);
                setResult(null);
                setError(null);
              }}
              className="pf-text-xs text-text-tertiary hover:text-text-primary"
            >
              {t(`${k}.clearAll`)}
            </button>
          </>
        )}
      </section>

      {/* 快速布局（适配任意数量） */}
      <section>
        <h3 className="mb-2 pf-text-sm font-semibold text-text-primary">{t(`${k}.layoutPresets`)}</h3>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => {
            const Icon = preset.icon;
            return (
              <button
                key={preset.id}
                onClick={() => applyLayout(preset.id)}
                disabled={items.length === 0}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border border-border-default/60 bg-bg-secondary px-3 py-2 pf-text-sm text-text-secondary transition-colors hover:border-amber-500/60 hover:bg-amber-500/10 hover:text-text-primary",
                  "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border-default/60 disabled:hover:bg-bg-secondary disabled:hover:text-text-secondary",
                )}
              >
                <Icon className="h-4 w-4" />
                {t(preset.labelKey)}
              </button>
            );
          })}
        </div>
      </section>

      {/* 模板库（按当前图片数量过滤） */}
      <section>
        <h3 className="mb-2 pf-text-sm font-semibold text-text-primary">
          {t(`${k}.templates`)}
          {items.length > 0 && (
            <span className="ml-2 pf-text-xs font-normal text-text-tertiary">
              {t(`${k}.templatesForN`, { count: items.length })}
            </span>
          )}
        </h3>
        {matchingTemplates.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border-default/60 px-4 py-3 pf-text-xs text-text-disabled">
            {items.length === 0
              ? t(`${k}.templatesEmpty`)
              : t(`${k}.templatesNone`, { count: items.length })}
          </div>
        ) : (
          <div className="flex flex-nowrap gap-2 overflow-x-auto pb-2">
            {matchingTemplates.map((tpl) => {
              const bounds = templateBounds(tpl.cells);
              const vbW = bounds.w * 24;
              const vbH = bounds.h * 24;
              const isActive = activeTemplateId === tpl.id;
              return (
                <button
                  key={tpl.id}
                  onClick={() => applyTemplateById(tpl.id)}
                  className={cn(
                    "flex shrink-0 flex-col items-center gap-1 rounded-lg border p-1.5 transition-all",
                    isActive
                      ? "border-amber-500/70 bg-amber-500/10 shadow-sm shadow-amber-500/20"
                      : "border-border-default/60 bg-bg-secondary hover:-translate-y-0.5 hover:border-amber-500/50 hover:bg-amber-500/5",
                  )}
                  title={tpl.id}
                >
                  <svg
                    viewBox={`0 0 ${vbW} ${vbH}`}
                    className="h-12 w-16"
                    preserveAspectRatio="xMidYMid meet"
                  >
                    {tpl.cells.map((c, i) => (
                      <rect
                        key={i}
                        x={c.x * 24 + 1}
                        y={c.y * 24 + 1}
                        width={c.w * 24 - 2}
                        height={c.h * 24 - 2}
                        rx={2}
                        className={cn(
                          isActive ? "fill-amber-500" : "fill-amber-500/55",
                        )}
                      />
                    ))}
                  </svg>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* 画布 */}
      <section>
        <div className="mb-2 flex items-center gap-3">
          <h3 className="pf-text-sm font-semibold text-text-primary">{t(`${k}.canvas`)}</h3>
          <span className="pf-text-xs text-text-disabled">
            {Math.round(canvasW)} × {Math.round(canvasH)} px · {(previewScale * 100).toFixed(0)}%
          </span>
        </div>
        <div
          ref={containerRef}
          className="relative flex w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-border-default/60 bg-[linear-gradient(135deg,rgba(148,163,184,0.06)_25%,transparent_25%,transparent_50%,rgba(148,163,184,0.06)_50%,rgba(148,163,184,0.06)_75%,transparent_75%,transparent)] bg-[length:16px_16px]"
          style={{ height: previewSize.h }}
        >
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 text-text-disabled">
              <Layers className="h-8 w-8" />
              <span className="pf-text-sm">{t(`${k}.canvasEmpty`)}</span>
            </div>
          ) : (
            <div
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              className="relative shadow-lg shadow-black/10 ring-1 ring-border-default/30"
              style={{
                width: canvasW * previewScale,
                height: canvasH * previewScale,
                background: transparent ? "transparent" : bgColor,
              }}
            >
              {/* 间距标注 */}
              {gapIndicators.map((g) => {
                const left = (g.cx + offsetX) * previewScale;
                const top = (g.cy + offsetY) * previewScale;
                return (
                  <div
                    key={g.key}
                    className="pointer-events-none absolute z-10"
                    style={{ left, top, transform: "translate(-50%, -50%)" }}
                  >
                    <span className="rounded bg-amber-500 px-1.5 py-px font-mono text-[10px] font-semibold leading-tight text-white shadow-md ring-1 ring-amber-600/40">
                      {Math.round(g.size)}
                    </span>
                  </div>
                );
              })}

              {items.map((item) => {
                const isSelected = selectedId === item.id;
                const rb = rotatedBBox(item);
                const left = (item.x + offsetX) * previewScale;
                const top = (item.y + offsetY) * previewScale;
                const dispW = rb.w * previewScale;
                const dispH = rb.h * previewScale;
                return (
                  <div
                    key={item.id}
                    onPointerDown={(e) => handleItemPointerDown(e, item)}
                    className={cn(
                      "group absolute cursor-move select-none transition-shadow",
                      isSelected
                        ? "outline outline-2 outline-amber-500 ring-2 ring-amber-500/30"
                        : "outline outline-1 outline-transparent hover:outline-amber-500/50",
                    )}
                    style={{ left, top, width: dispW, height: dispH }}
                  >
                    <img
                      src={item.url}
                      alt=""
                      draggable={false}
                      style={{
                        position: "absolute",
                        left: "50%",
                        top: "50%",
                        width: item.w * previewScale,
                        height: item.h * previewScale,
                        transform: `translate(-50%, -50%) rotate(${item.rotation}deg)`,
                        transformOrigin: "center",
                        pointerEvents: "none",
                        userSelect: "none",
                      }}
                    />
                    {isSelected && (
                      <>
                        {/* 工具条 */}
                        <div className="absolute -top-8 left-0 z-20 flex items-center gap-1 rounded-md bg-bg-primary/95 px-1.5 py-1 shadow-lg ring-1 ring-border-default/60 backdrop-blur">
                          <button
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              rotateItem(item.id);
                            }}
                            title={t(`${k}.rotate`)}
                            className="flex h-5 w-5 items-center justify-center rounded text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                          >
                            <RotateCw className="h-3 w-3" />
                          </button>
                          <button
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              removeItem(item.id);
                            }}
                            title={t(`${k}.remove`)}
                            className="flex h-5 w-5 items-center justify-center rounded text-rose-500 hover:bg-rose-500/10"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>

                        {/* 4 个角的缩放手柄 */}
                        {(["tl", "tr", "bl", "br"] as const).map((corner) => (
                          <div
                            key={corner}
                            onPointerDown={(e) => handleResizePointerDown(e, item, corner)}
                            className={cn(
                              "absolute z-20 h-3 w-3 rounded-sm border-2 border-white bg-amber-500 shadow",
                              corner === "tl" && "-left-1.5 -top-1.5 cursor-nwse-resize",
                              corner === "tr" && "-right-1.5 -top-1.5 cursor-nesw-resize",
                              corner === "bl" && "-bottom-1.5 -left-1.5 cursor-nesw-resize",
                              corner === "br" && "-bottom-1.5 -right-1.5 cursor-nwse-resize",
                            )}
                          />
                        ))}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* 设置 */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* 间距 + 吸附 */}
        <div className="rounded-lg border border-border-default/60 bg-bg-secondary/60 p-3">
          <h4 className="mb-2 pf-text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            {t(`${k}.gapAndSnap`)}
          </h4>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={120}
              value={gap}
              onChange={(e) => setGap(Number(e.target.value))}
              className="flex-1 accent-amber-500"
            />
            <div className="flex min-w-[64px] items-baseline justify-center gap-1 rounded-md bg-amber-500/15 px-2 py-1 ring-1 ring-amber-500/30">
              <span className="font-mono text-base font-bold leading-none text-amber-700 dark:text-amber-300">
                {gap}
              </span>
              <span className="pf-text-xs font-medium text-amber-700/70 dark:text-amber-300/70">px</span>
            </div>
          </div>
          <label className="mt-2 flex cursor-pointer items-center gap-2 pf-text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={snapEnabled}
              onChange={(e) => setSnapEnabled(e.target.checked)}
              className="accent-amber-500"
            />
            <Magnet className="h-3.5 w-3.5" />
            {t(`${k}.snapEnabled`)}
          </label>
        </div>

        {/* 背景 + 输出格式 */}
        <div className="rounded-lg border border-border-default/60 bg-bg-secondary/60 p-3">
          <h4 className="mb-2 pf-text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            {t(`${k}.backgroundAndFormat`)}
          </h4>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={bgColor}
              onChange={(e) => setBgColor(e.target.value)}
              disabled={transparent}
              className="h-7 w-10 cursor-pointer rounded border border-border-default/60 bg-transparent disabled:opacity-40"
            />
            <input
              type="text"
              value={bgColor}
              onChange={(e) => setBgColor(e.target.value)}
              disabled={transparent}
              className="w-24 rounded-md border border-border-default/60 bg-bg-primary px-2 py-1 pf-text-xs font-mono text-text-primary outline-none focus:border-amber-500/60 disabled:opacity-40"
            />
            <label className="flex cursor-pointer items-center gap-1 pf-text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={transparent}
                onChange={(e) => setTransparent(e.target.checked)}
                className="accent-amber-500"
              />
              {t(`${k}.transparent`)}
            </label>
          </div>
          <div className="mt-3 flex items-center gap-2">
            {(["png", "jpeg", "pdf"] as const).map((f) => (
              <label
                key={f}
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 pf-text-xs transition-colors",
                  format === f
                    ? "border-amber-500/60 bg-amber-500/10 text-text-primary"
                    : "border-border-default/60 bg-bg-primary text-text-secondary",
                )}
              >
                <input
                  type="radio"
                  name="merge-format"
                  checked={format === f}
                  onChange={() => setFormat(f)}
                  className="accent-amber-500"
                />
                {f.toUpperCase()}
              </label>
            ))}
            {(format === "jpeg" || format === "pdf") && (
              <div className="flex flex-1 items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={jpegQuality}
                  onChange={(e) => setJpegQuality(Number(e.target.value))}
                  className="flex-1 accent-amber-500"
                />
                <span className="w-8 pf-text-xs font-mono text-text-secondary">{jpegQuality}</span>
              </div>
            )}
          </div>
          {format === "pdf" && (
            <p className="mt-2 pf-text-xs text-text-disabled">{t(`${k}.pdfHint`)}</p>
          )}
        </div>
      </section>

      {/* 导出按钮 + 状态 */}
      <section className="flex items-center gap-4">
        <button
          onClick={handleExport}
          disabled={!canExport}
          className={cn(
            "flex items-center gap-2 rounded-lg px-5 py-2.5 pf-text-sm font-medium transition-colors",
            canExport
              ? "bg-amber-500 text-white hover:bg-amber-600"
              : "cursor-not-allowed bg-bg-secondary text-text-disabled",
          )}
        >
          {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <SaveIcon className="h-4 w-4" />}
          {processing ? t(`${k}.exporting`) : t(`${k}.export`)}
        </button>

        {result && (
          <span className="flex items-center gap-1.5 pf-text-sm text-emerald-600">
            <CheckCircle2 className="h-4 w-4" />
            {t(`${k}.exportSuccess`, { size: formatBytes(result.size) })}
          </span>
        )}
        {error && (
          <span className="flex items-center gap-1.5 pf-text-sm text-rose-600">
            <AlertCircle className="h-4 w-4" />
            {error}
          </span>
        )}
      </section>

      {/* 已选图片缩略列表 */}
      {items.length > 0 && (
        <section>
          <h3 className="mb-2 pf-text-sm font-semibold text-text-primary">{t(`${k}.imageList`)}</h3>
          <div className="flex flex-wrap gap-2">
            {items.map((item) => (
              <div
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                className={cn(
                  "group flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1 pf-text-xs transition-colors",
                  selectedId === item.id
                    ? "border-amber-500/60 bg-amber-500/10 text-text-primary"
                    : "border-border-default/60 bg-bg-secondary text-text-secondary hover:border-border-strong",
                )}
              >
                <div className="h-6 w-6 overflow-hidden rounded-sm bg-bg-primary">
                  <img src={item.url} alt="" className="h-full w-full object-cover" />
                </div>
                <span className="max-w-[140px] truncate">{fileNameOf(item.src)}</span>
                {item.rotation !== 0 && (
                  <span className="pf-text-xs text-amber-600">{item.rotation}°</span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeItem(item.id);
                  }}
                  className="opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3 text-rose-500" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </ToolboxToolPane>
  );
}
