import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import type { MetricsSnapshot } from "@/types/loadtest";

interface MetricsChartProps {
  data: MetricsSnapshot[];
  type: "rps" | "latency" | "error" | "throughput" | "concurrency" | "scatter";
  height?: number;
}

const CHART_COLORS = {
  rps: { line: "#f43f5e", fill: "rgba(244,63,94,0.08)", text: "#f43f5e" },
  avg: { line: "#3b82f6", fill: "rgba(59,130,246,0.06)", text: "#3b82f6" },
  p95: { line: "#f59e0b", fill: "rgba(245,158,11,0.04)", text: "#f59e0b" },
  p99: { line: "#8b5cf6", fill: "rgba(139,92,246,0.04)", text: "#8b5cf6" },
  error: { line: "#ef4444", fill: "rgba(239,68,68,0.08)", text: "#ef4444" },
  throughput: { line: "#06b6d4", fill: "rgba(6,182,212,0.08)", text: "#06b6d4" },
  concurrency: { line: "#10b981", fill: "rgba(16,185,129,0.08)", text: "#10b981" },
  scatter: { dot: "#f43f5e", dotHigh: "#ef4444", bg: "rgba(244,63,94,0.03)" },
  grid: "rgba(128,128,128,0.1)",
  gridText: "rgba(128,128,128,0.5)",
  tooltip: { bg: "rgba(15,23,42,0.92)", border: "rgba(100,116,139,0.3)", text: "#e2e8f0", dim: "#94a3b8" },
};

const PAD = { top: 20, right: 16, bottom: 28, left: 56 };

export function MetricsChart({ data, type, height = 200 }: MetricsChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hoverRafRef = useRef<number | null>(null);
  const hoverIdxRef = useRef<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const dedupedData = useMemo(() => {
    if (data.length < 2) return [];

    const deduped: MetricsSnapshot[] = [];
    for (let i = 0; i < data.length; i++) {
      if (i === data.length - 1 || data[i].elapsedSecs !== data[i + 1].elapsedSecs) {
        deduped.push(data[i]);
      }
    }
    return deduped;
  }, [data]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || dedupedData.length < 2) return;

    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    if (w === 0 || container.offsetParent === null) return;
    const h = height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const chartW = w - PAD.left - PAD.right;
    const chartH = h - PAD.top - PAD.bottom;

    ctx.clearRect(0, 0, w, h);

    switch (type) {
      case "rps": drawRpsChart(ctx, dedupedData, chartW, chartH); break;
      case "latency": drawLatencyChart(ctx, dedupedData, chartW, chartH); break;
      case "error": drawErrorChart(ctx, dedupedData, chartW, chartH); break;
      case "throughput": drawThroughputChart(ctx, dedupedData, chartW, chartH); break;
      case "concurrency": drawConcurrencyChart(ctx, dedupedData, chartW, chartH); break;
      case "scatter": drawScatterChart(ctx, dedupedData, chartW, chartH); break;
    }

    // Draw tooltip overlay
    if (hoverIdx !== null && hoverIdx >= 0 && hoverIdx < dedupedData.length) {
      drawTooltipOverlay(ctx, dedupedData, hoverIdx, type, chartW, chartH, w);
    }
  }, [dedupedData, type, height, hoverIdx]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const observer = new ResizeObserver(() => draw());
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [draw]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || dedupedData.length < 2) return;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const chartW = container.clientWidth - PAD.left - PAD.right;

    if (mx < PAD.left || mx > PAD.left + chartW) {
      if (hoverIdxRef.current !== null) {
        hoverIdxRef.current = null;
        setHoverIdx(null);
      }
      return;
    }

    const ratio = (mx - PAD.left) / chartW;
    const idx = Math.max(0, Math.min(Math.round(ratio * (dedupedData.length - 1)), dedupedData.length - 1));
    if (hoverIdxRef.current === idx) return;

    hoverIdxRef.current = idx;
    if (hoverRafRef.current !== null) {
      window.cancelAnimationFrame(hoverRafRef.current);
    }
    hoverRafRef.current = window.requestAnimationFrame(() => {
      setHoverIdx(idx);
      hoverRafRef.current = null;
    });
  }, [dedupedData]);

  const handleMouseLeave = useCallback(() => {
    hoverIdxRef.current = null;
    if (hoverRafRef.current !== null) {
      window.cancelAnimationFrame(hoverRafRef.current);
      hoverRafRef.current = null;
    }
    setHoverIdx(null);
  }, []);

  useEffect(() => () => {
    if (hoverRafRef.current !== null) {
      window.cancelAnimationFrame(hoverRafRef.current);
    }
  }, []);

  return (
    <div ref={containerRef} className="w-full">
      <canvas
        ref={canvasRef}
        className="w-full cursor-crosshair"
        style={{ height }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
    </div>
  );
}

