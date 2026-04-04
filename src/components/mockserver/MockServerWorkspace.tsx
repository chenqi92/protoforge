// Mock Server 工作区 — 路由管理 + 响应配置 + 请求日志
// 三栏布局：路由列表 | 路由编辑 | 请求日志

import { memo, useEffect, useCallback, useState, useRef } from "react";
import {
  Play, Square, Trash2, Plus, Copy, Search,
  ChevronRight, GripVertical, ToggleLeft, ToggleRight,
  Clock, ArrowUpDown, AlertCircle, Server, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import {
  useMockServerStore,
  getMockServerStoreApi,
} from "@/stores/mockServerStore";
import type { MockRoute, MockRequestLog } from "@/types/mockserver";
import {
  Panel,
  Group as PanelGroup,
  Separator as PanelResizeHandle,
} from "react-resizable-panels";

// ── HTTP Method 颜色 ──
const methodColors: Record<string, { text: string; bg: string }> = {
  GET: { text: "text-emerald-600", bg: "bg-emerald-500/15" },
  POST: { text: "text-amber-600", bg: "bg-amber-500/15" },
  PUT: { text: "text-blue-600", bg: "bg-blue-500/15" },
  DELETE: { text: "text-red-600", bg: "bg-red-500/15" },
  PATCH: { text: "text-violet-600", bg: "bg-violet-500/15" },
  HEAD: { text: "text-cyan-600", bg: "bg-cyan-500/15" },
  OPTIONS: { text: "text-gray-600", bg: "bg-gray-500/15" },
  ANY: { text: "text-pink-600", bg: "bg-pink-500/15" },
};

function getMethodColor(method?: string) {
  return methodColors[method?.toUpperCase() ?? "ANY"] ?? methodColors.ANY;
}

function statusColor(status: number): string {
  if (status < 300) return "text-emerald-600";
  if (status < 400) return "text-amber-600";
  return "text-red-500";
}

const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];

// ═══════════════════════════════════════════
//  主工作区
// ═══════════════════════════════════════════

