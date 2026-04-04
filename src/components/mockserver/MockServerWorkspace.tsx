// Mock Server 工作区 — 路由管理 + 响应配置 + 请求日志
// 三栏布局：路由列表 | 路由编辑 | 请求日志

import { memo, useEffect, useCallback, useState, useRef } from "react";
import {
  Play, Square, Trash2, Plus, Copy, Search,
  ChevronRight, GripVertical, ToggleLeft, ToggleRight,
  Clock, ArrowUpDown, AlertCircle, Server, Zap,
  Download, Upload, Globe, Code, ListOrdered, Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import {
  useMockServerStore,
  getMockServerStoreApi,
} from "@/stores/mockServerStore";
import type { MockRoute, MockRequestLog, MockExample, SequenceItem, MatchCondition } from "@/types/mockserver";
import { createEmptyExample, createEmptySequenceItem } from "@/types/mockserver";
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
  const proxyTarget = useMockServerStore(sessionId, (s) => s.proxyTarget);

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
      <ControlBar sessionId={sessionId} running={running} port={port} totalHits={totalHits} error={error} routeCount={routes.length} proxyTarget={proxyTarget} />

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
  proxyTarget,
}: {
  sessionId: string;
  running: boolean;
  port: number;
  totalHits: number;
  error: string | null;
  routeCount: number;
  proxyTarget: string;
}) {
  const { t } = useTranslation();
  const store = getMockServerStoreApi(sessionId);
  const [portInput, setPortInput] = useState(String(port));
  const [starting, setStarting] = useState(false);
  const [showProxy, setShowProxy] = useState(!!proxyTarget);

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

  const handleExport = useCallback(() => {
    const routes = store.getState().exportRoutes();
    const json = JSON.stringify(routes, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mock-routes-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [store]);

  const handleImport = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) return;
        // 基本校验：每项必须有 id, pattern, statusCode
        const valid = parsed.every(
          (r: unknown) =>
            typeof r === "object" && r !== null &&
            "pattern" in r && "statusCode" in r
        );
        if (!valid) {
          console.error("导入失败: JSON 格式不符合 MockRoute 结构");
          return;
        }
        // 确保每条路由都有 id 和新增字段的默认值
        const routes = parsed.map((r: Record<string, unknown>) => ({
          id: (r.id as string) || crypto.randomUUID(),
          method: r.method ?? "GET",
          pattern: r.pattern ?? "/",
          statusCode: r.statusCode ?? 200,
          headers: r.headers ?? {},
          bodyTemplate: r.bodyTemplate ?? "",
          delayMs: r.delayMs,
          priority: r.priority ?? 0,
          enabled: r.enabled ?? true,
          description: r.description ?? "",
          examples: r.examples ?? [],
          script: r.script,
          sequence: r.sequence ?? [],
          sequenceLoop: r.sequenceLoop ?? true,
        }));
        store.getState().importRoutes(routes);
      } catch (e) {
        console.error("导入失败:", e);
      }
    };
    input.click();
  }, [store]);

  return (
    <div className="flex flex-col border-b border-border-primary bg-bg-surface">
      <div className="flex items-center gap-3 px-4 py-2">
        {/* 启动/停止 */}
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
          {running ? <><Square className="h-3.5 w-3.5" />{t("mockServer.stop")}</> : <><Play className="h-3.5 w-3.5" />{starting ? t("mockServer.starting") : t("mockServer.start")}</>}
        </button>

        {/* 端口 */}
        <div className="flex items-center gap-1.5">
          <span className="pf-text-xs text-text-secondary">{t("mockServer.port")}:</span>
          <input
            type="number"
            value={portInput}
            onChange={(e) => setPortInput(e.target.value)}
            disabled={running}
            className={cn("w-20 rounded border border-border-primary bg-bg-input px-2 py-1 pf-text-xs text-text-primary focus:border-accent-primary focus:outline-none", running && "opacity-60 cursor-not-allowed")}
            min={1} max={65535}
          />
        </div>

        {/* 状态指示 */}
        <div className="flex items-center gap-1.5">
          <div className={cn("h-2 w-2 rounded-full", running ? "bg-emerald-500 animate-pulse" : "bg-gray-400")} />
          <span className="pf-text-xs text-text-secondary">
            {running ? `${t("mockServer.running")} · 127.0.0.1:${port}` : t("mockServer.stopped")}
          </span>
        </div>

        <div className="flex-1" />

        {/* 导入/导出 */}
        <button onClick={handleImport} className="p-1 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary" title={t("mockServer.import")}>
          <Upload className="h-3.5 w-3.5" />
        </button>
        <button onClick={handleExport} className="p-1 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary" title={t("mockServer.export")}>
          <Download className="h-3.5 w-3.5" />
        </button>

        {/* 代理开关 */}
        <button
          onClick={() => setShowProxy(!showProxy)}
          className={cn("p-1 rounded hover:bg-bg-hover transition-colors", proxyTarget ? "text-emerald-500" : "text-text-tertiary hover:text-text-primary")}
          title={t("mockServer.proxyTarget")}
        >
          <Globe className="h-3.5 w-3.5" />
        </button>

        {/* 统计 */}
        <div className="flex items-center gap-3 pf-text-xs text-text-tertiary">
          <span><Zap className="inline h-3 w-3 mr-0.5" />{totalHits} {t("mockServer.hits")}</span>
          <span><Server className="inline h-3 w-3 mr-0.5" />{routeCount} {t("mockServer.routeCount")}</span>
        </div>

        {error && (
          <div className="flex items-center gap-1 pf-text-xs text-red-500">
            <AlertCircle className="h-3 w-3" />
            <span className="max-w-48 truncate">{error}</span>
          </div>
        )}
      </div>

      {/* 代理转发输入行 */}
      {showProxy && (
        <ProxyTargetInput sessionId={sessionId} proxyTarget={proxyTarget} />
      )}
    </div>
  );
}