// ═══════════════════════════════════════════
//  Chart Renderers
// ═══════════════════════════════════════════

function drawRpsChart(ctx: CanvasRenderingContext2D, data: MetricsSnapshot[], chartW: number, chartH: number) {
  const values = data.map((d) => d.rps);
  const maxVal = Math.max(...values, 10) * 1.15;
  drawGrid(ctx, chartW, chartH, maxVal, data, "req/s");
  drawLine(ctx, values, chartW, chartH, maxVal, CHART_COLORS.rps.line, CHART_COLORS.rps.fill);
}

function drawLatencyChart(ctx: CanvasRenderingContext2D, data: MetricsSnapshot[], chartW: number, chartH: number) {
  const avgValues = data.map((d) => d.avgLatencyMs);
  const p95Values = data.map((d) => d.p95Ms);
  const p99Values = data.map((d) => d.p99Ms);
  const maxVal = Math.max(...p99Values, ...p95Values, ...avgValues, 10) * 1.15;

  drawGrid(ctx, chartW, chartH, maxVal, data, "ms");
  drawLine(ctx, p99Values, chartW, chartH, maxVal, CHART_COLORS.p99.line, CHART_COLORS.p99.fill, true);
  drawLine(ctx, p95Values, chartW, chartH, maxVal, CHART_COLORS.p95.line, CHART_COLORS.p95.fill, true);
  drawLine(ctx, avgValues, chartW, chartH, maxVal, CHART_COLORS.avg.line, CHART_COLORS.avg.fill);

  drawLegend(ctx, chartW, [
    { label: "Avg", color: CHART_COLORS.avg.text },
    { label: "P95", color: CHART_COLORS.p95.text },
    { label: "P99", color: CHART_COLORS.p99.text },
  ]);
}

function drawErrorChart(ctx: CanvasRenderingContext2D, data: MetricsSnapshot[], chartW: number, chartH: number) {
  const values = data.map((d, i) => {
    if (i === 0) return d.totalRequests > 0 ? (d.totalErrors / d.totalRequests) * 100 : 0;
    const reqs = d.totalRequests - data[i - 1].totalRequests;
    const errs = d.totalErrors - data[i - 1].totalErrors;
    return reqs > 0 ? (errs / reqs) * 100 : 0;
  });
  const maxVal = Math.max(...values, 5) * 1.15;
  drawGrid(ctx, chartW, chartH, maxVal, data, "%");
  drawLine(ctx, values, chartW, chartH, maxVal, CHART_COLORS.error.line, CHART_COLORS.error.fill);
}

function drawThroughputChart(ctx: CanvasRenderingContext2D, data: MetricsSnapshot[], chartW: number, chartH: number) {
  const rawValues = data.map((d) => d.bytesDownloaded);
  const maxRaw = Math.max(...rawValues, 1);
  let unit = "KB/s";
  let divisor = 1024;
  if (maxRaw > 10 * 1024 * 1024) { unit = "MB/s"; divisor = 1024 * 1024; }
  const values = rawValues.map((v) => v / divisor);
  const maxVal = Math.max(...values, 1) * 1.15;
  drawGrid(ctx, chartW, chartH, maxVal, data, unit);
  drawLine(ctx, values, chartW, chartH, maxVal, CHART_COLORS.throughput.line, CHART_COLORS.throughput.fill);
}

function drawConcurrencyChart(ctx: CanvasRenderingContext2D, data: MetricsSnapshot[], chartW: number, chartH: number) {
  const values = data.map((d) => d.activeConnections);
  const maxVal = Math.max(...values, 1) * 1.2;
  drawGrid(ctx, chartW, chartH, maxVal, data, "");
  drawStepLine(ctx, values, chartW, chartH, maxVal, CHART_COLORS.concurrency.line, CHART_COLORS.concurrency.fill);
}

