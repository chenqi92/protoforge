// Mock Server 工作区 — 路由管理 + 响应配置 + 请求日志
// 三栏布局：路由列表 | 路由编辑 | 请求日志

import { memo, useEffect, useCallback, useState, useRef } from "react";
import {
  Play, Square, Trash2, Plus, Copy,
  ChevronRight,
  Clock, AlertCircle, Server, Zap,
  Download, Upload, Globe, Code, ListOrdered, Layers,
  PanelLeftOpen,
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
  usePanelRef,
} from "react-resizable-panels";

// ── HTTP Method → .pf-mtag 修饰类 ──
function methodClass(method?: string): string {
  if (!method) return "m-get";
  return `m-${method.toLowerCase()}`;
}

// 状态码 → .pf-pill 色调
function statusTone(status: number): string {
  if (status < 300) return "ok";
  if (status < 400) return "warn";
  return "err";
}

// 状态码文本色（Forge token）
function statusColor(status: number): string {
  if (status < 300) return "text-success";
  if (status < 400) return "text-warning";
  return "text-error";
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
  const { t } = useTranslation();
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

  const routePanelRef = usePanelRef();
  const [routePanelCollapsed, setRoutePanelCollapsed] = useState(false);

  const handleRoutePanelResize = useCallback((size: { asPercentage: number; inPixels: number }) => {
    setRoutePanelCollapsed(size.inPixels <= 42);
  }, []);

  const handleRoutePanelExpand = useCallback(() => {
    const ref = routePanelRef.current;
    if (!ref) return;
    ref.expand();
    ref.resize("22%");
  }, [routePanelRef]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg-primary" data-contextmenu-zone="mockserver" onContextMenu={(e) => e.preventDefault()}>
      {/* 控制栏 */}
      <ControlBar sessionId={sessionId} running={running} port={port} totalHits={totalHits} error={error} routeCount={routes.length} proxyTarget={proxyTarget} />

      {/* 三栏布局 */}
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
        <PanelGroup orientation="horizontal">
          {/* 路由列表 */}
          <Panel
            id="mock-routes"
            defaultSize={22}
            minSize="40px"
            collapsible
            collapsedSize="0px"
            panelRef={routePanelRef}
            onResize={handleRoutePanelResize}
            className="overflow-hidden"
          >
            <div className="h-full min-w-[200px]">
              <RouteListPanel sessionId={sessionId} routes={routes} selectedRouteId={selectedRouteId} />
            </div>
          </Panel>

          {/* 分割线 */}
          <PanelResizeHandle className="relative w-[7px] shrink-0 cursor-col-resize group flex items-center justify-center">
            <div className="absolute inset-y-0 left-[3px] w-px bg-border-default/40 group-hover:bg-accent/40 transition-colors" />
            {routePanelCollapsed && (
              <button
                onClick={handleRoutePanelExpand}
                aria-label={t('common.expand')}
                className="absolute left-0 top-2 z-10 flex items-center justify-center w-6 h-6 rounded-r bg-bg-surface border border-l-0 border-border-default/50 text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors shadow-sm"
              >
                <PanelLeftOpen size={14} />
              </button>
            )}
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

  const handleExport = useCallback(async () => {
    const routes = store.getState().exportRoutes();
    const json = JSON.stringify(routes, null, 2);
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({
      defaultPath: `mock-routes-${Date.now()}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return;
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(path, json);
  }, [store]);

  const handleImport = useCallback(async () => {
    const { open, message } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!selected || typeof selected !== "string") return;
    try {
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const text = await readTextFile(selected);
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        await message(t("mock.importInvalidArray", "JSON 格式不符合 MockRoute 结构（应为数组）"), { title: t("mock.importFailed", "导入失败"), kind: "error" });
        return;
      }
      const valid = parsed.every(
        (r: unknown) =>
          typeof r === "object" && r !== null &&
          "pattern" in r && "statusCode" in r
      );
      if (!valid) {
        await message(t("mock.importInvalidStructure", "JSON 格式不符合 MockRoute 结构"), { title: t("mock.importFailed", "导入失败"), kind: "error" });
        return;
      }
      const routes = parsed.map((r: Record<string, unknown>) => ({
        id: (r.id as string) || crypto.randomUUID(),
        method: (r.method as string | undefined) ?? "GET",
        pattern: (r.pattern as string) ?? "/",
        statusCode: (r.statusCode as number) ?? 200,
        headers: (r.headers as Record<string, string>) ?? {},
        bodyTemplate: (r.bodyTemplate as string) ?? "",
        delayMs: r.delayMs as number | undefined,
        priority: (r.priority as number) ?? 0,
        enabled: (r.enabled as boolean) ?? true,
        description: (r.description as string) ?? "",
        examples: (r.examples as MockRoute["examples"]) ?? [],
        script: r.script as string | undefined,
        sequence: (r.sequence as MockRoute["sequence"]) ?? [],
        sequenceLoop: (r.sequenceLoop as boolean) ?? true,
      }));
      store.getState().importRoutes(routes);
    } catch (e) {
      await message(String(e), { title: t("mock.importFailed", "导入失败"), kind: "error" });
    }
  }, [store]);

  return (
    <div className="flex flex-col border-b border-border-default bg-bg-surface">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        {/* 状态指示 — idle / connecting / live */}
        <span className="pf-status-chip">
          <span className={cn("pf-dot", starting ? "s-conn" : running ? "s-live" : "s-idle")} />
          {starting ? t("mockServer.starting") : running ? t("mockServer.running") : t("mockServer.stopped")}
        </span>

        {/* 运行地址 */}
        {running && (
          <span className="pf-pill">
            <Globe className="h-3 w-3" />
            127.0.0.1:{port}
          </span>
        )}

        {/* 端口 */}
        <div className="flex items-center gap-1.5">
          <span className="pf-text-xs text-text-tertiary">{t("mockServer.port")}</span>
          <input
            type="number"
            value={portInput}
            onChange={(e) => setPortInput(e.target.value)}
            disabled={running}
            className={cn("w-16 h-6 rounded border border-border-default bg-bg-input px-2 pf-text-xs text-text-primary font-mono tnum focus:border-accent focus:outline-none", running && "opacity-60 cursor-not-allowed")}
            min={1} max={65535}
          />
        </div>

        <div className="flex-1" />

        {/* 统计 */}
        <div className="flex items-center gap-3 pf-text-xs text-text-tertiary tnum">
          <span><Zap className="inline h-3 w-3 mr-0.5" />{totalHits} {t("mockServer.hits")}</span>
          <span><Server className="inline h-3 w-3 mr-0.5" />{routeCount} {t("mockServer.routeCount")}</span>
        </div>

        {/* 导入/导出 / 代理 */}
        <div className="flex items-center gap-0.5">
          <button onClick={handleImport} className="grid place-items-center h-6 w-6 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors" title={t("mockServer.import")}>
            <Upload className="h-3.5 w-3.5" />
          </button>
          <button onClick={handleExport} className="grid place-items-center h-6 w-6 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors" title={t("mockServer.export")}>
            <Download className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setShowProxy(!showProxy)}
            className={cn("grid place-items-center h-6 w-6 rounded hover:bg-bg-hover transition-colors", proxyTarget ? "text-success" : "text-text-tertiary hover:text-text-primary")}
            title={t("mockServer.proxyTarget")}
          >
            <Globe className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* 启动/停止 (.btn sm primary/danger) */}
        <button
          onClick={handleToggle}
          disabled={starting}
          className={cn(
            "flex items-center gap-1.5 rounded-md h-6 px-2.5 pf-text-xs font-semibold transition-colors",
            running
              ? "bg-error/15 text-error hover:bg-error/25"
              : "bg-success/15 text-success hover:bg-success/25",
            starting && "opacity-50 cursor-not-allowed",
          )}
        >
          {running ? <><Square className="h-3 w-3" />{t("mockServer.stop")}</> : <><Play className="h-3 w-3" />{starting ? t("mockServer.starting") : t("mockServer.start")}</>}
        </button>
      </div>

      {/* 错误横幅 (error 状态 §6.6) */}
      {error && (
        <div className="flex items-start gap-2 px-3 py-2 border-t border-error/30 bg-error/10">
          <AlertCircle className="h-3.5 w-3.5 text-error shrink-0 mt-px" />
          <span className="flex-1 min-w-0 pf-text-xs text-error break-all">{error}</span>
        </div>
      )}

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
    <div className="flex items-center gap-2 px-3 py-1.5 border-t border-border-subtle bg-bg-secondary">
      <Globe className="h-3 w-3 text-text-tertiary shrink-0" />
      <span className="pf-text-xs text-text-tertiary shrink-0">{t("mockServer.proxyTarget")}</span>
      <input
        type="text"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
        placeholder="https://api.example.com"
        className="flex-1 min-w-0 rounded border border-border-default bg-bg-input px-2 py-1 pf-text-xs text-text-primary font-mono focus:border-accent focus:outline-none"
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
    <div className="flex h-full flex-col overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-border-default px-3 py-2.5 shrink-0">
        <span className="pf-text-xxs font-bold text-text-tertiary uppercase tracking-wider">
          {t("mockServer.routeList")}
        </span>
        <button
          onClick={() => store.getState().addRoute()}
          className="grid place-items-center h-6 w-6 rounded text-accent hover:bg-bg-hover transition-colors"
          title={t("mockServer.addRoute")}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto min-w-0">
        {routes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-5 text-center gap-2">
            <div className="grid place-items-center h-11 w-11 rounded-xl bg-bg-secondary border border-border-subtle mb-1">
              <Server className="h-5 w-5 text-text-tertiary" />
            </div>
            <p className="pf-text-sm font-medium text-text-secondary">
              {t("mockServer.noRoutes")}
            </p>
            <button
              onClick={() => store.getState().addRoute()}
              className="mt-1 flex items-center gap-1 rounded-md bg-accent/10 px-3 py-1.5 pf-text-xs text-accent hover:bg-accent/20 transition-colors"
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

  return (
    <div
      onClick={onSelect}
      className={cn(
        "group flex items-center gap-2 px-3 h-[38px] cursor-pointer border-b border-border-subtle transition-colors min-w-0",
        selected
          ? "bg-accent-soft border-l-2 border-l-accent"
          : "hover:bg-bg-hover border-l-2 border-l-transparent",
        !route.enabled && "opacity-50",
      )}
    >
      <span className={cn("pf-mtag w-[40px] shrink-0", methodClass(route.method))}>
        {route.method || "ANY"}
      </span>
      <div className="flex-1 min-w-0 overflow-hidden">
        <span className="pf-text-xs text-text-primary truncate font-mono block min-w-0">
          {route.pattern || "/"}
        </span>
        {route.description && (
          <p className="pf-text-3xs text-text-tertiary truncate">
            {route.description}
          </p>
        )}
      </div>

      <span className={cn("pf-pill shrink-0", statusTone(route.statusCode))}>
        {route.statusCode}
      </span>

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
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="p-0.5 rounded hover:bg-error/10 text-text-tertiary hover:text-error"
          title={t("mockServer.deleteRoute")}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {/* 启用/禁用 状态点 */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        className="shrink-0 grid place-items-center p-0 border-0 bg-transparent cursor-pointer group-hover:hidden"
        title={route.enabled ? t("mockServer.disable") : t("mockServer.enable")}
      >
        <span className={cn("pf-dot", route.enabled ? "s-ok" : "s-idle")} />
      </button>
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
  const syncTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
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
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center text-center gap-2 px-6">
          <div className="grid place-items-center h-11 w-11 rounded-xl bg-bg-secondary border border-border-subtle mb-1">
            <Layers className="h-5 w-5 text-text-tertiary" />
          </div>
          <p className="pf-text-sm font-medium text-text-secondary">{t("mockServer.selectRoute")}</p>
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
      <div className="border-b border-border-default px-3 py-2.5 shrink-0 space-y-2">
        <div className="flex gap-2">
          <select
            value={route.method ?? ""}
            onChange={(e) => update({ method: e.target.value || undefined })}
            className="w-28 shrink-0 rounded border border-border-default bg-bg-input px-2 py-1.5 pf-text-xs text-text-primary focus:border-accent focus:outline-none"
          >
            <option value="">ANY</option>
            {HTTP_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <input
            type="text"
            value={route.pattern}
            onChange={(e) => update({ pattern: e.target.value })}
            placeholder="/api/users/:id"
            className="flex-1 min-w-0 rounded border border-border-default bg-bg-input px-2 py-1.5 pf-text-xs text-text-primary font-mono focus:border-accent focus:outline-none"
          />
        </div>
        {/* Tab 切换（.utab 下划线 underline tabs） */}
        <div className="flex gap-0.5 -mb-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const on = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "relative flex items-center gap-1.5 h-[33px] px-2.5 pf-text-xs font-medium transition-colors",
                  on ? "text-text-primary" : "text-text-secondary hover:text-text-primary",
                )}
              >
                <Icon className="h-3 w-3" />
                {tab.label}
                {(tab.badge ?? 0) > 0 && (
                  <span className="rounded-lg bg-bg-tertiary px-1.5 pf-text-3xs font-mono text-text-tertiary">
                    {tab.badge}
                  </span>
                )}
                {on && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-sm bg-accent" />}
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
          className="w-full rounded border border-border-default bg-bg-input px-2 py-1.5 pf-text-xs text-text-primary focus:border-accent focus:outline-none" />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="pf-text-xs text-text-secondary mb-1 block">{t("mockServer.statusCode")}</label>
          <input type="number" value={route.statusCode} onChange={(e) => update({ statusCode: parseInt(e.target.value, 10) || 200 })} min={100} max={599}
            className="w-full rounded border border-border-default bg-bg-input px-2 py-1.5 pf-text-xs text-text-primary focus:border-accent focus:outline-none" />
        </div>
        <div className="flex-1">
          <label className="pf-text-xs text-text-secondary mb-1 block"><Clock className="inline h-3 w-3 mr-0.5" />{t("mockServer.delay")}</label>
          <input type="number" value={route.delayMs ?? ""} onChange={(e) => update({ delayMs: e.target.value ? parseInt(e.target.value, 10) : undefined })} placeholder="0" min={0} max={60000}
            className="w-full rounded border border-border-default bg-bg-input px-2 py-1.5 pf-text-xs text-text-primary focus:border-accent focus:outline-none" />
        </div>
        <div className="flex-1">
          <label className="pf-text-xs text-text-secondary mb-1 block">{t("mockServer.priority")}</label>
          <input type="number" value={route.priority} onChange={(e) => update({ priority: parseInt(e.target.value, 10) || 0 })}
            className="w-full rounded border border-border-default bg-bg-input px-2 py-1.5 pf-text-xs text-text-primary focus:border-accent focus:outline-none" />
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
          className="w-full h-48 rounded border border-border-default bg-bg-input px-3 py-2 pf-text-xs text-text-primary font-mono focus:border-accent focus:outline-none resize-y" />
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
        <button onClick={addExample} className="flex items-center gap-1 pf-text-xs text-accent hover:text-accent/80">
          <Plus className="h-3 w-3" />{t("mockServer.addExample")}
        </button>
      </div>
      {route.examples.map((ex, i) => (
        <div key={ex.id} className="border border-border-default rounded-md p-3 space-y-2 bg-bg-secondary">
          <div className="flex items-center gap-2">
            <input type="text" value={ex.name} onChange={(e) => updateExample(ex.id, { name: e.target.value })} placeholder={`Example ${i + 1}`}
              className="flex-1 rounded border border-border-default bg-bg-input px-2 py-1 pf-text-xs text-text-primary focus:border-accent focus:outline-none" />
            <input type="number" value={ex.statusCode} onChange={(e) => updateExample(ex.id, { statusCode: parseInt(e.target.value, 10) || 200 })} min={100} max={599}
              className="w-16 rounded border border-border-default bg-bg-input px-2 py-1 pf-text-xs text-text-primary focus:border-accent focus:outline-none" />
            <button onClick={() => removeExample(ex.id)} aria-label={t('common.delete')} className="p-1 rounded hover:bg-error/10 text-text-tertiary hover:text-error">
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          {/* 条件 */}
          <div className="flex items-center gap-2">
            <select value={ex.matchCondition.type} onChange={(e) => changeConditionType(ex, e.target.value as MatchCondition["type"])}
              className="w-32 rounded border border-border-default bg-bg-input px-2 py-1 pf-text-[11px] text-text-primary focus:border-accent focus:outline-none">
              {conditionTypes.map((ct) => <option key={ct.value} value={ct.value}>{ct.label}</option>)}
            </select>
            {ex.matchCondition.type === "header" && (
              <>
                <input type="text" value={ex.matchCondition.name} onChange={(e) => updateExample(ex.id, { matchCondition: { ...ex.matchCondition, name: e.target.value } as MatchCondition })} placeholder="x-mock-example"
                  className="flex-1 rounded border border-border-default bg-bg-input px-2 py-1 pf-text-[11px] text-text-primary font-mono focus:border-accent focus:outline-none" />
                <input type="text" value={ex.matchCondition.value} onChange={(e) => updateExample(ex.id, { matchCondition: { ...ex.matchCondition, value: e.target.value } as MatchCondition })} placeholder="success"
                  className="flex-1 rounded border border-border-default bg-bg-input px-2 py-1 pf-text-[11px] text-text-primary font-mono focus:border-accent focus:outline-none" />
              </>
            )}
            {ex.matchCondition.type === "bodyContains" && (
              <input type="text" value={ex.matchCondition.value} onChange={(e) => updateExample(ex.id, { matchCondition: { type: "bodyContains", value: e.target.value } })} placeholder={t("mockServer.condBodyContainsHint")}
                className="flex-1 rounded border border-border-default bg-bg-input px-2 py-1 pf-text-[11px] text-text-primary font-mono focus:border-accent focus:outline-none" />
            )}
            {ex.matchCondition.type === "bodyJsonPath" && (
              <>
                <input type="text" value={ex.matchCondition.path} onChange={(e) => updateExample(ex.id, { matchCondition: { ...ex.matchCondition, path: e.target.value } as MatchCondition })} placeholder="user.role"
                  className="flex-1 rounded border border-border-default bg-bg-input px-2 py-1 pf-text-[11px] text-text-primary font-mono focus:border-accent focus:outline-none" />
                <input type="text" value={ex.matchCondition.value} onChange={(e) => updateExample(ex.id, { matchCondition: { ...ex.matchCondition, value: e.target.value } as MatchCondition })} placeholder="admin"
                  className="flex-1 rounded border border-border-default bg-bg-input px-2 py-1 pf-text-[11px] text-text-primary font-mono focus:border-accent focus:outline-none" />
              </>
            )}
            {ex.matchCondition.type === "bodyRegex" && (
              <input type="text" value={ex.matchCondition.pattern} onChange={(e) => updateExample(ex.id, { matchCondition: { type: "bodyRegex", pattern: e.target.value } })} placeholder="user_id.*\\d+"
                className="flex-1 rounded border border-border-default bg-bg-input px-2 py-1 pf-text-[11px] text-text-primary font-mono focus:border-accent focus:outline-none" />
            )}
          </div>
          {/* 响应体 */}
          <textarea value={ex.bodyTemplate} onChange={(e) => updateExample(ex.id, { bodyTemplate: e.target.value })} placeholder={'{ "result": "..." }'} spellCheck={false}
            className="w-full h-20 rounded border border-border-default bg-bg-input px-2 py-1.5 pf-text-[11px] text-text-primary font-mono focus:border-accent focus:outline-none resize-y" />
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
        <button onClick={addItem} className="flex items-center gap-1 pf-text-xs text-accent hover:text-accent/80">
          <Plus className="h-3 w-3" />{t("mockServer.addSequenceItem")}
        </button>
      </div>
      {route.sequence.map((item, idx) => (
        <div key={item.id} className="border border-border-default rounded-md p-3 space-y-2 bg-bg-secondary">
          <div className="flex items-center gap-2">
            <span className="pf-text-[10px] text-text-tertiary font-mono w-6 text-center shrink-0">#{idx + 1}</span>
            <input type="number" value={item.statusCode} onChange={(e) => updateItem(idx, { statusCode: parseInt(e.target.value, 10) || 200 })} min={100} max={599}
              className="w-16 rounded border border-border-default bg-bg-input px-2 py-1 pf-text-xs text-text-primary focus:border-accent focus:outline-none" />
            <input type="number" value={item.delayMs ?? ""} onChange={(e) => updateItem(idx, { delayMs: e.target.value ? parseInt(e.target.value, 10) : undefined })} placeholder="delay ms"
              className="w-20 rounded border border-border-default bg-bg-input px-2 py-1 pf-text-[11px] text-text-primary focus:border-accent focus:outline-none" />
            <div className="flex-1" />
            <button onClick={() => removeItem(idx)} aria-label={t('common.delete')} className="p-1 rounded hover:bg-error/10 text-text-tertiary hover:text-error">
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          <textarea value={item.bodyTemplate} onChange={(e) => updateItem(idx, { bodyTemplate: e.target.value })} placeholder={'{ "step": ' + (idx + 1) + " }"} spellCheck={false}
            className="w-full h-16 rounded border border-border-default bg-bg-input px-2 py-1.5 pf-text-[11px] text-text-primary font-mono focus:border-accent focus:outline-none resize-y" />
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
        <div className="bg-bg-inset border border-border-subtle rounded p-2 font-mono pf-text-[10px] text-text-secondary space-y-0.5">
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
        className="w-full h-64 rounded border border-border-default bg-bg-input px-3 py-2 pf-text-xs text-text-primary font-mono focus:border-accent focus:outline-none resize-y"
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
            className="flex-1 rounded border border-border-default bg-bg-input px-2 py-1 pf-text-[11px] text-text-primary font-mono focus:border-accent focus:outline-none"
          />
          <input
            type="text"
            value={row.value}
            onChange={(e) => commit(rows.map((r) => (r._id === row._id ? { ...r, value: e.target.value } : r)))}
            placeholder={t("mockServer.headerValue")}
            className="flex-1 rounded border border-border-default bg-bg-input px-2 py-1 pf-text-[11px] text-text-primary font-mono focus:border-accent focus:outline-none"
          />
          <button
            onClick={() => commit(rows.filter((r) => r._id !== row._id))}
            aria-label={t('common.delete')}
            className="p-1 rounded hover:bg-error/10 text-text-tertiary hover:text-error"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
      <button
        onClick={() => commit([...rows, { _id: crypto.randomUUID(), key: "", value: "" }])}
        className="flex items-center gap-1 pf-text-[11px] text-accent hover:text-accent/80"
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
        className="pf-text-[10px] text-accent hover:text-accent/80 flex items-center gap-0.5"
      >
        <Zap className="h-3 w-3" />
        {t("mockServer.templateVars")}
      </button>
      {open && (
        <div className="absolute right-0 top-5 z-50 w-72 rounded-md border border-border-default bg-bg-surface shadow-lg p-3 pf-text-[10px] text-text-secondary">
          <div className="space-y-1.5">
            <p className="font-medium text-text-primary mb-1">{t("mockServer.tplRequestCtx")}:</p>
            <code className="block text-accent">{"{{request.method}}"}</code>
            <code className="block text-accent">{"{{request.path}}"}</code>
            <code className="block text-accent">{"{{request.params.<name>}}"}</code>
            <code className="block text-accent">{"{{request.query.<name>}}"}</code>
            <code className="block text-accent">{"{{request.headers.<name>}}"}</code>
            <code className="block text-accent">{"{{request.body}}"}</code>

            <p className="font-medium text-text-primary mt-2 mb-1">{t("mockServer.tplDynamic")}:</p>
            <code className="block text-accent">{"{{$randomUUID}}"}</code>
            <code className="block text-accent">{"{{$timestamp}}"}</code>
            <code className="block text-accent">{"{{$isoTimestamp}}"}</code>
            <code className="block text-accent">{"{{$randomInt}}"} / {"{{$randomInt(1,100)}}"}</code>
            <code className="block text-accent">{"{{$randomFloat}}"} {"{{$randomBoolean}}"}</code>

            <p className="font-medium text-text-primary mt-2 mb-1">Faker:</p>
            <code className="block text-accent">{"{{$faker.name}}"} {"{{$faker.email}}"}</code>
            <code className="block text-accent">{"{{$faker.phone}}"} {"{{$faker.company}}"}</code>

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
  const running = useMockServerStore(sessionId, (s) => s.running);
  const listRef = useRef<HTMLDivElement>(null);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [logs.length]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg-secondary">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-border-default px-3 py-2.5 shrink-0">
        <span className="flex items-center gap-1.5 pf-text-sm font-semibold text-text-primary">
          <Zap className="h-3.5 w-3.5 text-accent" />
          {t("mockServer.requestLog")}
          {logs.length > 0 && (
            <span className="pf-text-xs font-normal text-text-tertiary">({logs.length})</span>
          )}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => store.getState().clearLogs()}
            className="grid place-items-center h-6 w-6 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors"
            title={t("mockServer.clearLog")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <span className={cn("pf-dot", running ? "s-live" : "s-idle")} />
        </div>
      </div>

      {/* 日志列表 */}
      <div ref={listRef} className="flex-1 overflow-y-auto min-w-0">
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-5 text-center gap-1.5">
            <div className="grid place-items-center h-10 w-10 rounded-xl bg-bg-tertiary border border-border-subtle mb-1">
              <Zap className="h-4 w-4 text-text-tertiary" />
            </div>
            <p className="pf-text-xs font-medium text-text-secondary">{t("mockServer.noLogs")}</p>
            <p className="pf-text-[10px] text-text-tertiary">{t("mockServer.noLogsHint")}</p>
          </div>
        ) : (
          logs.map((log) => {
            return (
              <div
                key={log.id}
                onClick={() => setSelectedLogId(log.id === selectedLogId ? null : log.id)}
                className={cn(
                  "border-b border-border-subtle cursor-pointer transition-colors",
                  log.id === selectedLogId ? "bg-accent-soft" : "hover:bg-bg-hover",
                )}
              >
                <div className="grid items-center gap-2 px-3 py-1 font-mono" style={{ gridTemplateColumns: "46px 1fr auto auto" }}>
                  <span className={cn("pf-mtag", methodClass(log.method))}>
                    {log.method}
                  </span>
                  <span className="pf-text-xs text-text-primary truncate min-w-0">
                    {log.path}
                    {log.query && <span className="text-text-tertiary">?{log.query}</span>}
                  </span>
                  <span className={cn("pf-text-3xs shrink-0 tnum", statusColor(log.responseStatus))}>
                    {log.responseStatus}
                  </span>
                  <span className="pf-text-3xs text-text-tertiary shrink-0 tnum w-12 text-right">
                    {log.durationMs}ms
                  </span>
                </div>
                {log.matchedPattern && (
                  <div className="pf-text-3xs text-text-tertiary -mt-0.5 pb-1 pl-[58px] font-mono">
                    <ChevronRight className="inline h-2.5 w-2.5" />
                    {log.matchedPattern}
                    {log.delayMs > 0 && (
                      <span className="ml-1 text-warning">
                        <Clock className="inline h-2.5 w-2.5" /> +{log.delayMs}ms
                      </span>
                    )}
                  </div>
                )}

                {/* 展开的详情 */}
                {log.id === selectedLogId && (
                  <div className="mt-2 p-2 rounded bg-bg-inset border border-border-subtle pf-text-[10px]">
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
