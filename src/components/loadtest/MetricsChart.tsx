import { useRef, useEffect, useCallback } from "react";
import type { MetricsSnapshot } from "@/types/loadtest";

interface MetricsChartProps {
  data: MetricsSnapshot[];
  type: "rps" | "latency";
  height?: number;
}

const CHART_COLORS = {
  rps: { line: "#f43f5e", fill: "rgba(244,63,94,0.08)", text: "#f43f5e" },
  avg: { line: "#3b82f6", fill: "rgba(59,130,246,0.06)", text: "#3b82f6" },
  p95: { line: "#f59e0b", fill: "rgba(245,158,11,0.04)", text: "#f59e0b" },
  p99: { line: "#8b5cf6", fill: "rgba(139,92,246,0.04)", text: "#8b5cf6" },
  grid: "rgba(128,128,128,0.1)",
  gridText: "rgba(128,128,128,0.5)",
};

export function MetricsChart({ data, type, height = 200 }: MetricsChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || data.length < 2) return;

    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const pad = { top: 20, right: 16, bottom: 28, left: 56 };
    const chartW = w - pad.left - pad.right;
    const chartH = h - pad.top - pad.bottom;

    ctx.clearRect(0, 0, w, h);

    if (type === "rps") {
      drawRpsChart(ctx, data, pad, chartW, chartH);
    } else {
      drawLatencyChart(ctx, data, pad, chartW, chartH);
    }
  }, [data, type, height]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const observer = new ResizeObserver(() => draw());
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [draw]);

  return (
    <div ref={containerRef} className="w-full">
      <canvas ref={canvasRef} className="w-full" style={{ height }} />
    </div>
  );
}

function drawRpsChart(
  ctx: CanvasRenderingContext2D,
  data: MetricsSnapshot[],
  pad: { top: number; right: number; bottom: number; left: number },
  chartW: number,
  chartH: number
) {
  const values = data.map((d) => d.rps);
  const maxVal = Math.max(...values, 1) * 1.15;

  drawGrid(ctx, pad, chartW, chartH, maxVal, data, "req/s");
  drawLine(ctx, values, pad, chartW, chartH, maxVal, CHART_COLORS.rps.line, CHART_COLORS.rps.fill);
}

function drawLatencyChart(
  ctx: CanvasRenderingContext2D,
  data: MetricsSnapshot[],
  pad: { top: number; right: number; bottom: number; left: number },
  chartW: number,
  chartH: number
) {
  const avgValues = data.map((d) => d.avgLatencyMs);
  const p95Values = data.map((d) => d.p95Ms);
  const p99Values = data.map((d) => d.p99Ms);
  const maxVal = Math.max(...p99Values, ...p95Values, ...avgValues, 1) * 1.15;

  drawGrid(ctx, pad, chartW, chartH, maxVal, data, "ms");

  // Draw in reverse z-order
  drawLine(ctx, p99Values, pad, chartW, chartH, maxVal, CHART_COLORS.p99.line, CHART_COLORS.p99.fill, true);
  drawLine(ctx, p95Values, pad, chartW, chartH, maxVal, CHART_COLORS.p95.line, CHART_COLORS.p95.fill, true);
  drawLine(ctx, avgValues, pad, chartW, chartH, maxVal, CHART_COLORS.avg.line, CHART_COLORS.avg.fill);

  // Legend
  const legends = [
    { label: "Avg", color: CHART_COLORS.avg.text },
    { label: "P95", color: CHART_COLORS.p95.text },
    { label: "P99", color: CHART_COLORS.p99.text },
  ];
  let lx = pad.left + chartW - 120;
  ctx.font = "11px Inter, system-ui, sans-serif";
  for (const l of legends) {
    ctx.fillStyle = l.color;
    ctx.beginPath();
    ctx.arc(lx, pad.top + 8, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(l.label, lx + 6, pad.top + 12);
    lx += 42;
  }
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  pad: { top: number; right: number; bottom: number; left: number },
  chartW: number,
  chartH: number,
  maxVal: number,
  data: MetricsSnapshot[],
  unit: string
) {
  ctx.strokeStyle = CHART_COLORS.grid;
  ctx.lineWidth = 1;
  ctx.font = "10px Inter, system-ui, sans-serif";
  ctx.fillStyle = CHART_COLORS.gridText;

  // Y-axis grid lines (5 lines)
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (chartH / 4) * i;
    ctx.beginPath();
    ctx.setLineDash([3, 3]);
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + chartW, y);
    ctx.stroke();
    ctx.setLineDash([]);

    const val = maxVal - (maxVal / 4) * i;
    const label = val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val.toFixed(val < 10 ? 1 : 0);
    ctx.textAlign = "right";
    ctx.fillText(`${label} ${unit}`, pad.left - 6, y + 3);
  }

  // X-axis labels (seconds)
  ctx.textAlign = "center";
  const step = Math.max(1, Math.floor(data.length / 6));
  for (let i = 0; i < data.length; i += step) {
    const x = pad.left + (i / (data.length - 1)) * chartW;
    ctx.fillText(`${data[i].elapsedSecs}s`, x, pad.top + chartH + 16);
  }
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  values: number[],
  pad: { top: number; right: number; bottom: number; left: number },
  chartW: number,
  chartH: number,
  maxVal: number,
  strokeColor: string,
  fillColor: string,
  dashed = false
) {
  if (values.length < 2) return;

  const points = values.map((v, i) => ({
    x: pad.left + (i / (values.length - 1)) * chartW,
    y: pad.top + chartH - (v / maxVal) * chartH,
  }));

  ctx.beginPath();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = dashed ? 1.5 : 2;
  if (dashed) ctx.setLineDash([4, 4]);

  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    // Smooth curve using quadratic bezier
    const prev = points[i - 1];
    const curr = points[i];
    const cpx = (prev.x + curr.x) / 2;
    ctx.quadraticCurveTo(prev.x, prev.y, cpx, (prev.y + curr.y) / 2);
    if (i === points.length - 1) ctx.lineTo(curr.x, curr.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Fill area under curve (only for primary lines)
  if (!dashed) {
    ctx.lineTo(points[points.length - 1].x, pad.top + chartH);
    ctx.lineTo(points[0].x, pad.top + chartH);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
  }
}