function drawScatterChart(ctx: CanvasRenderingContext2D, data: MetricsSnapshot[], chartW: number, chartH: number) {
  const points: { x: number; y: number }[] = [];
  for (const snap of data) {
    if (!snap.latencyPoints || snap.latencyPoints.length === 0) continue;
    for (const lat of snap.latencyPoints) {
      points.push({ x: snap.elapsedSecs, y: lat });
    }
  }
  if (points.length === 0) return;

  const displayPoints = points.length > 2000 ? points.slice(-2000) : points;
  const maxX = Math.max(...data.map((d) => d.elapsedSecs), 1);
  const maxY = Math.max(...displayPoints.map((p) => p.y), 10) * 1.15;

  drawGrid(ctx, chartW, chartH, maxY, data, "ms");

  const allY = displayPoints.map((p) => p.y).sort((a, b) => a - b);
  const p95Idx = Math.min(Math.floor(allY.length * 0.95), allY.length - 1);
  const p95Threshold = allY[p95Idx];

  // Add jitter within each second's band for better scatter visualization
  const bandW = chartW / Math.max(maxX, 1);
  const seededRandom = (seed: number) => {
    const x = Math.sin(seed * 9301 + 49297) * 49297;
    return x - Math.floor(x);
  };
  for (let pi = 0; pi < displayPoints.length; pi++) {
    const pt = displayPoints[pi];
    const jitter = (seededRandom(pi) - 0.5) * bandW * 0.6;
    const px = PAD.left + (pt.x / maxX) * chartW + jitter;
    const py = PAD.top + chartH - (pt.y / maxY) * chartH;
    const isHigh = pt.y > p95Threshold;
    ctx.beginPath();
    ctx.arc(px, py, isHigh ? 2.5 : 1.8, 0, Math.PI * 2);
    ctx.fillStyle = isHigh ? CHART_COLORS.scatter.dotHigh : CHART_COLORS.scatter.dot;
    ctx.globalAlpha = isHigh ? 0.9 : 0.4;
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const thresholdY = PAD.top + chartH - (p95Threshold / maxY) * chartH;
  ctx.beginPath();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = CHART_COLORS.scatter.dotHigh;
  ctx.lineWidth = 1;
  ctx.moveTo(PAD.left, thresholdY);
  ctx.lineTo(PAD.left + chartW, thresholdY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = "10px Inter, system-ui, sans-serif";
  ctx.fillStyle = CHART_COLORS.scatter.dotHigh;
  ctx.textAlign = "left";
  ctx.fillText(`P95: ${p95Threshold.toFixed(0)}ms`, PAD.left + 4, thresholdY - 4);
}

// ═══════════════════════════════════════════
//  Tooltip Overlay
// ═══════════════════════════════════════════

function drawTooltipOverlay(
  ctx: CanvasRenderingContext2D,
  data: MetricsSnapshot[],
  idx: number,
  type: string,
  chartW: number,
  chartH: number,
  canvasW: number,
) {
  const snap = data[idx];
  const x = PAD.left + (idx / (data.length - 1)) * chartW;

  // Crosshair vertical line
  ctx.beginPath();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = "rgba(148,163,184,0.5)";
  ctx.lineWidth = 1;
  ctx.moveTo(x, PAD.top);
  ctx.lineTo(x, PAD.top + chartH);
  ctx.stroke();
  ctx.setLineDash([]);

  // Build tooltip lines
  const lines: { label: string; value: string; color?: string }[] = [];
  lines.push({ label: "Time", value: `${snap.elapsedSecs}s` });

  if (type === "rps") {
    lines.push({ label: "RPS", value: snap.rps.toFixed(1), color: CHART_COLORS.rps.text });
    lines.push({ label: "Reqs", value: String(snap.totalRequests) });
  } else if (type === "latency") {
    lines.push({ label: "Avg", value: `${snap.avgLatencyMs.toFixed(1)}ms`, color: CHART_COLORS.avg.text });
    lines.push({ label: "P95", value: `${snap.p95Ms}ms`, color: CHART_COLORS.p95.text });
    lines.push({ label: "P99", value: `${snap.p99Ms}ms`, color: CHART_COLORS.p99.text });
  } else if (type === "error") {
    const errPct = idx === 0
      ? snap.totalRequests > 0 ? (snap.totalErrors / snap.totalRequests) * 100 : 0
      : (() => { const prev = data[idx - 1]; const r = snap.totalRequests - prev.totalRequests; const e = snap.totalErrors - prev.totalErrors; return r > 0 ? (e / r) * 100 : 0; })();
    const windowErrors = idx === 0 ? snap.totalErrors : snap.totalErrors - data[idx - 1].totalErrors;
    lines.push({ label: "Error%", value: `${errPct.toFixed(1)}%`, color: CHART_COLORS.error.text });
    lines.push({ label: "Errors/s", value: String(windowErrors) });
  } else if (type === "throughput") {
    const bytes = snap.bytesDownloaded;
    const display = bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB/s` : `${(bytes / 1024).toFixed(1)} KB/s`;
    lines.push({ label: "Throughput", value: display, color: CHART_COLORS.throughput.text });
  } else if (type === "concurrency") {
    lines.push({ label: "Active", value: String(snap.activeConnections), color: CHART_COLORS.concurrency.text });
    lines.push({ label: "RPS", value: snap.rps.toFixed(1) });
  } else if (type === "scatter") {
    const pts = snap.latencyPoints || [];
    lines.push({ label: "Points", value: String(pts.length) });
    if (pts.length > 0) {
      const avg = pts.reduce((a, b) => a + b, 0) / pts.length;
      const max = Math.max(...pts);
      lines.push({ label: "Avg", value: `${avg.toFixed(1)}ms` });
      lines.push({ label: "Max", value: `${max.toFixed(0)}ms`, color: CHART_COLORS.scatter.dotHigh });
    }
  }

  // Draw highlight dot (for line charts)
  if (type !== "scatter") {
    const getYForIdx = (): { y: number; color: string }[] => {
      if (type === "rps") {
        const maxVal = Math.max(...data.map(d => d.rps), 10) * 1.15;
        return [{ y: PAD.top + chartH - (snap.rps / maxVal) * chartH, color: CHART_COLORS.rps.line }];
      }
      if (type === "latency") {
        const maxVal = Math.max(...data.map(d => d.p99Ms), ...data.map(d => d.p95Ms), ...data.map(d => d.avgLatencyMs), 10) * 1.15;
        return [
          { y: PAD.top + chartH - (snap.avgLatencyMs / maxVal) * chartH, color: CHART_COLORS.avg.line },
        ];
      }
      if (type === "error") {
        const vals = data.map((d, i) => {
          if (i === 0) return d.totalRequests > 0 ? (d.totalErrors / d.totalRequests) * 100 : 0;
          const r = d.totalRequests - data[i-1].totalRequests; const e = d.totalErrors - data[i-1].totalErrors;
          return r > 0 ? (e / r) * 100 : 0;
        });
        const maxVal = Math.max(...vals, 5) * 1.15;
        return [{ y: PAD.top + chartH - (vals[idx] / maxVal) * chartH, color: CHART_COLORS.error.line }];
      }
      if (type === "throughput") {
        const rawVals = data.map(d => d.bytesDownloaded);
        const maxRaw = Math.max(...rawVals, 1);
        const div = maxRaw > 10 * 1024 * 1024 ? 1024 * 1024 : 1024;
        const vals = rawVals.map(v => v / div);
        const maxVal = Math.max(...vals, 1) * 1.15;
        return [{ y: PAD.top + chartH - (vals[idx] / maxVal) * chartH, color: CHART_COLORS.throughput.line }];
      }
      if (type === "concurrency") {
        const vals = data.map(d => d.activeConnections);
        const maxVal = Math.max(...vals, 1) * 1.2;
        return [{ y: PAD.top + chartH - (vals[idx] / maxVal) * chartH, color: CHART_COLORS.concurrency.line }];
      }
      return [];
    };

    for (const dot of getYForIdx()) {
      // White ring
      ctx.beginPath();
      ctx.arc(x, dot.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fill();
      // Color dot
      ctx.beginPath();
      ctx.arc(x, dot.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = dot.color;
      ctx.fill();
    }
  }

  // Draw tooltip box
  ctx.font = "11px Inter, system-ui, sans-serif";
  const lineH = 18;
  const padX = 10;
  const padY = 8;
  const tooltipW = 130;
  const tooltipH = padY * 2 + lines.length * lineH;

  // Position: prefer right of crosshair, flip to left if near edge
  let tx = x + 12;
  if (tx + tooltipW > canvasW - 4) tx = x - tooltipW - 12;
  let ty = PAD.top + 8;

  // Background
  ctx.fillStyle = CHART_COLORS.tooltip.bg;
  ctx.beginPath();
  roundRect(ctx, tx, ty, tooltipW, tooltipH, 6);
  ctx.fill();
  ctx.strokeStyle = CHART_COLORS.tooltip.border;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Lines
  for (let i = 0; i < lines.length; i++) {
    const ly = ty + padY + i * lineH + 12;
    ctx.textAlign = "left";
    ctx.fillStyle = CHART_COLORS.tooltip.dim;
    ctx.fillText(lines[i].label, tx + padX, ly);
    ctx.textAlign = "right";
    ctx.fillStyle = lines[i].color || CHART_COLORS.tooltip.text;
    ctx.font = `600 11px Inter, system-ui, sans-serif`;
    ctx.fillText(lines[i].value, tx + tooltipW - padX, ly);
    ctx.font = "11px Inter, system-ui, sans-serif";
  }
}

// ═══════════════════════════════════════════
//  Drawing Primitives
// ═══════════════════════════════════════════

function drawGrid(
  ctx: CanvasRenderingContext2D, chartW: number, chartH: number,
  maxVal: number, data: MetricsSnapshot[], unit: string
) {
  ctx.strokeStyle = CHART_COLORS.grid;
  ctx.lineWidth = 1;
  ctx.font = "10px Inter, system-ui, sans-serif";
  ctx.fillStyle = CHART_COLORS.gridText;

  for (let i = 0; i <= 4; i++) {
    const y = PAD.top + (chartH / 4) * i;
    ctx.beginPath();
    ctx.setLineDash([3, 3]);
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(PAD.left + chartW, y);
    ctx.stroke();
    ctx.setLineDash([]);
    const val = maxVal - (maxVal / 4) * i;
    const label = val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val.toFixed(val < 10 ? 1 : 0);
    ctx.textAlign = "right";
    ctx.fillText(`${label} ${unit}`, PAD.left - 6, y + 3);
  }

  ctx.textAlign = "center";
  const step = Math.max(1, Math.floor(data.length / 6));
  const drawnSecs = new Set<number>();
  for (let i = 0; i < data.length; i += step) {
    const sec = data[i].elapsedSecs;
    if (drawnSecs.has(sec)) continue;
    drawnSecs.add(sec);
    const x = PAD.left + (i / (data.length - 1)) * chartW;
    ctx.fillText(`${sec}s`, x, PAD.top + chartH + 16);
  }
}

function drawLine(
  ctx: CanvasRenderingContext2D, values: number[],
  chartW: number, chartH: number, maxVal: number,
  strokeColor: string, fillColor: string, dashed = false
) {
  if (values.length < 2) return;
  const points = values.map((v, i) => ({
    x: PAD.left + (i / (values.length - 1)) * chartW,
    y: PAD.top + chartH - (v / maxVal) * chartH,
  }));

  ctx.beginPath();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = dashed ? 1.5 : 2;
  if (dashed) ctx.setLineDash([4, 4]);
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  if (!dashed) {
    ctx.lineTo(points[points.length - 1].x, PAD.top + chartH);
    ctx.lineTo(points[0].x, PAD.top + chartH);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
  }
}

function drawStepLine(
  ctx: CanvasRenderingContext2D, values: number[],
  chartW: number, chartH: number, maxVal: number,
  strokeColor: string, fillColor: string
) {
  if (values.length < 2) return;
  const points = values.map((v, i) => ({
    x: PAD.left + (i / (values.length - 1)) * chartW,
    y: PAD.top + chartH - (v / maxVal) * chartH,
  }));

  ctx.beginPath();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2;
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i - 1].y);
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();

  ctx.lineTo(points[points.length - 1].x, PAD.top + chartH);
  ctx.lineTo(points[0].x, PAD.top + chartH);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
}

function drawLegend(ctx: CanvasRenderingContext2D, chartW: number, items: { label: string; color: string }[]) {
  let lx = PAD.left + chartW - items.length * 52;
  ctx.font = "11px Inter, system-ui, sans-serif";
  for (const item of items) {
    ctx.fillStyle = item.color;
    ctx.beginPath();
    ctx.arc(lx, PAD.top + 8, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(item.label, lx + 10, PAD.top + 12);
    lx += 52;
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
