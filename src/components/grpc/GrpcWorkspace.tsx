import { memo, useState, useCallback, useEffect, useRef } from "react";
import {
  Play, Loader2, FolderOpen, RefreshCw, ChevronRight, ChevronDown,
  Copy, Check, Square, Search, Lock, ArrowUp, ArrowDown, Boxes, MousePointerClick, Inbox,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { requestConnectionId, useAppStore } from "@/stores/appStore";
import { RequestWorkbenchHeader } from "@/components/request/RequestWorkbenchHeader";
import { RequestProtocolSwitcher } from "@/components/request/RequestProtocolSwitcher";
import { JsonEditorLite } from "@/components/common/JsonEditorLite";
import { ResponseViewer } from "@/components/ui/ResponseViewer";
import * as grpcService from "@/services/grpcService";
import type {
  GrpcServiceInfo, GrpcMethodInfo, GrpcCallResult, GrpcStreamEvent, ProtoLoadResult,
} from "@/types/grpc";
import { buildRequestTemplate, getMethodKindLabel } from "@/types/grpc";
import type { GrpcMethodKind } from "@/types/grpc";

const MAX_STREAM_MESSAGES = 500;
const MAX_STREAM_MESSAGE_BYTES = 64 * 1024;
const MAX_STREAM_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_PENDING_START_EVENTS = 32;
const STREAM_EVENT_OVERHEAD_BYTES = 128;
const TRUNCATED_SUFFIX = "\n… [preview truncated]";
const utf8Encoder = new TextEncoder();

type StreamPreviewEvent = GrpcStreamEvent & { previewBytes: number };

function utf8ByteLength(value: string | undefined): number {
  return value ? utf8Encoder.encode(value).byteLength : 0;
}

function truncateUtf8Preview(value: string | undefined, maxBytes: number): string | undefined {
  if (value === undefined) return undefined;
  if (maxBytes <= 0) return "";
  if (utf8ByteLength(value) <= maxBytes) return value;

  const suffixBytes = utf8ByteLength(TRUNCATED_SUFFIX);
  if (suffixBytes >= maxBytes) {
    return maxBytes >= utf8ByteLength("…") ? "…" : "";
  }
  const contentBudget = maxBytes - suffixBytes;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (utf8ByteLength(value.slice(0, middle)) <= contentBudget) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  let prefix = value.slice(0, low);
  const finalCodeUnit = prefix.charCodeAt(prefix.length - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) {
    prefix = prefix.slice(0, -1);
  }
  return `${prefix}${TRUNCATED_SUFFIX}`;
}

function toStreamPreview(event: GrpcStreamEvent): StreamPreviewEvent {
  const contentBudget = MAX_STREAM_MESSAGE_BYTES - STREAM_EVENT_OVERHEAD_BYTES;
  const data = truncateUtf8Preview(event.data, contentBudget);
  const statusBudget = Math.max(0, contentBudget - utf8ByteLength(data));
  const statusMessage = truncateUtf8Preview(event.statusMessage, statusBudget);
  const previewBytes = STREAM_EVENT_OVERHEAD_BYTES
    + utf8ByteLength(data)
    + utf8ByteLength(statusMessage);
  return { ...event, data, statusMessage, previewBytes };
}

function appendStreamPreview(
  previous: StreamPreviewEvent[],
  event: GrpcStreamEvent,
): StreamPreviewEvent[] {
  const next = [...previous, toStreamPreview(event)];
  let totalBytes = next.reduce((total, item) => total + item.previewBytes, 0);
  let firstRetained = 0;
  while (
    firstRetained < next.length
    && (next.length - firstRetained > MAX_STREAM_MESSAGES || totalBytes > MAX_STREAM_TOTAL_BYTES)
  ) {
    totalBytes -= next[firstRetained].previewBytes;
    firstRetained += 1;
  }
  return firstRetained === 0 ? next : next.slice(firstRetained);
}

// Map gRPC method kind to Forge method-* tokens (avoids hardcoded palette colors).
function methodKindToneClass(kind: GrpcMethodKind): string {
  switch (kind) {
    case "unary": return "text-method-get";
    case "serverStreaming": return "text-method-post";
    case "clientStreaming": return "text-method-put";
    case "bidiStreaming": return "text-method-patch";
  }
}

// ── Service tree sidebar ──

function ServiceTree({
  services,
  selectedMethod,
  onSelectMethod,
}: {
  services: GrpcServiceInfo[];
  selectedMethod: string | null;
  onSelectMethod: (method: GrpcMethodInfo, service: GrpcServiceInfo) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(services.map((s) => s.fullName)));
  const [search, setSearch] = useState("");

  const toggle = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const lowerSearch = search.toLowerCase();

  return (
    <div className="flex flex-col h-full min-w-0 border-r border-border-default/60">
      <div className="p-2 border-b border-border-default/60">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-text-tertiary" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter methods..."
            className="wb-field-sm w-full pl-7 pf-text-xs"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {services.map((svc) => {
          const filteredMethods = lowerSearch
            ? svc.methods.filter((m) => m.name.toLowerCase().includes(lowerSearch) || m.fullName.toLowerCase().includes(lowerSearch))
            : svc.methods;
          if (lowerSearch && filteredMethods.length === 0) return null;
          const isExpanded = expanded.has(svc.fullName) || !!lowerSearch;

          return (
            <div key={svc.fullName}>
              <button
                className="flex w-full items-center gap-1.5 px-2 py-1 hover:bg-bg-hover/50 transition-colors text-left"
                onClick={() => toggle(svc.fullName)}
              >
                {isExpanded ? <ChevronDown className="h-3 w-3 text-text-tertiary shrink-0" /> : <ChevronRight className="h-3 w-3 text-text-tertiary shrink-0" />}
                <span className="pf-text-xs font-semibold text-text-primary truncate">{svc.name}</span>
                <span className="pf-text-xxs text-text-disabled ml-auto">{svc.methods.length}</span>
              </button>
              {isExpanded && filteredMethods.map((method) => (
                <button
                  key={method.fullName}
                  className={cn(
                    "flex w-full items-center gap-1.5 px-2 py-1 pl-7 hover:bg-bg-hover/50 transition-colors text-left pf-text-xs",
                    selectedMethod === method.fullName && "bg-accent/10 text-accent",
                  )}
                  onClick={() => onSelectMethod(method, svc)}
                >
                  <span className={cn("pf-mtag pf-text-xxs font-bold shrink-0 w-[64px]", methodKindToneClass(method.kind))}>
                    {getMethodKindLabel(method.kind)}
                  </span>
                  <span className="truncate text-text-secondary">{method.name}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main workspace ──

export const GrpcWorkspace = memo(function GrpcWorkspace({ tabId }: { tabId: string }) {
  const { t } = useTranslation();
  const activeTab = useAppStore((s) => s.tabs.find((tab) => tab.id === tabId));
  const setTabProtocol = useAppStore((s) => s.setTabProtocol);

  // Proto state
  const [protoResult, setProtoResult] = useState<ProtoLoadResult | null>(null);
  const [protoKey, setProtoKey] = useState<string>("");
  const [protoLoading, setProtoLoading] = useState(false);
  const [protoError, setProtoError] = useState<string | null>(null);

  // Method selection
  const [selectedMethod, setSelectedMethod] = useState<GrpcMethodInfo | null>(null);
  const [selectedService, setSelectedService] = useState<GrpcServiceInfo | null>(null);

  // Request
  const [url, setUrl] = useState("http://localhost:50051");
  const [requestJson, setRequestJson] = useState("{}");
  const [metadata] = useState("{}");
  const [tlsEnabled, setTlsEnabled] = useState(false);

  // Response
  const [response, setResponse] = useState<GrpcCallResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Streaming
  const [streaming, setStreaming] = useState(false);
  const [streamMessages, setStreamMessages] = useState<StreamPreviewEvent[]>([]);
  const [streamDroppedCount, setStreamDroppedCount] = useState(0);
  const activeStreamGenerationRef = useRef<number | null>(null);
  const streamStartingRef = useRef(false);
  const pendingStartEventsRef = useRef<GrpcStreamEvent[]>([]);
  const connectionId = activeTab
    ? requestConnectionId(activeTab, "grpc")
    : `grpc-${tabId}-detached`;

  const handleIncomingStreamEvent = useCallback((event: GrpcStreamEvent) => {
    if (event.droppedCount > 0) {
      setStreamDroppedCount((previous) => previous + event.droppedCount);
    }
    if (event.eventType === "data") {
      setStreamMessages((previous) => appendStreamPreview(previous, event));
    } else if (event.eventType === "completed") {
      activeStreamGenerationRef.current = null;
      setStreaming(false);
    } else if (event.eventType === "error") {
      activeStreamGenerationRef.current = null;
      setError(event.data ?? "Stream error");
      setStreaming(false);
    }
  }, []);

  const activateStreamGeneration = useCallback((generation: number) => {
    activeStreamGenerationRef.current = generation;
    streamStartingRef.current = false;
    const pending = pendingStartEventsRef.current;
    pendingStartEventsRef.current = [];
    for (const event of pending) {
      if (event.generation === generation) {
        handleIncomingStreamEvent(event);
      }
    }
  }, [handleIncomingStreamEvent]);

  // Listen for stream events. Events can race the invoke response that carries
  // the generation, so retain a small bounded start buffer and flush only the
  // generation returned by the backend.
  useEffect(() => {
    activeStreamGenerationRef.current = null;
    streamStartingRef.current = false;
    pendingStartEventsRef.current = [];
    const unlisten = listen<GrpcStreamEvent>("grpc-stream-event", (e) => {
      if (e.payload.connectionId !== connectionId) return;
      if (e.payload.generation === activeStreamGenerationRef.current) {
        handleIncomingStreamEvent(e.payload);
        return;
      }
      if (streamStartingRef.current && activeStreamGenerationRef.current === null) {
        const pending = pendingStartEventsRef.current;
        pending.push(e.payload);
        if (pending.length > MAX_PENDING_START_EVENTS) {
          pending.splice(0, pending.length - MAX_PENDING_START_EVENTS);
        }
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, [connectionId, handleIncomingStreamEvent]);

  // Load proto file
  const handleLoadProto = useCallback(async () => {
    const path = await grpcService.pickProtoFile();
    if (!path) return;

    setProtoLoading(true);
    setProtoError(null);
    try {
      const result = await grpcService.loadProtoFile(path);
      setProtoResult(result);
      setProtoKey(path);
      setSelectedMethod(null);
      setSelectedService(null);
    } catch (e: any) {
      setProtoError(String(e));
    } finally {
      setProtoLoading(false);
    }
  }, []);

  // Reflect from server
  const handleReflect = useCallback(async () => {
    if (!url.trim()) return;

    setProtoLoading(true);
    setProtoError(null);
    try {
      const result = await grpcService.reflectServices(url, tlsEnabled);
      setProtoResult(result);
      setProtoKey(`reflect:${url}`);
      setSelectedMethod(null);
      setSelectedService(null);
    } catch (e: any) {
      setProtoError(String(e));
    } finally {
      setProtoLoading(false);
    }
  }, [url, tlsEnabled]);

  // Select method
  const handleSelectMethod = useCallback((method: GrpcMethodInfo, service: GrpcServiceInfo) => {
    setSelectedMethod(method);
    setSelectedService(service);
    setRequestJson(buildRequestTemplate(method.inputFields));
    setResponse(null);
    setError(null);
    setStreamMessages([]);
  }, []);

  // Send request / start stream
  const handleSend = useCallback(async () => {
    if (!selectedMethod || !protoKey) return;

    setLoading(true);
    setError(null);
    setResponse(null);
    setStreamMessages([]);
    setStreamDroppedCount(0);

    try {
      let parsedMetadata: Record<string, string> = {};
      try {
        parsedMetadata = JSON.parse(metadata.trim() || "{}");
      } catch {}

      const kind = selectedMethod.kind;

      if (kind === "unary") {
        activeStreamGenerationRef.current = null;
        streamStartingRef.current = false;
        pendingStartEventsRef.current = [];
        const result = await grpcService.callUnary(
          url, tlsEnabled, protoKey, selectedMethod.fullName, requestJson, parsedMetadata,
        );
        setResponse(result);
      } else if (kind === "serverStreaming") {
        activeStreamGenerationRef.current = null;
        streamStartingRef.current = true;
        pendingStartEventsRef.current = [];
        setStreaming(true);
        const generation = await grpcService.callServerStream(
          connectionId, url, tlsEnabled, protoKey, selectedMethod.fullName, requestJson, parsedMetadata,
        );
        activateStreamGeneration(generation);
      } else if (kind === "clientStreaming") {
        activeStreamGenerationRef.current = null;
        streamStartingRef.current = true;
        pendingStartEventsRef.current = [];
        setStreaming(true);
        const generation = await grpcService.callClientStream(
          connectionId, url, tlsEnabled, protoKey, selectedMethod.fullName, parsedMetadata,
        );
        activateStreamGeneration(generation);
      } else if (kind === "bidiStreaming") {
        activeStreamGenerationRef.current = null;
        streamStartingRef.current = true;
        pendingStartEventsRef.current = [];
        setStreaming(true);
        const generation = await grpcService.callBidiStream(
          connectionId, url, tlsEnabled, protoKey, selectedMethod.fullName, parsedMetadata,
        );
        activateStreamGeneration(generation);
      }
    } catch (e: any) {
      activeStreamGenerationRef.current = null;
      streamStartingRef.current = false;
      pendingStartEventsRef.current = [];
      setStreaming(false);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedMethod, protoKey, url, tlsEnabled, requestJson, metadata, connectionId, activateStreamGeneration]);

  // Send a message on an active stream (client/bidi)
  const handleStreamSend = useCallback(async () => {
    if (!selectedMethod || !protoKey || !streaming) return;
    const generation = activeStreamGenerationRef.current;
    if (generation === null) return;
    try {
      await grpcService.streamSend(connectionId, protoKey, selectedMethod.fullName, requestJson);
      setStreamMessages((prev) => appendStreamPreview(prev, {
        connectionId,
        generation,
        eventType: "data" as const,
        data: requestJson,
        droppedCount: 0,
        timestamp: new Date().toISOString(),
      }));
    } catch (e: any) {
      setError(String(e));
    }
  }, [selectedMethod, protoKey, streaming, connectionId, requestJson]);

  // Close the send side
  const handleCloseSend = useCallback(async () => {
    try {
      await grpcService.streamCloseSend(connectionId);
    } catch {}
  }, [connectionId]);

  // Cancel stream
  const handleCancel = useCallback(async () => {
    try {
      await grpcService.cancelStream(connectionId);
    } catch {}
    activeStreamGenerationRef.current = null;
    streamStartingRef.current = false;
    pendingStartEventsRef.current = [];
    setStreaming(false);
  }, [connectionId]);

  // Copy response
  const handleCopy = useCallback(() => {
    const text = response?.responseJson ?? streamMessages.map((m) => m.data).join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [response, streamMessages]);

  if (!activeTab) return null;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <RequestWorkbenchHeader
        prefix={
          <RequestProtocolSwitcher
            activeProtocol={activeTab.protocol}
            onChange={(kind) => {
              if (kind === "grpc") return;
              if (kind === "ws" || kind === "mqtt") {
                setTabProtocol(tabId, kind);
              } else {
                setTabProtocol(tabId, "http");
              }
            }}
          />
        }
        main={
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="localhost:50051"
            className="wb-request-input"
          />
        }
        actions={
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setTlsEnabled((v) => !v)}
              className={cn("wb-ghost-btn pf-text-xs inline-flex items-center gap-1", tlsEnabled && "text-success")}
              title={t('grpc.tlsEnabled')}
            >
              <Lock className="h-3.5 w-3.5" /> {t('grpc.tls')}
            </button>
            <button onClick={handleLoadProto} disabled={protoLoading} className="wb-ghost-btn pf-text-xs inline-flex items-center gap-1">
              <FolderOpen className="h-3.5 w-3.5" /> {t('grpc.loadProto')}
            </button>
            <button onClick={handleReflect} disabled={protoLoading || !url.trim()} className="wb-ghost-btn pf-text-xs inline-flex items-center gap-1">
              <RefreshCw className={cn("h-3.5 w-3.5", protoLoading && "animate-spin")} /> {t('grpc.reflect')}
            </button>
          </div>
        }
      />

      {/* Error bar */}
      {protoError && (
        <div className="px-4 py-1.5 bg-error/10 text-error pf-text-xs border-b border-error/20 truncate">
          {protoError}
        </div>
      )}

      {/* Main content */}
      {protoLoading && !protoResult ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-text-disabled">
          <div className="mb-4 flex h-14 w-14 items-center justify-center pf-rounded-lg border border-border-default/60 bg-bg-primary/78">
            <Loader2 className="h-7 w-7 animate-spin text-accent" />
          </div>
          <p className="pf-text-base font-medium text-text-secondary">{t('grpc.reflect')}…</p>
          <p className="mt-1 pf-text-xs">{t('grpc.noProtoHint')}</p>
        </div>
      ) : !protoResult ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-text-disabled">
          <div className="mb-4 flex h-14 w-14 items-center justify-center pf-rounded-lg border border-border-default/60 bg-bg-primary/78">
            <Boxes className="h-8 w-8 opacity-20 text-accent" />
          </div>
          <p className="pf-text-base font-medium text-text-secondary">{t('grpc.noProto')}</p>
          <p className="mt-1 pf-text-xs">{t('grpc.noProtoHint')}</p>
          <div className="mt-4 flex items-center gap-2">
            <button onClick={handleLoadProto} disabled={protoLoading} className="wb-ghost-btn pf-text-xs inline-flex items-center gap-1.5 disabled:opacity-50">
              <FolderOpen className="h-3.5 w-3.5" /> {t('grpc.loadProto')}
            </button>
            <button onClick={handleReflect} disabled={protoLoading || !url.trim()} className="wb-primary-btn min-w-[88px] bg-accent hover:bg-accent-hover disabled:opacity-50">
              <RefreshCw className={cn("h-3.5 w-3.5", protoLoading && "animate-spin")} /> {t('grpc.reflect')}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0">
          {/* Service tree */}
          <div className="w-[260px] shrink-0">
            <ServiceTree
              services={protoResult.services}
              selectedMethod={selectedMethod?.fullName ?? null}
              onSelectMethod={handleSelectMethod}
            />
          </div>

          {/* Request/Response area */}
          <div className="flex-1 flex flex-col min-w-0">
            {selectedMethod ? (
              <>
                {/* Method header */}
                <div className="flex items-center gap-2 px-4 py-2 border-b border-border-default/60">
                  <span className={cn("pf-mtag pf-text-xs font-bold", methodKindToneClass(selectedMethod.kind))}>
                    {getMethodKindLabel(selectedMethod.kind)}
                  </span>
                  <span className="pf-text-sm font-mono text-text-primary truncate">
                    {selectedService?.name}.{selectedMethod.name}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    {streaming && (selectedMethod.kind === "clientStreaming" || selectedMethod.kind === "bidiStreaming") && (
                      <>
                        <button
                          onClick={handleStreamSend}
                          className="wb-ghost-btn pf-text-xs inline-flex items-center gap-1 text-success"
                        >
                          <Play className="h-3 w-3" /> {t('grpc.streamSend')}
                        </button>
                        <button onClick={handleCloseSend} className="wb-ghost-btn pf-text-xs inline-flex items-center gap-1 text-warning">
                          {t('grpc.closeSend')}
                        </button>
                      </>
                    )}
                    {streaming && (
                      <button onClick={handleCancel} className="wb-ghost-btn pf-text-xs inline-flex items-center gap-1 text-error">
                        <Square className="h-3.5 w-3.5" /> {t('grpc.cancel')}
                      </button>
                    )}
                    {!streaming && (
                      <button
                        onClick={handleSend}
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 pf-rounded-sm bg-accent hover:bg-accent-hover text-white pf-text-xs font-medium disabled:opacity-50"
                      >
                        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                        {selectedMethod.kind === "unary" || selectedMethod.kind === "serverStreaming" ? t('grpc.send') : t('grpc.startStream')}
                      </button>
                    )}
                  </div>
                </div>

                {/* Request/Response split */}
                <div className="flex-1 grid grid-rows-2 min-h-0">
                  {/* Request editor */}
                  <div className="flex flex-col min-h-0 border-b border-border-default/60">
                    <div className="px-4 py-1.5 pf-text-xxs text-text-disabled uppercase tracking-wider border-b border-border-default/30 flex items-center gap-2">
                      <span>Request</span>
                      <span className="font-mono text-text-tertiary">{selectedMethod.inputType.split('.').pop()}</span>
                    </div>
                    <div className="flex-1 min-h-0 overflow-hidden">
                      <JsonEditorLite
                        value={requestJson}
                        onChange={setRequestJson}
                        className="h-full bg-transparent"
                      />
                    </div>
                  </div>

                  {/* Response */}
                  <div className="flex flex-col min-h-0">
                    <div className="px-4 py-1.5 pf-text-xxs text-text-disabled uppercase tracking-wider border-b border-border-default/30 flex items-center gap-2">
                      <span>Response</span>
                      {response && (
                        <>
                          <span className={cn("inline-flex items-center gap-1.5", response.statusCode === 0 ? "text-success" : "text-error")}>
                            <span className={cn("pf-dot", response.statusCode === 0 ? "s-ok" : "s-err")} />
                            {response.statusCode === 0 ? "OK" : `Code ${response.statusCode}`}
                          </span>
                          <span className="text-text-tertiary tabular-nums">{response.durationMs}ms</span>
                        </>
                      )}
                      {streaming && <span className="text-accent inline-flex items-center gap-1.5"><span className="pf-dot s-live" /> Streaming ({streamMessages.length})</span>}
                      {streamDroppedCount > 0 && <span className="text-warning tabular-nums">Dropped {streamDroppedCount}</span>}
                      <button onClick={handleCopy} aria-label={t('common.copy')} className="ml-auto p-0.5 text-text-tertiary hover:text-text-secondary">
                        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      </button>
                    </div>
                    <div className="flex-1 min-h-0 overflow-auto">
                      {error && (
                        <div className="m-3 pf-rounded-md border border-error/30 bg-error/10 px-3 py-2.5">
                          <div className="mb-1 flex items-center gap-1.5 pf-text-xxs font-bold uppercase tracking-wide text-error">
                            <span className="pf-dot s-err" /> Error
                          </div>
                          <pre className="selectable whitespace-pre-wrap break-words font-mono pf-text-xs leading-[1.6] text-error">{error}</pre>
                        </div>
                      )}
                      {response && (
                        <ResponseViewer
                          body={response.responseJson}
                          contentType="application/json"
                        />
                      )}
                      {streamMessages.length > 0 && (
                        <div className="divide-y divide-border-default/30">
                          {streamMessages.map((msg, i) => {
                            const isSent = msg.connectionId === connectionId && msg.eventType === "data" && !msg.statusCode;
                            return (
                              <div key={i} className={cn("px-3 py-1.5 transition-colors hover:bg-bg-hover/40", isSent && "bg-accent-soft/30")}>
                                <div className="mb-0.5 flex items-center gap-2 pf-text-3xs text-text-disabled">
                                  {isSent ? (
                                    <ArrowUp className="h-3 w-3 shrink-0 text-method-post" />
                                  ) : (
                                    <ArrowDown className="h-3 w-3 shrink-0 text-method-get" />
                                  )}
                                  <span className="shrink-0 font-mono tabular-nums text-text-tertiary">{new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                                  <span className={cn("shrink-0 font-mono pf-text-3xs font-bold uppercase tracking-wide", isSent ? "text-method-post" : "text-method-get")}>
                                    {isSent ? '↑ SEND' : '↓ RECV'}
                                  </span>
                                  <span className="ml-auto shrink-0 tabular-nums">#{i + 1}</span>
                                </div>
                                <pre className="whitespace-pre-wrap break-all pl-5 pf-text-xs font-mono leading-[1.6] text-text-primary">{msg.data}</pre>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {loading && !response && streamMessages.length === 0 && (
                        <div className="flex h-full flex-col items-center justify-center px-6 text-text-disabled">
                          <Loader2 className="mb-3 h-6 w-6 animate-spin text-accent" />
                          <p className="pf-text-xs">{t('grpc.send')}…</p>
                        </div>
                      )}
                      {!loading && !error && !response && !streaming && streamMessages.length === 0 && (
                        <div className="flex h-full flex-col items-center justify-center px-6 text-text-disabled">
                          <div className="mb-4 flex h-14 w-14 items-center justify-center pf-rounded-lg border border-border-default/60 bg-bg-primary/78">
                            <Inbox className="h-8 w-8 opacity-20 text-accent" />
                          </div>
                          <p className="pf-text-base font-medium text-text-secondary">{t('grpc.noResponse')}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center px-6 text-text-disabled">
                <div className="mb-4 flex h-14 w-14 items-center justify-center pf-rounded-lg border border-border-default/60 bg-bg-primary/78">
                  <MousePointerClick className="h-8 w-8 opacity-20 text-accent" />
                </div>
                <p className="pf-text-base font-medium text-text-secondary">{t('grpc.selectMethod')}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