export const MockServerWorkspace = memo(function MockServerWorkspace({
  sessionId,
}: {
  sessionId: string;
}) {
  const running = useMockServerStore(sessionId, (s) => s.running);
  const routes = useMockServerStore(sessionId, (s) => s.routes);
  const selectedRouteId = useMockServerStore(sessionId, (s) => s.selectedRouteId);
  const logs = useMockServerStore(sessionId, (s) => s.logs);
  const port = useMockServerStore(sessionId, (s) => s.port);
  const totalHits = useMockServerStore(sessionId, (s) => s.totalHits);
  const error = useMockServerStore(sessionId, (s) => s.error);

  // 初始化事件监听
  useEffect(() => {
    const store = getMockServerStoreApi(sessionId);
    const state = store.getState();
    const unlistenPromise = state.initListener();
    state.refreshStatus();

    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, [sessionId]);

  const selectedRoute = routes.find((r) => r.id === selectedRouteId) ?? null;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg-base">
      {/* 控制栏 */}
      <ControlBar sessionId={sessionId} running={running} port={port} totalHits={totalHits} error={error} routeCount={routes.length} />

      {/* 三栏布局 */}
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
        <PanelGroup orientation="horizontal">
          {/* 路由列表 */}
          <Panel id="mock-routes" defaultSize={22} minSize={15}>
            <RouteListPanel sessionId={sessionId} routes={routes} selectedRouteId={selectedRouteId} />
          </Panel>

          {/* 分割线 */}
          <PanelResizeHandle className="relative w-[7px] shrink-0 cursor-col-resize group flex items-center justify-center">
            <div className="absolute inset-y-0 left-[3px] w-px bg-border-default/40 group-hover:bg-accent/40 transition-colors" />
          </PanelResizeHandle>

          {/* 路由编辑 */}
          <Panel id="mock-editor" defaultSize={48} minSize={25}>
            <RouteEditorPanel sessionId={sessionId} route={selectedRoute} />
          </Panel>

          {/* 分割线 */}
          <PanelResizeHandle className="relative w-[7px] shrink-0 cursor-col-resize group flex items-center justify-center">
            <div className="absolute inset-y-0 left-[3px] w-px bg-border-default/40 group-hover:bg-accent/40 transition-colors" />
          </PanelResizeHandle>

          {/* 请求日志 */}
          <Panel id="mock-log" defaultSize={30} minSize={18}>
            <RequestLogPanel sessionId={sessionId} logs={logs} />
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════
//  控制栏
// ═══════════════════════════════════════════

function ControlBar({
  sessionId,
  running,
  port,
  totalHits,
  error,
  routeCount,
}: {
  sessionId: string;
  running: boolean;
  port: number;
  totalHits: number;
  error: string | null;
  routeCount: number;
}) {
  const { t } = useTranslation();
  const store = getMockServerStoreApi(sessionId);
  const [portInput, setPortInput] = useState(String(port));
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    setPortInput(String(port));
  }, [port]);

  const handleToggle = useCallback(async () => {
    const state = store.getState();
    if (state.running) {
      await state.stopServer();
    } else {
      const p = parseInt(portInput, 10) || 3100;
      setStarting(true);
      try {
        await state.startServer(p);
      } catch {
        // error already set in store
      } finally {
        setStarting(false);
      }
    }
  }, [store, portInput]);

  return (
    <div className="flex items-center gap-3 border-b border-border-primary px-4 py-2.5 bg-bg-surface">
      {/* 启动/停止按钮 */}
      <button
        onClick={handleToggle}
        disabled={starting}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-3 py-1.5 pf-text-sm font-medium transition-colors",
          running
            ? "bg-red-500/15 text-red-600 hover:bg-red-500/25"
            : "bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25",
          starting && "opacity-50 cursor-not-allowed",
        )}
      >
        {running ? (
          <>
            <Square className="h-3.5 w-3.5" />
            {t("mockServer.stop")}
          </>
        ) : (
          <>
            <Play className="h-3.5 w-3.5" />
            {starting ? t("mockServer.starting") : t("mockServer.start")}
          </>
        )}
      </button>

      {/* 端口输入 */}
      <div className="flex items-center gap-1.5">
        <span className="pf-text-xs text-text-secondary">{t("mockServer.port")}:</span>
        <input
          type="number"
          value={portInput}
          onChange={(e) => setPortInput(e.target.value)}
          disabled={running}
          className={cn(
            "w-20 rounded border border-border-primary bg-bg-input px-2 py-1 pf-text-xs text-text-primary",
            "focus:border-accent-primary focus:outline-none",
            running && "opacity-60 cursor-not-allowed",
          )}
          min={1}
          max={65535}
        />
      </div>

      {/* 状态指示 */}
      <div className="flex items-center gap-1.5">
        <div
          className={cn(
            "h-2 w-2 rounded-full",
            running ? "bg-emerald-500 animate-pulse" : "bg-gray-400",
          )}
        />
        <span className="pf-text-xs text-text-secondary">
          {running
            ? `${t("mockServer.running")} · 127.0.0.1:${port}`
            : t("mockServer.stopped")}
        </span>
      </div>

      <div className="flex-1" />

      {/* 统计 */}
      <div className="flex items-center gap-3 pf-text-xs text-text-tertiary">
        <span>
          <Zap className="inline h-3 w-3 mr-0.5" />
          {totalHits} {t("mockServer.hits")}
        </span>
        <span>
          <Server className="inline h-3 w-3 mr-0.5" />
          {routeCount} {t("mockServer.routeCount")}
        </span>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-1 pf-text-xs text-red-500">
          <AlertCircle className="h-3 w-3" />
          <span className="max-w-48 truncate">{error}</span>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
//  路由列表面板
// ═══════════════════════════════════════════

function RouteListPanel({
  sessionId,
  routes,
  selectedRouteId,
}: {
  sessionId: string;
  routes: MockRoute[];
  selectedRouteId: string | null;
}) {
  const { t } = useTranslation();
  const store = getMockServerStoreApi(sessionId);

  return (
    <div className="flex h-full flex-col overflow-hidden border-r border-border-default/50">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-border-primary px-3 py-2 shrink-0">
        <span className="pf-text-xs font-medium text-text-secondary uppercase tracking-wider">
          {t("mockServer.routeList")}
        </span>
        <button
          onClick={() => store.getState().addRoute()}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 pf-text-xs text-accent-primary hover:bg-bg-hover transition-colors"
          title={t("mockServer.addRoute")}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto min-w-0">
        {routes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4 text-center">
            <Server className="h-8 w-8 text-text-disabled mb-2" />
            <p className="pf-text-sm text-text-tertiary mb-2">
              {t("mockServer.noRoutes")}
            </p>
            <button
              onClick={() => store.getState().addRoute()}
              className="flex items-center gap-1 rounded-md bg-accent-primary/10 px-3 py-1.5 pf-text-xs text-accent-primary hover:bg-accent-primary/20 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("mockServer.addFirstRoute")}
            </button>
          </div>
        ) : (
          routes.map((route) => (
            <RouteListItem
              key={route.id}
              route={route}
              selected={route.id === selectedRouteId}
              onSelect={() => store.getState().setSelectedRoute(route.id)}
              onToggle={() =>
                store.getState().updateRoute(route.id, { enabled: !route.enabled })
              }
              onRemove={() => store.getState().removeRoute(route.id)}
              onDuplicate={() => store.getState().duplicateRoute(route.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function RouteListItem({
  route,
  selected,
  onSelect,
  onToggle,
  onRemove,
  onDuplicate,
}: {
  route: MockRoute;
  selected: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const { t } = useTranslation();
  const mc = getMethodColor(route.method);

  return (
    <div
      onClick={onSelect}
      className={cn(
        "group flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-border-subtle transition-colors min-w-0",
        selected
          ? "bg-accent-primary/8 border-l-2 border-l-accent-primary"
          : "hover:bg-bg-hover border-l-2 border-l-transparent",
        !route.enabled && "opacity-50",
      )}
    >
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={cn(
              "inline-flex items-center rounded px-1.5 py-0.5 pf-text-[10px] font-bold uppercase shrink-0",
              mc.text,
              mc.bg,
            )}
          >
            {route.method || "ANY"}
          </span>
          <span className="pf-text-xs text-text-primary truncate font-mono min-w-0">
            {route.pattern || "/"}
          </span>
        </div>
        {route.description && (
          <p className="pf-text-[10px] text-text-tertiary mt-0.5 truncate">
            {route.description}
          </p>
        )}
      </div>

      {/* 操作按钮（悬浮显示） */}
      <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
          className="p-0.5 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary"
          title={t("mockServer.duplicate")}
        >
          <Copy className="h-3 w-3" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className="p-0.5 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary"
          title={route.enabled ? t("mockServer.disable") : t("mockServer.enable")}
        >
          {route.enabled ? (
            <ToggleRight className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <ToggleLeft className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="p-0.5 rounded hover:bg-red-500/10 text-text-tertiary hover:text-red-500"
          title={t("mockServer.deleteRoute")}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {/* 状态码标记 */}
      <span className={cn("pf-text-[10px] font-mono shrink-0", statusColor(route.statusCode))}>
        {route.statusCode}
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════
//  路由编辑面板
// ═══════════════════════════════════════════

function RouteEditorPanel({
  sessionId,
  route,
}: {
  sessionId: string;
  route: MockRoute | null;
}) {
  const { t } = useTranslation();
  const store = getMockServerStoreApi(sessionId);
  const running = useMockServerStore(sessionId, (s) => s.running);

  const update = useCallback(
    (patch: Partial<MockRoute>) => {
      if (!route) return;
      store.getState().updateRoute(route.id, patch);
    },
    [store, route],
  );

  // 路由变更时同步到服务器
  const syncTimeout = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!running) return;
    clearTimeout(syncTimeout.current);
    syncTimeout.current = setTimeout(() => {
      store.getState().syncRoutesToServer();
    }, 500);
    return () => clearTimeout(syncTimeout.current);
  }, [route, running, store]);

  if (!route) {
    return (
      <div className="flex h-full items-center justify-center text-text-tertiary">
        <div className="text-center">
          <ArrowUpDown className="h-8 w-8 mx-auto mb-2 text-text-disabled" />
          <p className="pf-text-sm">{t("mockServer.selectRoute")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 头部 */}
      <div className="border-b border-border-primary px-4 py-2 shrink-0">
        <span className="pf-text-xs font-medium text-text-secondary uppercase tracking-wider">
          {t("mockServer.routeConfig")}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 方法 + 路径 */}
        <div>
          <label className="pf-text-xs text-text-secondary mb-1 block">
            {t("mockServer.methodAndPath")}
          </label>
          <div className="flex gap-2">
            <select
              value={route.method ?? ""}
              onChange={(e) =>
                update({ method: e.target.value || undefined })
              }
              className="w-28 shrink-0 rounded border border-border-primary bg-bg-input px-2 py-1.5 pf-text-xs text-text-primary focus:border-accent-primary focus:outline-none"
            >
              <option value="">ANY</option>
              {HTTP_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={route.pattern}
              onChange={(e) => update({ pattern: e.target.value })}
              placeholder="/api/users/:id"
              className="flex-1 min-w-0 rounded border border-border-primary bg-bg-input px-2 py-1.5 pf-text-xs text-text-primary font-mono focus:border-accent-primary focus:outline-none"
            />
          </div>
        </div>

        {/* 描述 */}
        <div>
          <label className="pf-text-xs text-text-secondary mb-1 block">
            {t("mockServer.description")}
          </label>
          <input
            type="text"
            value={route.description}
            onChange={(e) => update({ description: e.target.value })}
            placeholder={t("mockServer.descPlaceholder")}
            className="w-full rounded border border-border-primary bg-bg-input px-2 py-1.5 pf-text-xs text-text-primary focus:border-accent-primary focus:outline-none"
          />
        </div>

        {/* 状态码 + 延迟 + 优先级 */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="pf-text-xs text-text-secondary mb-1 block">
              {t("mockServer.statusCode")}
            </label>
            <input
              type="number"
              value={route.statusCode}
              onChange={(e) => update({ statusCode: parseInt(e.target.value, 10) || 200 })}
              className="w-full rounded border border-border-primary bg-bg-input px-2 py-1.5 pf-text-xs text-text-primary focus:border-accent-primary focus:outline-none"
              min={100}
              max={599}
            />
          </div>
          <div className="flex-1">
            <label className="pf-text-xs text-text-secondary mb-1 block">
              <Clock className="inline h-3 w-3 mr-0.5" />
              {t("mockServer.delay")}
            </label>
            <input
              type="number"
              value={route.delayMs ?? ""}
              onChange={(e) =>
                update({
                  delayMs: e.target.value ? parseInt(e.target.value, 10) : undefined,
                })
              }
              placeholder="0"
              className="w-full rounded border border-border-primary bg-bg-input px-2 py-1.5 pf-text-xs text-text-primary focus:border-accent-primary focus:outline-none"
              min={0}
              max={60000}
            />
          </div>
          <div className="flex-1">
            <label className="pf-text-xs text-text-secondary mb-1 block">
              {t("mockServer.priority")}
            </label>
            <input
              type="number"
              value={route.priority}
              onChange={(e) => update({ priority: parseInt(e.target.value, 10) || 0 })}
              className="w-full rounded border border-border-primary bg-bg-input px-2 py-1.5 pf-text-xs text-text-primary focus:border-accent-primary focus:outline-none"
            />
          </div>
        </div>

        {/* 响应头 */}
        <div>
          <label className="pf-text-xs text-text-secondary mb-1 block">
            {t("mockServer.responseHeaders")}
          </label>
          <ResponseHeadersEditor
            headers={route.headers}
            onChange={(headers) => update({ headers })}
          />
        </div>

        {/* 响应体 */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="pf-text-xs text-text-secondary">
              {t("mockServer.responseBody")}
            </label>
            <TemplateHelpTip />
          </div>
          <textarea
            value={route.bodyTemplate}
            onChange={(e) => update({ bodyTemplate: e.target.value })}
            placeholder={'{\n  "message": "Hello"\n}'}
            className="w-full h-64 rounded border border-border-primary bg-bg-input px-3 py-2 pf-text-xs text-text-primary font-mono focus:border-accent-primary focus:outline-none resize-y"
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  );
}

// ── 响应头编辑器 ──
function ResponseHeadersEditor({
  headers,
  onChange,
}: {
  headers: Record<string, string>;
  onChange: (headers: Record<string, string>) => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<{ _id: string; key: string; value: string }[]>(() =>
    Object.entries(headers).map(([key, value]) => ({ _id: crypto.randomUUID(), key, value })),
  );

  const prevHeadersRef = useRef(headers);
  useEffect(() => {
    if (prevHeadersRef.current !== headers) {
      prevHeadersRef.current = headers;
      setRows(Object.entries(headers).map(([key, value]) => ({ _id: crypto.randomUUID(), key, value })));
    }
  }, [headers]);

  const commit = (newRows: typeof rows) => {
    setRows(newRows);
    const result: Record<string, string> = {};
    for (const row of newRows) {
      if (row.key) result[row.key] = row.value;
    }
    prevHeadersRef.current = result;
    onChange(result);
  };

  return (
    <div className="space-y-1">
      {rows.map((row) => (
        <div key={row._id} className="flex gap-1">
          <input
            type="text"
            value={row.key}
            onChange={(e) => commit(rows.map((r) => (r._id === row._id ? { ...r, key: e.target.value } : r)))}
            placeholder={t("mockServer.headerName")}
            className="flex-1 rounded border border-border-primary bg-bg-input px-2 py-1 pf-text-[11px] text-text-primary font-mono focus:border-accent-primary focus:outline-none"
          />
          <input
            type="text"
            value={row.value}
            onChange={(e) => commit(rows.map((r) => (r._id === row._id ? { ...r, value: e.target.value } : r)))}
            placeholder={t("mockServer.headerValue")}
            className="flex-1 rounded border border-border-primary bg-bg-input px-2 py-1 pf-text-[11px] text-text-primary font-mono focus:border-accent-primary focus:outline-none"
          />
          <button
            onClick={() => commit(rows.filter((r) => r._id !== row._id))}
            className="p-1 rounded hover:bg-red-500/10 text-text-tertiary hover:text-red-500"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
      <button
        onClick={() => commit([...rows, { _id: crypto.randomUUID(), key: "", value: "" }])}
        className="flex items-center gap-1 pf-text-[11px] text-accent-primary hover:text-accent-primary/80"
      >
        <Plus className="h-3 w-3" />
        {t("mockServer.addHeader")}
      </button>
    </div>
  );
}

// ── 模板变量提示 ──
function TemplateHelpTip() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="pf-text-[10px] text-accent-primary hover:text-accent-primary/80 flex items-center gap-0.5"
      >
        <Zap className="h-3 w-3" />
        {t("mockServer.templateVars")}
      </button>
      {open && (
        <div className="absolute right-0 top-5 z-50 w-72 rounded-md border border-border-primary bg-bg-surface shadow-lg p-3 pf-text-[10px] text-text-secondary">
          <div className="space-y-1.5">
            <p className="font-medium text-text-primary mb-1">{t("mockServer.tplRequestCtx")}:</p>
            <code className="block text-accent-primary">{"{{request.method}}"}</code>
            <code className="block text-accent-primary">{"{{request.path}}"}</code>
            <code className="block text-accent-primary">{"{{request.params.<name>}}"}</code>
            <code className="block text-accent-primary">{"{{request.query.<name>}}"}</code>
            <code className="block text-accent-primary">{"{{request.headers.<name>}}"}</code>
            <code className="block text-accent-primary">{"{{request.body}}"}</code>

            <p className="font-medium text-text-primary mt-2 mb-1">{t("mockServer.tplDynamic")}:</p>
            <code className="block text-accent-primary">{"{{$randomUUID}}"}</code>
            <code className="block text-accent-primary">{"{{$timestamp}}"}</code>
            <code className="block text-accent-primary">{"{{$isoTimestamp}}"}</code>
            <code className="block text-accent-primary">{"{{$randomInt}}"} / {"{{$randomInt(1,100)}}"}</code>
            <code className="block text-accent-primary">{"{{$randomFloat}}"} {"{{$randomBoolean}}"}</code>

            <p className="font-medium text-text-primary mt-2 mb-1">Faker:</p>
            <code className="block text-accent-primary">{"{{$faker.name}}"} {"{{$faker.email}}"}</code>
            <code className="block text-accent-primary">{"{{$faker.phone}}"} {"{{$faker.company}}"}</code>

            <p className="font-medium text-text-primary mt-2 mb-1">{t("mockServer.tplRoutePatterns")}:</p>
            <code className="block text-text-secondary">/users/:id</code>
            <code className="block text-text-secondary">/api/*/detail</code>
            <code className="block text-text-secondary">/api/**</code>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
//  请求日志面板
// ═══════════════════════════════════════════

function RequestLogPanel({
  sessionId,
  logs,
}: {
  sessionId: string;
  logs: MockRequestLog[];
}) {
  const { t } = useTranslation();
  const store = getMockServerStoreApi(sessionId);
  const listRef = useRef<HTMLDivElement>(null);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [logs.length]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-border-primary px-3 py-2 shrink-0">
        <span className="pf-text-xs font-medium text-text-secondary uppercase tracking-wider">
          {t("mockServer.requestLog")}
          {logs.length > 0 && (
            <span className="ml-1.5 text-text-tertiary">({logs.length})</span>
          )}
        </span>
        <button
          onClick={() => store.getState().clearLogs()}
          className="p-1 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors"
          title={t("mockServer.clearLog")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 日志列表 */}
      <div ref={listRef} className="flex-1 overflow-y-auto min-w-0">
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-tertiary">
            <Search className="h-6 w-6 text-text-disabled mb-1.5" />
            <p className="pf-text-xs">{t("mockServer.noLogs")}</p>
            <p className="pf-text-[10px] mt-0.5">{t("mockServer.noLogsHint")}</p>
          </div>
        ) : (
          logs.map((log) => {
            const mc = getMethodColor(log.method);
            return (
              <div
                key={log.id}
                onClick={() => setSelectedLogId(log.id === selectedLogId ? null : log.id)}
                className={cn(
                  "px-3 py-1.5 border-b border-border-subtle cursor-pointer transition-colors",
                  log.id === selectedLogId ? "bg-accent-primary/8" : "hover:bg-bg-hover",
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "inline-flex rounded px-1 py-0.5 pf-text-[9px] font-bold uppercase shrink-0",
                      mc.text,
                      mc.bg,
                    )}
                  >
                    {log.method}
                  </span>
                  <span className="pf-text-[11px] text-text-primary font-mono truncate flex-1 min-w-0">
                    {log.path}
                    {log.query && <span className="text-text-tertiary">?{log.query}</span>}
                  </span>
                  <span className={cn("pf-text-[10px] font-mono shrink-0", statusColor(log.responseStatus))}>
                    {log.responseStatus}
                  </span>
                  <span className="pf-text-[10px] text-text-tertiary shrink-0">
                    {log.durationMs}ms
                  </span>
                </div>
                {log.matchedPattern && (
                  <div className="pf-text-[10px] text-text-tertiary mt-0.5">
                    <ChevronRight className="inline h-2.5 w-2.5" />
                    {log.matchedPattern}
                    {log.delayMs > 0 && (
                      <span className="ml-1 text-amber-500">
                        <Clock className="inline h-2.5 w-2.5" /> +{log.delayMs}ms
                      </span>
                    )}
                  </div>
                )}

                {/* 展开的详情 */}
                {log.id === selectedLogId && (
                  <div className="mt-2 p-2 rounded bg-bg-base border border-border-subtle pf-text-[10px]">
                    <div className="mb-1 text-text-secondary font-medium">{t("mockServer.logResponseBody")}:</div>
                    <pre className="whitespace-pre-wrap break-all text-text-primary font-mono max-h-32 overflow-y-auto">
                      {formatJsonSafe(log.responseBody)}
                    </pre>
                    {log.requestBody && (
                      <>
                        <div className="mt-2 mb-1 text-text-secondary font-medium">{t("mockServer.logRequestBody")}:</div>
                        <pre className="whitespace-pre-wrap break-all text-text-primary font-mono max-h-24 overflow-y-auto">
                          {formatJsonSafe(log.requestBody)}
                        </pre>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function formatJsonSafe(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}