// ── 代理转发输入（本地状态 + blur 提交，避免每键一次 IPC）──
function ProxyTargetInput({ sessionId, proxyTarget }: { sessionId: string; proxyTarget: string }) {
  const { t } = useTranslation();
  const store = getMockServerStoreApi(sessionId);
  const [localValue, setLocalValue] = useState(proxyTarget);

  useEffect(() => { setLocalValue(proxyTarget); }, [proxyTarget]);

  const commit = () => {
    if (localValue !== proxyTarget) {
      void store.getState().setProxyTarget(localValue);
    }
  };

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-t border-border-subtle bg-bg-base/50">
      <Globe className="h-3 w-3 text-text-tertiary shrink-0" />
      <span className="pf-text-xs text-text-secondary shrink-0">{t("mockServer.proxyTarget")}:</span>
      <input
        type="text"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
        placeholder="https://api.example.com"
        className="flex-1 min-w-0 rounded border border-border-primary bg-bg-input px-2 py-1 pf-text-xs text-text-primary font-mono focus:border-accent-primary focus:outline-none"
      />
      <span className="pf-text-[10px] text-text-tertiary shrink-0">{t("mockServer.proxyHint")}</span>
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

type EditorTab = "response" | "examples" | "sequence" | "script";

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
  const [activeTab, setActiveTab] = useState<EditorTab>("response");

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

  const tabs: { id: EditorTab; label: string; icon: typeof Layers; badge?: number }[] = [
    { id: "response", label: t("mockServer.tabResponse"), icon: Server },
    { id: "examples", label: t("mockServer.tabExamples"), icon: Layers, badge: route.examples.length },
    { id: "sequence", label: t("mockServer.tabSequence"), icon: ListOrdered, badge: route.sequence.length },
    { id: "script", label: t("mockServer.tabScript"), icon: Code, badge: route.script ? 1 : 0 },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 方法 + 路径 (始终显示) */}
      <div className="border-b border-border-primary px-4 py-2 shrink-0 space-y-2">
        <div className="flex gap-2">
          <select
            value={route.method ?? ""}
            onChange={(e) => update({ method: e.target.value || undefined })}
            className="w-28 shrink-0 rounded border border-border-primary bg-bg-input px-2 py-1.5 pf-text-xs text-text-primary focus:border-accent-primary focus:outline-none"
          >
            <option value="">ANY</option>
            {HTTP_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <input
            type="text"
            value={route.pattern}
            onChange={(e) => update({ pattern: e.target.value })}
            placeholder="/api/users/:id"
            className="flex-1 min-w-0 rounded border border-border-primary bg-bg-input px-2 py-1.5 pf-text-xs text-text-primary font-mono focus:border-accent-primary focus:outline-none"
          />
        </div>
        {/* Tab 切换 */}
        <div className="flex gap-0.5">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 rounded pf-text-[11px] transition-colors",
                  activeTab === tab.id
                    ? "bg-accent-primary/10 text-accent-primary font-medium"
                    : "text-text-tertiary hover:text-text-primary hover:bg-bg-hover",
                )}
              >
                <Icon className="h-3 w-3" />
                {tab.label}
                {(tab.badge ?? 0) > 0 && (
                  <span className="ml-0.5 px-1 py-0 rounded-full bg-accent-primary/20 text-accent-primary pf-text-[9px] font-bold">
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === "response" && (
          <ResponseTabContent route={route} update={update} />
        )}
        {activeTab === "examples" && (
          <ExamplesTabContent route={route} update={update} />
        )}
        {activeTab === "sequence" && (
          <SequenceTabContent route={route} update={update} />
        )}
        {activeTab === "script" && (
          <ScriptTabContent route={route} update={update} />
        )}
      </div>
    </div>
  );
}

// ── Response Tab ──
function ResponseTabContent({ route, update }: { route: MockRoute; update: (p: Partial<MockRoute>) => void }) {
  const { t } = useTranslation();
  return (
    <>
      <div>
        <label className="pf-text-xs text-text-secondary mb-1 block">{t("mockServer.description")}</label>
        <input type="text" value={route.description} onChange={(e) => update({ description: e.target.value })} placeholder={t("mockServer.descPlaceholder")}
          className="w-full rounded border border-border-primary bg-bg-input px-2 py-1.5 pf-text-xs text-text-primary focus:border-accent-primary focus:outline-none" />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="pf-text-xs text-text-secondary mb-1 block">{t("mockServer.statusCode")}</label>
          <input type="number" value={route.statusCode} onChange={(e) => update({ statusCode: parseInt(e.target.value, 10) || 200 })} min={100} max={599}
            className="w-full rounded border border-border-primary bg-bg-input px-2 py-1.5 pf-text-xs text-text-primary focus:border-accent-primary focus:outline-none" />
        </div>
        <div className="flex-1">
          <label className="pf-text-xs text-text-secondary mb-1 block"><Clock className="inline h-3 w-3 mr-0.5" />{t("mockServer.delay")}</label>
          <input type="number" value={route.delayMs ?? ""} onChange={(e) => update({ delayMs: e.target.value ? parseInt(e.target.value, 10) : undefined })} placeholder="0" min={0} max={60000}
            className="w-full rounded border border-border-primary bg-bg-input px-2 py-1.5 pf-text-xs text-text-primary focus:border-accent-primary focus:outline-none" />
        </div>
        <div className="flex-1">
          <label className="pf-text-xs text-text-secondary mb-1 block">{t("mockServer.priority")}</label>
          <input type="number" value={route.priority} onChange={(e) => update({ priority: parseInt(e.target.value, 10) || 0 })}
            className="w-full rounded border border-border-primary bg-bg-input px-2 py-1.5 pf-text-xs text-text-primary focus:border-accent-primary focus:outline-none" />
        </div>
      </div>
      <div>
        <label className="pf-text-xs text-text-secondary mb-1 block">{t("mockServer.responseHeaders")}</label>
        <ResponseHeadersEditor headers={route.headers} onChange={(headers) => update({ headers })} routeId={route.id} />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="pf-text-xs text-text-secondary">{t("mockServer.responseBody")}</label>
          <TemplateHelpTip />
        </div>
        <textarea value={route.bodyTemplate} onChange={(e) => update({ bodyTemplate: e.target.value })} placeholder={'{\n  "message": "Hello"\n}'} spellCheck={false}
          className="w-full h-48 rounded border border-border-primary bg-bg-input px-3 py-2 pf-text-xs text-text-primary font-mono focus:border-accent-primary focus:outline-none resize-y" />
      </div>
    </>
  );
}

// ── Examples Tab ──
function ExamplesTabContent({ route, update }: { route: MockRoute; update: (p: Partial<MockRoute>) => void }) {
  const { t } = useTranslation();

  const addExample = () => update({ examples: [...route.examples, createEmptyExample()] });
  const removeExample = (id: string) => update({ examples: route.examples.filter((e) => e.id !== id) });
  const updateExample = (id: string, patch: Partial<MockExample>) => {
    update({ examples: route.examples.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  };

  const conditionTypes: { value: MatchCondition["type"]; label: string }[] = [
    { value: "default", label: t("mockServer.condDefault") },
    { value: "header", label: t("mockServer.condHeader") },
    { value: "bodyContains", label: t("mockServer.condBodyContains") },
    { value: "bodyJsonPath", label: "JSON Path" },
    { value: "bodyRegex", label: "Regex" },
  ];

  const changeConditionType = (ex: MockExample, type: MatchCondition["type"]) => {
    let cond: MatchCondition;
    switch (type) {
      case "header": cond = { type: "header", name: "", value: "" }; break;
      case "bodyContains": cond = { type: "bodyContains", value: "" }; break;
      case "bodyJsonPath": cond = { type: "bodyJsonPath", path: "", value: "" }; break;
      case "bodyRegex": cond = { type: "bodyRegex", pattern: "" }; break;
      default: cond = { type: "default" };
    }
    updateExample(ex.id, { matchCondition: cond });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="pf-text-[11px] text-text-tertiary">{t("mockServer.examplesHint")}</p>
        <button onClick={addExample} className="flex items-center gap-1 pf-text-xs text-accent-primary hover:text-accent-primary/80">
          <Plus className="h-3 w-3" />{t("mockServer.addExample")}
        </button>
      </div>
      {route.examples.map((ex, i) => (
        <div key={ex.id} className="border border-border-primary rounded-md p-3 space-y-2 bg-bg-base/50">
          <div className="flex items-center gap-2">
            <input type="text" value={ex.name} onChange={(e) => updateExample(ex.id, { name: e.target.value })} placeholder={`Example ${i + 1}`}
              className="flex-1 rounded border border-border-primary bg-bg-input px-2 py-1 pf-text-xs text-text-primary focus:border-accent-primary focus:outline-none" />
            <input type="number" value={ex.statusCode} onChange={(e) => updateExample(ex.id, { statusCode: parseInt(e.target.value, 10) || 200 })} min={100} max={599}
              className="w-16 rounded border border-border-primary bg-bg-input px-2 py-1 pf-text-xs text-text-primary focus:border-accent-primary focus:outline-none" />
            <button onClick={() => removeExample(ex.id)} className="p-1 rounded hover:bg-red-500/10 text-text-tertiary hover:text-red-500">
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          {/* 条件 */}
          <div className="flex items-center gap-2">
            <select value={ex.matchCondition.type} onChange={(e) => changeConditionType(ex, e.target.value as MatchCondition["type"])}
              className="w-32 rounded border border-border-primary bg-bg-input px-2 py-1 pf-text-[11px] text-text-primary focus:border-accent-primary focus:outline-none">
              {conditionTypes.map((ct) => <option key={ct.value} value={ct.value}>{ct.label}</option>)}
            </select>
            {ex.matchCondition.type === "header" && (
              <>
                <input type="text" value={ex.matchCondition.name} onChange={(e) => updateExample(ex.id, { matchCondition: { ...ex.matchCondition, name: e.target.value } as MatchCondition })} placeholder="x-mock-example"
                  className="flex-1 rounded border border-border-primary bg-bg-input px-2 py-1 pf-text-[11px] text-text-primary font-mono focus:border-accent-primary focus:outline-none" />
                <input type="text" value={ex.matchCondition.value} onChange={(e) => updateExample(ex.id, { matchCondition: { ...ex.matchCondition, value: e.target.value } as MatchCondition })} placeholder="success"
                  className="flex-1 rounded border border-border-primary bg-bg-input px-2 py-1 pf-text-[11px] text-text-primary font-mono focus:border-accent-primary focus:outline-none" />
              </>
            )}
            {ex.matchCondition.type === "bodyContains" && (
              <input type="text" value={ex.matchCondition.value} onChange={(e) => updateExample(ex.id, { matchCondition: { type: "bodyContains", value: e.target.value } })} placeholder={t("mockServer.condBodyContainsHint")}
                className="flex-1 rounded border border-border-primary bg-bg-input px-2 py-1 pf-text-[11px] text-text-primary font-mono focus:border-accent-primary focus:outline-none" />
            )}
            {ex.matchCondition.type === "bodyJsonPath" && (
              <>
                <input type="text" value={ex.matchCondition.path} onChange={(e) => updateExample(ex.id, { matchCondition: { ...ex.matchCondition, path: e.target.value } as MatchCondition })} placeholder="user.role"
                  className="flex-1 rounded border border-border-primary bg-bg-input px-2 py-1 pf-text-[11px] text-text-primary font-mono focus:border-accent-primary focus:outline-none" />
                <input type="text" value={ex.matchCondition.value} onChange={(e) => updateExample(ex.id, { matchCondition: { ...ex.matchCondition, value: e.target.value } as MatchCondition })} placeholder="admin"
                  className="flex-1 rounded border border-border-primary bg-bg-input px-2 py-1 pf-text-[11px] text-text-primary font-mono focus:border-accent-primary focus:outline-none" />
              </>
            )}
            {ex.matchCondition.type === "bodyRegex" && (
              <input type="text" value={ex.matchCondition.pattern} onChange={(e) => updateExample(ex.id, { matchCondition: { type: "bodyRegex", pattern: e.target.value } })} placeholder="user_id.*\\d+"
                className="flex-1 rounded border border-border-primary bg-bg-input px-2 py-1 pf-text-[11px] text-text-primary font-mono focus:border-accent-primary focus:outline-none" />
            )}
          </div>
          {/* 响应体 */}
          <textarea value={ex.bodyTemplate} onChange={(e) => updateExample(ex.id, { bodyTemplate: e.target.value })} placeholder={'{ "result": "..." }'} spellCheck={false}
            className="w-full h-20 rounded border border-border-primary bg-bg-input px-2 py-1.5 pf-text-[11px] text-text-primary font-mono focus:border-accent-primary focus:outline-none resize-y" />
        </div>
      ))}
      {route.examples.length === 0 && (
        <p className="text-center pf-text-xs text-text-disabled py-4">{t("mockServer.noExamples")}</p>
      )}
    </div>
  );
}

// ── Sequence Tab ──
function SequenceTabContent({ route, update }: { route: MockRoute; update: (p: Partial<MockRoute>) => void }) {
  const { t } = useTranslation();

  const addItem = () => update({ sequence: [...route.sequence, createEmptySequenceItem()] });
  const removeItem = (idx: number) => update({ sequence: route.sequence.filter((_, i) => i !== idx) });
  const updateItem = (idx: number, patch: Partial<SequenceItem>) => {
    update({ sequence: route.sequence.map((item, i) => (i === idx ? { ...item, ...patch } : item)) });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="pf-text-[11px] text-text-tertiary">{t("mockServer.sequenceHint")}</p>
          <label className="flex items-center gap-1.5 mt-1">
            <input type="checkbox" checked={route.sequenceLoop} onChange={(e) => update({ sequenceLoop: e.target.checked })} className="rounded" />
            <span className="pf-text-[11px] text-text-secondary">{t("mockServer.sequenceLoop")}</span>
          </label>
        </div>
        <button onClick={addItem} className="flex items-center gap-1 pf-text-xs text-accent-primary hover:text-accent-primary/80">
          <Plus className="h-3 w-3" />{t("mockServer.addSequenceItem")}
        </button>
      </div>
      {route.sequence.map((item, idx) => (
        <div key={item.id} className="border border-border-primary rounded-md p-3 space-y-2 bg-bg-base/50">
          <div className="flex items-center gap-2">
            <span className="pf-text-[10px] text-text-tertiary font-mono w-6 text-center shrink-0">#{idx + 1}</span>
            <input type="number" value={item.statusCode} onChange={(e) => updateItem(idx, { statusCode: parseInt(e.target.value, 10) || 200 })} min={100} max={599}
              className="w-16 rounded border border-border-primary bg-bg-input px-2 py-1 pf-text-xs text-text-primary focus:border-accent-primary focus:outline-none" />
            <input type="number" value={item.delayMs ?? ""} onChange={(e) => updateItem(idx, { delayMs: e.target.value ? parseInt(e.target.value, 10) : undefined })} placeholder="delay ms"
              className="w-20 rounded border border-border-primary bg-bg-input px-2 py-1 pf-text-[11px] text-text-primary focus:border-accent-primary focus:outline-none" />
            <div className="flex-1" />
            <button onClick={() => removeItem(idx)} className="p-1 rounded hover:bg-red-500/10 text-text-tertiary hover:text-red-500">
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          <textarea value={item.bodyTemplate} onChange={(e) => updateItem(idx, { bodyTemplate: e.target.value })} placeholder={'{ "step": ' + (idx + 1) + " }"} spellCheck={false}
            className="w-full h-16 rounded border border-border-primary bg-bg-input px-2 py-1.5 pf-text-[11px] text-text-primary font-mono focus:border-accent-primary focus:outline-none resize-y" />
        </div>
      ))}
      {route.sequence.length === 0 && (
        <p className="text-center pf-text-xs text-text-disabled py-4">{t("mockServer.noSequence")}</p>
      )}
    </div>
  );
}

// ── Script Tab ──
function ScriptTabContent({ route, update }: { route: MockRoute; update: (p: Partial<MockRoute>) => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div className="pf-text-[11px] text-text-tertiary space-y-1">
        <p>{t("mockServer.scriptHint")}</p>
        <div className="bg-bg-base/50 border border-border-subtle rounded p-2 font-mono pf-text-[10px] text-text-secondary space-y-0.5">
          <p>// {t("mockServer.scriptApiAccess")}:</p>
          <p>mock.request.method / .path / .query / .params / .headers / .body</p>
          <p>mock.response.status = 201;</p>
          <p>mock.response.headers["X-Custom"] = "value";</p>
          <p>{'mock.response.body = JSON.stringify({ id: 1 });'}</p>
        </div>
      </div>
      <textarea
        value={route.script ?? ""}
        onChange={(e) => update({ script: e.target.value || undefined })}
        placeholder={'// mock.response.body = JSON.stringify({\n//   id: mock.request.params.id,\n//   name: "User " + mock.request.params.id\n// });'}
        spellCheck={false}
        className="w-full h-64 rounded border border-border-primary bg-bg-input px-3 py-2 pf-text-xs text-text-primary font-mono focus:border-accent-primary focus:outline-none resize-y"
      />
    </div>
  );
}

// ── 响应头编辑器 ──
function ResponseHeadersEditor({
  headers,
  onChange,
  routeId,
}: {
  headers: Record<string, string>;
  onChange: (headers: Record<string, string>) => void;
  routeId?: string;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<{ _id: string; key: string; value: string }[]>(() =>
    Object.entries(headers).map(([key, value]) => ({ _id: crypto.randomUUID(), key, value })),
  );

  // 只在切换路由时重建行（通过 routeId 判断），避免自身编辑触发重建
  const prevRouteIdRef = useRef(routeId);
  useEffect(() => {
    if (prevRouteIdRef.current !== routeId) {
      prevRouteIdRef.current = routeId;
      setRows(Object.entries(headers).map(([key, value]) => ({ _id: crypto.randomUUID(), key, value })));
    }
  }, [routeId, headers]);

  const commit = (newRows: typeof rows) => {
    setRows(newRows);
    const result: Record<string, string> = {};
    for (const row of newRows) {
      if (row.key) result[row.key] = row.value;
    }
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
