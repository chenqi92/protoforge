// ProtoForge Workflow Workspace — visual workflow orchestration (Enhanced)
// Layout: sidebar (workflow list + categorized node palette) | canvas (React Flow) | right panel (config + results)
// Features: resizable panels, categorized drag cards, custom node shapes, edge labels, fullscreen mode

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  NodeToolbar,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Node,
  type Edge,
  type EdgeProps,
  type Connection,
  type NodeTypes,
  type EdgeTypes,
  type OnConnect,
  type EdgeChange,
  Handle,
  Position,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
  Plus, Trash2, Play, Square, Save, Search, Loader2, Pencil,
  Globe, Plug, Radio, Clock, Code, Filter, Lock, Unlock,
  ChevronRight, ChevronDown, X, CheckCircle2, XCircle,
  Workflow as WorkflowIcon, Maximize2, Minimize2,
  GitBranch, Repeat, Columns, Variable, MessageSquare,
  CheckSquare, PlayCircle, StopCircle, FileJson, Braces,
  CaseSensitive, Link2, Unlink2, Hash, CalendarClock,
  Fingerprint, Copy, ArrowLeftRight, Maximize, Eraser,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { useContextMenu, type ContextMenuEntry } from '@/components/ui/ContextMenu';
import { useThemeStore } from '@/stores/themeStore';
import { useWorkflowStore } from '@/stores/workflowStore';
import type {
  Workflow, FlowNode, FlowEdge, NodeType, NodeResult, ExecutionStatus,
} from '@/types/workflow';
import { NODE_TYPE_META, NODE_CATEGORIES } from '@/types/workflow';

// ── Icon mapping ──
const NODE_ICONS: Record<NodeType, typeof Globe> = {
  httpRequest: Globe,
  tcpSend: Plug,
  udpSend: Radio,
  delay: Clock,
  script: Code,
  extractData: Filter,
  jsonParse: FileJson,
  jsonStringify: Braces,
  textTransform: CaseSensitive,
  base64Encode: Lock,
  base64Decode: Unlock,
  urlEncode: Link2,
  urlDecode: Unlink2,
  hash: Hash,
  condition: GitBranch,
  loop: Repeat,
  parallel: Columns,
  setVariable: Variable,
  timestamp: CalendarClock,
  uuid: Fingerprint,
  log: MessageSquare,
  assertion: CheckSquare,
  start: PlayCircle,
  end: StopCircle,
};

// ── Default configs per node type ──
function defaultConfig(nodeType: NodeType): Record<string, unknown> {
  switch (nodeType) {
    case 'httpRequest': return { method: 'GET', url: '', headers: {}, queryParams: {}, timeoutMs: 30000, followRedirects: true, sslVerify: true };
    case 'tcpSend': return { host: '127.0.0.1', port: 8080, data: '', encoding: 'utf8', readTimeoutMs: 5000 };
    case 'udpSend': return { targetHost: '127.0.0.1', targetPort: 8080, data: '', encoding: 'utf8', readTimeoutMs: 5000 };
    case 'delay': return { delayMs: 1000 };
    case 'script': return { script: '' };
    case 'extractData': return { source: '', mode: 'jsonPath', expression: '' };
    case 'jsonParse': return { input: '' };
    case 'jsonStringify': return { input: '', pretty: true };
    case 'textTransform': return { input: '', operation: 'trim', search: '', replacement: '' };
    case 'base64Encode': return { input: '' };
    case 'base64Decode': return { input: '' };
    case 'urlEncode': return { input: '' };
    case 'urlDecode': return { input: '' };
    case 'hash': return { input: '', algorithm: 'sha256' };
    case 'condition': return { expression: '' };
    case 'loop': return { iterations: 3 };
    case 'parallel': return { maxConcurrency: 0 };
    case 'setVariable': return { key: '', value: '' };
    case 'timestamp': return { format: 'iso8601' };
    case 'uuid': return {};
    case 'log': return { message: '', level: 'info' };
    case 'assertion': return { target: '', operator: 'equals', expected: '', name: '' };
    case 'start': return {};
    case 'end': return {};
  }
}

// ═══════════════════════════════════════════
//  Custom React Flow Nodes (multiple shapes)
// ═══════════════════════════════════════════

interface FlowNodeData {
  label: string;
  nodeType: NodeType;
  status?: ExecutionStatus;
  onDelete?: (id: string) => void;
  onDuplicate?: (id: string) => void;
}

/** Toolbar shown on selected node — Delete + Duplicate buttons */
function NodeActionToolbar({ nodeId, data }: { nodeId: string; data: FlowNodeData }) {
  const { t } = useTranslation();
  return (
    <NodeToolbar isVisible={undefined} position={Position.Top} offset={6}>
      <div className="flex items-center gap-1 pf-rounded-md bg-bg-elevated border border-border-default shadow-md p-0.5">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); data.onDuplicate?.(nodeId); }}
          title={t('workflow.menu.duplicateNode')}
          className="flex h-6 w-6 items-center justify-center pf-rounded-sm text-text-tertiary hover:bg-bg-hover hover:text-text-primary transition-colors"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); data.onDelete?.(nodeId); }}
          title={t('workflow.menu.deleteNode')}
          className="flex h-6 w-6 items-center justify-center pf-rounded-sm text-text-tertiary hover:bg-red-500 hover:text-white transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </NodeToolbar>
  );
}

/** Standard rectangle node */
function RectangleNode({ id, data }: { id: string; data: FlowNodeData }) {
  const Icon = NODE_ICONS[data.nodeType] || Globe;
  const meta = NODE_TYPE_META[data.nodeType];
  const isRunning = data.status === 'running';
  const isDone = data.status === 'completed';
  const isFailed = data.status === 'failed';
  const hCls = '!w-3 !h-3 !bg-accent !border-2 !border-bg-primary';

  return (
    <div className={cn(
      'px-3 py-2 pf-rounded-lg border-2 bg-bg-primary shadow-sm min-w-[160px] transition-colors',
      isRunning && 'border-amber-500 ring-2 ring-amber-500/20',
      isDone && 'border-emerald-500',
      isFailed && 'border-red-500',
      !isRunning && !isDone && !isFailed && 'border-border-default',
    )}>
      <NodeActionToolbar nodeId={id} data={data} />
      {/* Each direction has both source+target so you can drag from AND drop onto any point */}
      <Handle type="target" position={Position.Top} id="top-target" className={hCls} />
      <Handle type="source" position={Position.Top} id="top-source" className={cn(hCls, '!bg-transparent')} />
      <Handle type="target" position={Position.Bottom} id="bottom-target" className={cn(hCls, '!bg-transparent')} />
      <Handle type="source" position={Position.Bottom} id="bottom-source" className={hCls} />
      <Handle type="target" position={Position.Left} id="left-target" className={hCls} />
      <Handle type="source" position={Position.Left} id="left-source" className={cn(hCls, '!bg-transparent')} />
      <Handle type="target" position={Position.Right} id="right-target" className={cn(hCls, '!bg-transparent')} />
      <Handle type="source" position={Position.Right} id="right-source" className={hCls} />
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md" style={{ backgroundColor: meta.color + '20' }}>
          <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="pf-text-xs font-semibold text-text-primary truncate">{data.label}</div>
          <div className="pf-text-xxs text-text-disabled">{meta.label}</div>
        </div>
        {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500 shrink-0" />}
        {isDone && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
        {isFailed && <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />}
      </div>
    </div>
  );
}

/** Circle node (start/end) */
function CircleNode({ id, data }: { id: string; data: FlowNodeData }) {
  const Icon = NODE_ICONS[data.nodeType] || Globe;
  const meta = NODE_TYPE_META[data.nodeType];
  const isEnd = data.nodeType === 'end';
  const isStart = data.nodeType === 'start';
  const isRunning = data.status === 'running';
  const isDone = data.status === 'completed';
  const isFailed = data.status === 'failed';
  const hCls = '!w-3 !h-3 !bg-accent !border-2 !border-bg-primary';

  return (
    <div className={cn(
      'flex h-14 w-14 items-center justify-center rounded-full border-2 bg-bg-primary shadow-sm transition-colors',
      isEnd && 'ring-2 ring-offset-1',
      isRunning && 'border-amber-500 ring-amber-500/20',
      isDone && 'border-emerald-500',
      isFailed && 'border-red-500',
      !isRunning && !isDone && !isFailed && 'border-border-default',
    )} style={isEnd && !isRunning && !isDone && !isFailed ? { boxShadow: `0 0 0 3px ${meta.color}40` } : undefined}>
      <NodeActionToolbar nodeId={id} data={data} />
      {/* Start: only source handles (outgoing). End: only target handles (incoming). */}
      {!isStart && <Handle type="target" position={Position.Top} id="top-target" className={hCls} />}
      {!isStart && <Handle type="target" position={Position.Left} id="left-target" className={hCls} />}
      {!isStart && <Handle type="target" position={Position.Bottom} id="bottom-target" className={cn(hCls, '!bg-transparent')} />}
      {!isStart && <Handle type="target" position={Position.Right} id="right-target" className={cn(hCls, '!bg-transparent')} />}
      <Icon className="h-5 w-5" style={{ color: meta.color }} />
      {!isEnd && <Handle type="source" position={Position.Bottom} id="bottom-source" className={hCls} />}
      {!isEnd && <Handle type="source" position={Position.Right} id="right-source" className={hCls} />}
      {!isEnd && <Handle type="source" position={Position.Top} id="top-source" className={cn(hCls, '!bg-transparent')} />}
      {!isEnd && <Handle type="source" position={Position.Left} id="left-source" className={cn(hCls, '!bg-transparent')} />}
    </div>
  );
}

/** Diamond node (condition) */
function DiamondNode({ id, data }: { id: string; data: FlowNodeData }) {
  const Icon = NODE_ICONS[data.nodeType] || Globe;
  const meta = NODE_TYPE_META[data.nodeType];
  const isRunning = data.status === 'running';
  const isDone = data.status === 'completed';
  const isFailed = data.status === 'failed';
  const hCls = '!w-3 !h-3 !bg-accent !border-2 !border-bg-primary';

  return (
    <div className="relative" style={{ width: 80, height: 80 }}>
      <NodeActionToolbar nodeId={id} data={data} />
      {/* Each direction: source + target overlaid */}
      <Handle type="target" position={Position.Top} id="top-target" className={hCls} style={{ top: -5 }} />
      <Handle type="source" position={Position.Top} id="top-source" className={cn(hCls, '!bg-transparent')} style={{ top: -5 }} />
      <Handle type="target" position={Position.Left} id="left-target" className={hCls} style={{ left: -5 }} />
      <Handle type="source" position={Position.Left} id="left-source" className="!w-3 !h-3 !bg-red-500 !border-2 !border-bg-primary" style={{ left: -5 }} />
      <div
        className={cn(
          'absolute inset-0 border-2 bg-bg-primary shadow-sm transition-colors',
          isRunning && 'border-amber-500 ring-2 ring-amber-500/20',
          isDone && 'border-emerald-500',
          isFailed && 'border-red-500',
          !isRunning && !isDone && !isFailed && 'border-border-default',
        )}
        style={{ transform: 'rotate(45deg)', borderRadius: 8 }}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <Icon className="h-4 w-4" style={{ color: meta.color }} />
        <span className="pf-text-xxs font-semibold text-text-primary mt-0.5 truncate max-w-[60px]">{data.label}</span>
      </div>
      <Handle type="target" position={Position.Bottom} id="bottom-target" className={cn(hCls, '!bg-transparent')} style={{ bottom: -5 }} />
      <Handle type="source" position={Position.Bottom} id="bottom-source" className={hCls} style={{ bottom: -5 }} />
      <Handle type="target" position={Position.Right} id="right-target" className={cn(hCls, '!bg-transparent')} style={{ right: -5 }} />
      <Handle type="source" position={Position.Right} id="right-source" className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-bg-primary" style={{ right: -5 }} />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  flowNode: RectangleNode,
  circleNode: CircleNode,
  diamondNode: DiamondNode,
};

// ═══════════════════════════════════════════
//  Custom Edge with label
// ═══════════════════════════════════════════

function LabeledEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, style, selected }: EdgeProps) {
  const { t } = useTranslation();
  const reactFlowInstance = useReactFlow();
  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const edgeData = data as Record<string, unknown> | undefined;
  const edgeLabel = edgeData?.label as string | undefined;
  const onDelete = edgeData?.onDelete as ((id: string) => void) | undefined;
  const [hovered, setHovered] = useState(false);
  const showDelete = (selected || hovered) && Boolean(onDelete);

  // Wrap the visible edge with an invisible wider hit-area path so hover detection is reliable
  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => reactFlowInstance.setEdges((eds) => eds.map((e) => ({ ...e, selected: e.id === id })))}
        style={{ cursor: 'pointer' }}
      />
      <EdgeLabelRenderer>
        <div
          className="flex items-center gap-1 pointer-events-auto"
          style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {edgeLabel && (
            <div className="pf-text-xxs font-medium px-1.5 py-0.5 pf-rounded-md bg-bg-primary border border-border-default/60 text-text-secondary shadow-sm">
              {edgeLabel}
            </div>
          )}
          {showDelete && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete?.(id); }}
              title={t('workflow.menu.deleteEdgeTip')}
              className="flex h-4 w-4 items-center justify-center pf-rounded-sm bg-bg-primary border border-border-default text-text-tertiary hover:bg-red-500 hover:border-red-500 hover:text-white shadow-sm transition-colors"
            >
              <X className="h-2.5 w-2.5" strokeWidth={3} />
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const edgeTypes: EdgeTypes = { labeled: LabeledEdge };

// ═══════════════════════════════════════════
//  Workflow ↔ React Flow Conversion
// ═══════════════════════════════════════════

function getNodeRfType(nodeType: NodeType): string {
  const meta = NODE_TYPE_META[nodeType];
  if (meta.shape === 'circle') return 'circleNode';
  if (meta.shape === 'diamond') return 'diamondNode';
  return 'flowNode';
}

function toRfNodes(
  nodes: FlowNode[],
  nodeResults: NodeResult[],
  onDeleteNode?: (id: string) => void,
  onDuplicateNode?: (id: string) => void,
): Node[] {
  return nodes.map((n, i) => {
    const result = nodeResults.find((r) => r.nodeId === n.id);
    return {
      id: n.id,
      type: getNodeRfType(n.nodeType),
      position: n.position || { x: 250, y: i * 120 },
      data: {
        label: n.name,
        nodeType: n.nodeType,
        status: result?.status,
        onDelete: onDeleteNode,
        onDuplicate: onDuplicateNode,
      },
    };
  });
}

function toRfEdges(edges: FlowEdge[], onDeleteEdge?: (id: string) => void): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.sourceNodeId,
    target: e.targetNodeId,
    sourceHandle: e.sourceHandle || undefined,
    type: 'labeled',
    data: { label: e.label, onDelete: onDeleteEdge },
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    style: { strokeWidth: 2 },
    animated: false,
  }));
}

// ═══════════════════════════════════════════
//  Node Config Panel (enhanced with new types)
// ═══════════════════════════════════════════

function NodeConfigPanel({
  node, onChange, onClose,
}: {
  node: FlowNode;
  onChange: (updates: Partial<FlowNode>) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const config = node.config || {};

  const updateConfig = (key: string, value: unknown) => {
    onChange({ config: { ...config, [key]: value } });
  };

  const fieldCls = 'h-8 w-full pf-rounded-lg border border-border-default/60 bg-bg-secondary/40 px-3 pf-text-xs text-text-primary outline-none placeholder:text-text-disabled focus:border-accent/40 focus:ring-1 focus:ring-accent/20';
  const labelCls = 'pf-text-xs font-semibold text-text-secondary mb-1 block';
  const textareaCls = 'w-full pf-rounded-lg border border-border-default/60 bg-bg-secondary/40 px-3 py-2 pf-text-xs text-text-primary font-mono outline-none placeholder:text-text-disabled focus:border-accent/40 focus:ring-1 focus:ring-accent/20 resize-none';

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-default/60 shrink-0">
        <div className="flex items-center gap-2">
          <span className="pf-text-sm font-semibold text-text-primary">{t('workflow.nodeConfig')}</span>
        </div>
        <button onClick={onClose} className="wb-icon-btn"><X className="h-3.5 w-3.5" /></button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        {/* Name */}
        <div>
          <label className={labelCls}>{t('workflow.name')}</label>
          <input value={node.name} onChange={(e) => onChange({ name: e.target.value })} className={fieldCls} />
        </div>

        {/* Type-specific config */}
        {node.nodeType === 'httpRequest' && (
          <>
            <div className="grid grid-cols-[80px_1fr] gap-2">
              <div>
                <label className={labelCls}>{t('workflow.nodeFields.method')}</label>
                <select value={(config.method as string) || 'GET'} onChange={(e) => updateConfig('method', e.target.value)} className={fieldCls}>
                  {['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>{t('workflow.nodeFields.url')}</label>
                <input value={(config.url as string) || ''} onChange={(e) => updateConfig('url', e.target.value)} placeholder="https://api.example.com" className={fieldCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>{t('workflow.nodeFields.body')}</label>
              <textarea rows={4} value={typeof config.body === 'object' && config.body ? ((config.body as Record<string, unknown>).data as string || '') : ''} onChange={(e) => updateConfig('body', { type: 'json', data: e.target.value })} className={textareaCls} />
            </div>
            <div>
              <label className={labelCls}>{t('workflow.nodeFields.timeout')}</label>
              <input type="number" value={(config.timeoutMs as number) || 30000} onChange={(e) => updateConfig('timeoutMs', Number(e.target.value))} className={fieldCls} />
            </div>
          </>
        )}

        {(node.nodeType === 'tcpSend' || node.nodeType === 'udpSend') && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>{t('workflow.nodeFields.host')}</label>
                <input value={(config.host as string) || (config.targetHost as string) || ''} onChange={(e) => updateConfig(node.nodeType === 'tcpSend' ? 'host' : 'targetHost', e.target.value)} className={fieldCls} />
              </div>
              <div>
                <label className={labelCls}>{t('workflow.nodeFields.port')}</label>
                <input type="number" value={(config.port as number) || (config.targetPort as number) || 0} onChange={(e) => updateConfig(node.nodeType === 'tcpSend' ? 'port' : 'targetPort', Number(e.target.value))} className={fieldCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>{t('workflow.nodeFields.data')}</label>
              <textarea rows={3} value={(config.data as string) || ''} onChange={(e) => updateConfig('data', e.target.value)} className={textareaCls} />
            </div>
            <div>
              <label className={labelCls}>{t('workflow.nodeFields.encoding')}</label>
              <select value={(config.encoding as string) || 'utf8'} onChange={(e) => updateConfig('encoding', e.target.value)} className={fieldCls}>
                <option value="utf8">UTF-8</option>
                <option value="hex">Hex</option>
              </select>
            </div>
          </>
        )}

        {node.nodeType === 'delay' && (
          <div>
            <label className={labelCls}>{t('workflow.nodeFields.delayMs')}</label>
            <input type="number" value={(config.delayMs as number) || 1000} onChange={(e) => updateConfig('delayMs', Number(e.target.value))} className={fieldCls} />
          </div>
        )}

        {node.nodeType === 'script' && (
          <div>
            <label className={labelCls}>{t('workflow.nodeFields.script')}</label>
            <textarea rows={10} value={(config.script as string) || ''} onChange={(e) => updateConfig('script', e.target.value)} placeholder="// JavaScript" className={cn(textareaCls, 'min-h-[200px]')} />
          </div>
        )}

        {node.nodeType === 'extractData' && (
          <>
            <div>
              <label className={labelCls}>{t('workflow.nodeFields.source')}</label>
              <input value={(config.source as string) || ''} onChange={(e) => updateConfig('source', e.target.value)} placeholder="{{prev.body}}" className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>{t('workflow.nodeFields.mode')}</label>
              <select value={(config.mode as string) || 'jsonPath'} onChange={(e) => updateConfig('mode', e.target.value)} className={fieldCls}>
                <option value="jsonPath">JSON Path</option>
                <option value="regex">Regex</option>
                <option value="fixed">Fixed</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>{t('workflow.nodeFields.expression')}</label>
              <input value={(config.expression as string) || ''} onChange={(e) => updateConfig('expression', e.target.value)} placeholder="$.data.token" className={cn(fieldCls, 'font-mono')} />
            </div>
          </>
        )}

        {node.nodeType === 'jsonParse' && (
          <div>
            <label className={labelCls}>{t('workflow.nodeFields.input')}</label>
            <textarea rows={6} value={(config.input as string) || ''} onChange={(e) => updateConfig('input', e.target.value)} placeholder='{"ok":true}' className={textareaCls} />
          </div>
        )}

        {node.nodeType === 'jsonStringify' && (
          <>
            <div>
              <label className={labelCls}>{t('workflow.nodeFields.input')}</label>
              <textarea rows={6} value={(config.input as string) || ''} onChange={(e) => updateConfig('input', e.target.value)} placeholder='{"token":"abc"}' className={textareaCls} />
            </div>
            <label className="flex items-center gap-2 pf-text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={Boolean(config.pretty ?? true)}
                onChange={(e) => updateConfig('pretty', e.target.checked)}
                className="h-3.5 w-3.5 rounded border-border-default/60"
              />
              {t('workflow.nodeFields.pretty')}
            </label>
          </>
        )}

        {node.nodeType === 'textTransform' && (
          <>
            <div>
              <label className={labelCls}>{t('workflow.nodeFields.input')}</label>
              <textarea rows={5} value={(config.input as string) || ''} onChange={(e) => updateConfig('input', e.target.value)} className={textareaCls} />
            </div>
            <div>
              <label className={labelCls}>{t('workflow.nodeFields.transformOperation')}</label>
              <select value={(config.operation as string) || 'trim'} onChange={(e) => updateConfig('operation', e.target.value)} className={fieldCls}>
                <option value="trim">{t('workflow.operations.trim')}</option>
                <option value="uppercase">{t('workflow.operations.uppercase')}</option>
                <option value="lowercase">{t('workflow.operations.lowercase')}</option>
                <option value="replace">{t('workflow.operations.replace')}</option>
              </select>
            </div>
            {(config.operation as string) === 'replace' && (
              <>
                <div>
                  <label className={labelCls}>{t('workflow.nodeFields.search')}</label>
                  <input value={(config.search as string) || ''} onChange={(e) => updateConfig('search', e.target.value)} className={fieldCls} />
                </div>
                <div>
                  <label className={labelCls}>{t('workflow.nodeFields.replacement')}</label>
                  <input value={(config.replacement as string) || ''} onChange={(e) => updateConfig('replacement', e.target.value)} className={fieldCls} />
                </div>
              </>
            )}
          </>
        )}

        {(node.nodeType === 'base64Encode' || node.nodeType === 'base64Decode') && (
          <div>
            <label className={labelCls}>{t('workflow.nodeFields.input')}</label>
            <textarea rows={4} value={(config.input as string) || ''} onChange={(e) => updateConfig('input', e.target.value)} className={textareaCls} />
          </div>
        )}

        {(node.nodeType === 'urlEncode' || node.nodeType === 'urlDecode') && (
          <div>
            <label className={labelCls}>{t('workflow.nodeFields.input')}</label>
            <textarea rows={4} value={(config.input as string) || ''} onChange={(e) => updateConfig('input', e.target.value)} className={textareaCls} />
          </div>
        )}

        {node.nodeType === 'hash' && (
          <>
            <div>
              <label className={labelCls}>{t('workflow.nodeFields.input')}</label>
              <textarea rows={4} value={(config.input as string) || ''} onChange={(e) => updateConfig('input', e.target.value)} className={textareaCls} />
            </div>
            <div>
              <label className={labelCls}>{t('workflow.nodeFields.hashAlgorithm')}</label>
              <select value={(config.algorithm as string) || 'sha256'} onChange={(e) => updateConfig('algorithm', e.target.value)} className={fieldCls}>
                <option value="sha1">SHA-1</option>
                <option value="sha256">SHA-256</option>
              </select>
            </div>
          </>
        )}

        {/* ── New node types ── */}
        {node.nodeType === 'condition' && (
          <div>
            <label className={labelCls}>{t('workflow.nodeFields.condExpression')}</label>
            <input value={(config.expression as string) || ''} onChange={(e) => updateConfig('expression', e.target.value)} placeholder="{{prev.status}} == 200" className={cn(fieldCls, 'font-mono')} />
            <p className="pf-text-xxs text-text-disabled mt-1">支持模板变量引用，求值结果为 true/false</p>
          </div>
        )}

        {node.nodeType === 'loop' && (
          <div>
            <label className={labelCls}>{t('workflow.nodeFields.iterations')}</label>
            <input type="number" min={1} value={(config.iterations as number) || 3} onChange={(e) => updateConfig('iterations', Number(e.target.value))} className={fieldCls} />
          </div>
        )}

        {node.nodeType === 'parallel' && (
          <div>
            <label className={labelCls}>{t('workflow.nodeFields.maxConcurrency')}</label>
            <input type="number" min={0} value={(config.maxConcurrency as number) || 0} onChange={(e) => updateConfig('maxConcurrency', Number(e.target.value))} className={fieldCls} />
            <p className="pf-text-xxs text-text-disabled mt-1">0 = 不限制并行度</p>
          </div>
        )}

        {node.nodeType === 'setVariable' && (
          <>
            <div>
              <label className={labelCls}>{t('workflow.nodeFields.varKey')}</label>
              <input value={(config.key as string) || ''} onChange={(e) => updateConfig('key', e.target.value)} placeholder="myVar" className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>{t('workflow.nodeFields.varValue')}</label>
              <input value={(config.value as string) || ''} onChange={(e) => updateConfig('value', e.target.value)} placeholder="{{prev.data.token}}" className={cn(fieldCls, 'font-mono')} />
            </div>
          </>
        )}

        {node.nodeType === 'timestamp' && (
          <div>
            <label className={labelCls}>{t('workflow.nodeFields.timeFormat')}</label>
            <select value={(config.format as string) || 'iso8601'} onChange={(e) => updateConfig('format', e.target.value)} className={fieldCls}>
              <option value="iso8601">{t('workflow.timeFormats.iso8601')}</option>
              <option value="unix">{t('workflow.timeFormats.unix')}</option>
              <option value="unixMs">{t('workflow.timeFormats.unixMs')}</option>
            </select>
          </div>
        )}

        {node.nodeType === 'log' && (
          <>
            <div>
              <label className={labelCls}>{t('workflow.nodeFields.logMessage')}</label>
              <textarea rows={3} value={(config.message as string) || ''} onChange={(e) => updateConfig('message', e.target.value)} placeholder="Current status: {{prev.status}}" className={textareaCls} />
            </div>
            <div>
              <label className={labelCls}>{t('workflow.nodeFields.logLevel')}</label>
              <select value={(config.level as string) || 'info'} onChange={(e) => updateConfig('level', e.target.value)} className={fieldCls}>
                <option value="info">Info</option>
                <option value="warn">Warn</option>
                <option value="error">Error</option>
              </select>
            </div>
          </>
        )}

        {node.nodeType === 'assertion' && (
          <>
            <div>
              <label className={labelCls}>{t('workflow.nodeFields.assertName')}</label>
              <input value={(config.name as string) || ''} onChange={(e) => updateConfig('name', e.target.value)} placeholder="Status check" className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>{t('workflow.nodeFields.assertTarget')}</label>
              <input value={(config.target as string) || ''} onChange={(e) => updateConfig('target', e.target.value)} placeholder="{{prev.status}}" className={cn(fieldCls, 'font-mono')} />
            </div>
            <div>
              <label className={labelCls}>{t('workflow.nodeFields.assertOperator')}</label>
              <select value={(config.operator as string) || 'equals'} onChange={(e) => updateConfig('operator', e.target.value)} className={fieldCls}>
                <option value="equals">Equals</option>
                <option value="notEquals">Not Equals</option>
                <option value="contains">Contains</option>
                <option value="greaterThan">Greater Than</option>
                <option value="lessThan">Less Than</option>
                <option value="matches">Matches (Regex)</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>{t('workflow.nodeFields.assertExpected')}</label>
              <input value={(config.expected as string) || ''} onChange={(e) => updateConfig('expected', e.target.value)} placeholder="200" className={cn(fieldCls, 'font-mono')} />
            </div>
          </>
        )}

        {(node.nodeType === 'start' || node.nodeType === 'end' || node.nodeType === 'uuid') && (
          <div className="pf-text-xs text-text-disabled text-center py-4">
            {t(`workflow.nodeDescs.${node.nodeType}`)}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
//  Execution Results Panel
// ═══════════════════════════════════════════

function ExecutionPanel({
  nodeResults, progress, status, onClear,
}: {
  nodeResults: NodeResult[];
  progress: import('@/types/workflow').WorkflowProgressEvent | null;
  status: ExecutionStatus | null;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [expandedNode, setExpandedNode] = useState<string | null>(null);

  if (nodeResults.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-disabled pf-text-xs gap-2 px-4 text-center">
        {status === 'running' ? <Loader2 className="h-6 w-6 animate-spin text-amber-500" /> : <WorkflowIcon className="h-8 w-8 opacity-30" />}
        <p>
          {status === 'running' && progress
            ? t('workflow.step', { current: progress.currentStep + 1, total: progress.totalSteps })
            : t('workflow.noResults')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-default/60 shrink-0">
        <div className="flex items-center gap-2">
          <span className="pf-text-xs font-semibold text-text-secondary">{t('workflow.resultPanel')}</span>
          {progress && status === 'running' && (
            <span className="pf-text-xxs text-amber-500 font-medium">
              {t('workflow.step', { current: progress.currentStep + 1, total: progress.totalSteps })}
            </span>
          )}
          {status === 'completed' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
          {status === 'failed' && <XCircle className="h-3.5 w-3.5 text-red-500" />}
        </div>
        <button onClick={onClear} className="wb-icon-btn"><X className="h-3 w-3" /></button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {nodeResults.map((result) => {
          const meta = NODE_TYPE_META[result.nodeType];
          const Icon = NODE_ICONS[result.nodeType] || Globe;
          const expanded = expandedNode === result.nodeId;
          const summary = getResultSummary(result);
          return (
            <div key={result.nodeId} className="border-b border-border-default/30">
              <button
                onClick={() => setExpandedNode(expanded ? null : result.nodeId)}
                className="flex items-center gap-2 w-full px-4 py-2 text-left hover:bg-bg-hover/40 transition-colors"
              >
                {result.status === 'completed' && <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />}
                {result.status === 'failed' && <XCircle className="h-3 w-3 text-red-500 shrink-0" />}
                {result.status === 'running' && <Loader2 className="h-3 w-3 animate-spin text-amber-500 shrink-0" />}
                {result.status === 'pending' && <Clock className="h-3 w-3 text-text-disabled shrink-0" />}
                <Icon className="h-3 w-3 shrink-0" style={{ color: meta.color }} />
                <div className="flex-1 min-w-0">
                  <span className="pf-text-xs font-medium text-text-primary truncate block">{result.nodeName}</span>
                  {summary && <span className="pf-text-xxs text-text-disabled truncate block">{summary}</span>}
                </div>
                <span className="pf-text-xxs text-text-disabled shrink-0">{result.durationMs}ms</span>
                {expanded ? <ChevronDown className="h-3 w-3 text-text-disabled shrink-0" /> : <ChevronRight className="h-3 w-3 text-text-disabled shrink-0" />}
              </button>
              {expanded && (
                <div className="px-4 pb-3">
                  {result.error && (
                    <div className="pf-text-xxs text-red-500 mb-2 p-2 pf-rounded-md bg-red-500/5 border border-red-500/20">
                      {result.error}
                    </div>
                  )}
                  {renderNodeOutput(result, t)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
//  Result formatting helpers
// ═══════════════════════════════════════════

/** Get a short one-line summary for the result list */
function getResultSummary(result: NodeResult): string | null {
  const out = result.output as Record<string, unknown> | null;
  if (!out || typeof out !== 'object') return null;
  switch (result.nodeType) {
    case 'httpRequest': {
      const status = out.status ?? out.statusCode ?? '';
      const url = (out.url as string) || '';
      return status ? `${status} ${url ? url.substring(0, 40) : ''}` : null;
    }
    case 'tcpSend':
    case 'udpSend':
      return `${out.sentBytes ?? 0} bytes -> ${(out.address as string) || (out.target as string) || ''}`;
    case 'delay':
      return `${out.delayMs ?? 0}ms`;
    case 'jsonParse':
      return `${String(out.kind || 'json')} parsed`;
    case 'jsonStringify':
      return `${Boolean(out.pretty) ? 'pretty' : 'compact'} JSON`;
    case 'textTransform':
      return `${String(out.operation || 'transform')} -> ${String(out.value || '').substring(0, 36)}`;
    case 'log':
      return `[${(out.level as string) || 'info'}] ${((out.message as string) || '').substring(0, 50)}`;
    case 'setVariable':
      return `${out.key} = ${((out.value as string) || '').substring(0, 30)}`;
    case 'timestamp':
      return String(out.value || '');
    case 'uuid':
      return String(out.value || '');
    case 'assertion':
      return out.passed ? `PASS: ${out.name}` : `FAIL: ${out.name}`;
    case 'condition':
      return `${out.expression} -> ${out.result}`;
    case 'extractData':
    case 'base64Encode':
    case 'base64Decode':
    case 'urlEncode':
    case 'urlDecode':
    case 'hash':
      return `${((out.value as string) || '').substring(0, 50)}`;
    case 'loop':
      return `${out.iterations} iterations`;
    case 'parallel':
      return `max ${out.maxConcurrency ?? 0}`;
    case 'script':
      return `${(out.logs as string[] | undefined)?.length ?? 0} logs / ${out.envUpdates && typeof out.envUpdates === 'object' ? Object.keys(out.envUpdates as Record<string, unknown>).length : 0} vars`;
    case 'start':
      return String(out.state || 'started');
    case 'end':
      return String(out.state || 'finished');
    default:
      return null;
  }
}

/** Render structured output for each node type */
function renderNodeOutput(result: NodeResult, t: (key: string) => string) {
  const out = result.output as Record<string, unknown> | null;
  const kvCls = 'flex items-start gap-2 py-1 border-b border-border-default/20 last:border-0';
  const keyCls = 'pf-text-xxs font-semibold text-text-tertiary shrink-0 w-16';
  const valCls = 'pf-text-xxs text-text-secondary break-all flex-1 font-mono';

  // Null / empty output
  if (out == null || (typeof out === 'object' && Object.keys(out).length === 0)) {
    return <div className="pf-text-xxs text-text-disabled py-2">{t('workflow.noOutput')}</div>;
  }

  // Special rendering per node type
  switch (result.nodeType) {
    case 'httpRequest': {
      const status = out.status ?? out.statusCode;
      const headers = out.headers as Record<string, string> | undefined;
      const body = out.body as string | undefined;
      return (
        <div className="space-y-1">
          {status != null && (
            <div className={kvCls}><span className={keyCls}>Status</span><span className={valCls}>{String(status)}</span></div>
          )}
          {Boolean(out.url) && (
            <div className={kvCls}><span className={keyCls}>URL</span><span className={valCls}>{String(out.url)}</span></div>
          )}
          {headers && Object.keys(headers).length > 0 && (
            <details className="mt-1">
              <summary className="pf-text-xxs text-text-tertiary cursor-pointer hover:text-text-secondary">Headers ({Object.keys(headers).length})</summary>
              <div className="mt-1 space-y-0.5">
                {Object.entries(headers).slice(0, 20).map(([k, v]) => (
                  <div key={k} className="pf-text-xxs font-mono text-text-disabled"><span className="text-text-tertiary">{k}:</span> {v}</div>
                ))}
              </div>
            </details>
          )}
          {body != null && (
            <details className="mt-1">
              <summary className="pf-text-xxs text-text-tertiary cursor-pointer hover:text-text-secondary">Body</summary>
              <pre className="pf-text-xxs font-mono text-text-secondary bg-bg-secondary/40 p-2 pf-rounded-md overflow-x-auto max-h-[200px] overflow-y-auto mt-1">
                {typeof body === 'string' ? body : JSON.stringify(body, null, 2)}
              </pre>
            </details>
          )}
          {/* Fallback: show raw if no structured fields */}
          {status == null && !body && (
            <pre className="pf-text-xxs font-mono text-text-secondary bg-bg-secondary/40 p-2 pf-rounded-md overflow-x-auto max-h-[200px] overflow-y-auto">
              {JSON.stringify(out, null, 2)}
            </pre>
          )}
        </div>
      );
    }
    case 'tcpSend':
    case 'udpSend': {
      return (
        <div className="space-y-1">
          <div className={kvCls}><span className={keyCls}>Sent</span><span className={valCls}>{String(out.sent || '')}</span></div>
          <div className={kvCls}><span className={keyCls}>Bytes</span><span className={valCls}>{String(out.sentBytes ?? 0)}</span></div>
          <div className={kvCls}><span className={keyCls}>Target</span><span className={valCls}>{String(out.address || out.target || '')}</span></div>
          {out.response != null && (
            <details className="mt-1">
              <summary className="pf-text-xxs text-text-tertiary cursor-pointer">Response</summary>
              <pre className="pf-text-xxs font-mono text-text-secondary bg-bg-secondary/40 p-2 pf-rounded-md overflow-x-auto max-h-[150px] overflow-y-auto mt-1">
                {typeof out.response === 'string' ? out.response : JSON.stringify(out.response, null, 2)}
              </pre>
            </details>
          )}
        </div>
      );
    }
    case 'delay':
      return <div className={kvCls}><span className={keyCls}>Delay</span><span className={valCls}>{String(out.delayMs)}ms</span></div>;
    case 'log':
      return (
        <div className={cn('p-2 pf-rounded-md pf-text-xxs font-mono', out.level === 'error' ? 'bg-red-500/5 text-red-500' : out.level === 'warn' ? 'bg-amber-500/5 text-amber-600' : 'bg-bg-secondary/40 text-text-secondary')}>
          [{String(out.level).toUpperCase()}] {String(out.message)}
        </div>
      );
    case 'jsonParse':
      return (
        <div className="space-y-1">
          <div className={kvCls}><span className={keyCls}>Kind</span><span className={valCls}>{String(out.kind || 'json')}</span></div>
          <div className="pf-text-xxs text-text-tertiary mb-1">{t('workflow.output')}:</div>
          <pre className="pf-text-xxs font-mono text-text-secondary bg-bg-secondary/40 p-2 pf-rounded-md overflow-x-auto max-h-[220px] overflow-y-auto">
            {JSON.stringify(out.value ?? null, null, 2)}
          </pre>
        </div>
      );
    case 'jsonStringify':
      return (
        <div className="space-y-1">
          <div className={kvCls}><span className={keyCls}>Pretty</span><span className={valCls}>{String(Boolean(out.pretty))}</span></div>
          <div className="pf-text-xxs text-text-tertiary mb-1">{t('workflow.output')}:</div>
          <pre className="pf-text-xxs font-mono text-text-secondary bg-bg-secondary/40 p-2 pf-rounded-md overflow-x-auto max-h-[220px] overflow-y-auto">
            {String(out.value || '')}
          </pre>
        </div>
      );
    case 'textTransform':
      return (
        <div className="space-y-1">
          <div className={kvCls}><span className={keyCls}>Mode</span><span className={valCls}>{String(out.operation || '')}</span></div>
          <div className="pf-text-xxs text-text-tertiary mb-1">{t('workflow.output')}:</div>
          <pre className="pf-text-xxs font-mono text-text-secondary bg-bg-secondary/40 p-2 pf-rounded-md overflow-x-auto max-h-[200px] overflow-y-auto">
            {String(out.value || '')}
          </pre>
        </div>
      );
    case 'setVariable':
      return (
        <div className="space-y-1">
          <div className={kvCls}><span className={keyCls}>Key</span><span className={valCls}>{String(out.key)}</span></div>
          <div className={kvCls}><span className={keyCls}>Value</span><span className={valCls}>{String(out.value)}</span></div>
        </div>
      );
    case 'assertion': {
      const passed = Boolean(out.passed);
      return (
        <div className={cn('p-2 pf-rounded-md pf-text-xxs border', passed ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20')}>
          <div className="flex items-center gap-1.5 mb-1">
            {passed ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <XCircle className="h-3 w-3 text-red-500" />}
            <span className={cn('font-semibold', passed ? 'text-emerald-600' : 'text-red-500')}>{String(out.name || 'Assertion')}</span>
          </div>
          <div className="font-mono text-text-disabled">{String(out.target)} {String(out.operator)} {String(out.expected)}</div>
        </div>
      );
    }
    case 'condition':
      return (
        <div className="space-y-1">
          <div className={kvCls}><span className={keyCls}>Expr</span><span className={valCls}>{String(out.expression)}</span></div>
          <div className={kvCls}><span className={keyCls}>Result</span><span className={cn(valCls, out.result ? 'text-emerald-500' : 'text-red-500')}>{String(out.result)}</span></div>
        </div>
      );
    case 'extractData':
    case 'base64Encode':
    case 'base64Decode':
    case 'urlEncode':
    case 'urlDecode':
    case 'hash':
      return (
        <div className="space-y-1">
          <div className="pf-text-xxs text-text-tertiary mb-1">{t('workflow.output')}:</div>
          <pre className="pf-text-xxs font-mono text-text-secondary bg-bg-secondary/40 p-2 pf-rounded-md overflow-x-auto max-h-[200px] overflow-y-auto">
            {String(out.value || '')}
          </pre>
        </div>
      );
    case 'script': {
      const logs = out.logs as string[] | undefined;
      const envUpdates = out.envUpdates as Record<string, string> | undefined;
      const tests = out.testResults as Array<{ name: string; passed: boolean }> | undefined;
      return (
        <div className="space-y-1.5">
          {logs && logs.length > 0 && (
            <div>
              <div className="pf-text-xxs text-text-tertiary mb-0.5">Console:</div>
              <div className="bg-bg-secondary/40 p-1.5 pf-rounded-md max-h-[120px] overflow-y-auto">
                {logs.map((log, i) => <div key={i} className="pf-text-xxs font-mono text-text-secondary">{log}</div>)}
              </div>
            </div>
          )}
          {envUpdates && Object.keys(envUpdates).length > 0 && (
            <div>
              <div className="pf-text-xxs text-text-tertiary mb-0.5">Variables:</div>
              <div className="bg-bg-secondary/40 p-1.5 pf-rounded-md space-y-0.5">
                {Object.entries(envUpdates).map(([key, value]) => (
                  <div key={key} className="pf-text-xxs font-mono text-text-secondary">
                    <span className="text-text-tertiary">{key}</span> = {value}
                  </div>
                ))}
              </div>
            </div>
          )}
          {tests && tests.length > 0 && (
            <div>
              <div className="pf-text-xxs text-text-tertiary mb-0.5">Tests:</div>
              {tests.map((test, i) => (
                <div key={i} className="flex items-center gap-1.5 pf-text-xxs">
                  {test.passed ? <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" /> : <XCircle className="h-2.5 w-2.5 text-red-500" />}
                  <span className="text-text-secondary">{test.name}</span>
                </div>
              ))}
            </div>
          )}
          {(!logs || logs.length === 0) && (!envUpdates || Object.keys(envUpdates).length === 0) && (!tests || tests.length === 0) && (
            <div className="pf-text-xxs text-text-disabled">{t('workflow.noOutput')}</div>
          )}
        </div>
      );
    }
    case 'timestamp':
      return (
        <div className="space-y-1">
          <div className={kvCls}><span className={keyCls}>Format</span><span className={valCls}>{String(out.format || '')}</span></div>
          <div className={kvCls}><span className={keyCls}>Value</span><span className={valCls}>{String(out.value || '')}</span></div>
          <div className={kvCls}><span className={keyCls}>Unix</span><span className={valCls}>{String(out.unix ?? '')}</span></div>
          <div className={kvCls}><span className={keyCls}>UnixMs</span><span className={valCls}>{String(out.unixMs ?? '')}</span></div>
        </div>
      );
    case 'uuid':
      return <div className={kvCls}><span className={keyCls}>UUID</span><span className={valCls}>{String(out.value || '')}</span></div>;
    case 'loop':
      return (
        <div className="space-y-1">
          <div className={kvCls}><span className={keyCls}>Count</span><span className={valCls}>{String(out.iterations ?? 0)}</span></div>
          {Boolean(out.note) && <div className={kvCls}><span className={keyCls}>Note</span><span className={valCls}>{String(out.note)}</span></div>}
        </div>
      );
    case 'parallel':
      return (
        <div className="space-y-1">
          <div className={kvCls}><span className={keyCls}>Max</span><span className={valCls}>{String(out.maxConcurrency ?? 0)}</span></div>
          {Boolean(out.note) && <div className={kvCls}><span className={keyCls}>Note</span><span className={valCls}>{String(out.note)}</span></div>}
        </div>
      );
    case 'start':
    case 'end':
      return (
        <div className="space-y-1">
          <div className={kvCls}><span className={keyCls}>State</span><span className={valCls}>{String(out.state || '')}</span></div>
          {Boolean(out.at) && <div className={kvCls}><span className={keyCls}>At</span><span className={valCls}>{String(out.at)}</span></div>}
        </div>
      );
    default: {
      // Fallback: render as JSON
      return (
        <div>
          <div className="pf-text-xxs text-text-tertiary mb-1">{t('workflow.output')}:</div>
          <pre className="pf-text-xxs font-mono text-text-secondary bg-bg-secondary/40 p-2 pf-rounded-md overflow-x-auto max-h-[200px] overflow-y-auto">
            {JSON.stringify(out, null, 2)}
          </pre>
        </div>
      );
    }
  }
}

// ═══════════════════════════════════════════
//  Node Palette Card (compact grid card)
// ═══════════════════════════════════════════

function NodeCard({
  nodeType,
  onAdd,
  onDragStart,
  onDragEnd,
}: {
  nodeType: NodeType;
  onAdd: (nt: NodeType) => void;
  onDragStart: (nt: NodeType) => void;
  onDragEnd: () => void;
}) {
  const { t } = useTranslation();
  const meta = NODE_TYPE_META[nodeType];
  const Icon = NODE_ICONS[nodeType];
  const cardRef = useRef<HTMLDivElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);
  const suppressClickRef = useRef(false);

  const showTooltip = useCallback(() => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltipPos({ top: rect.top, left: rect.right + 8 });
  }, []);
  const hideTooltip = useCallback(() => setTooltipPos(null), []);

  return (
    <div
      ref={cardRef}
      role="button"
      tabIndex={0}
      draggable
      onClick={() => {
        if (suppressClickRef.current) return;
        onAdd(nodeType);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onAdd(nodeType);
        }
      }}
      onDragStart={(e) => {
        suppressClickRef.current = true;
        e.dataTransfer.setData('application/protoforge-node-type', nodeType);
        e.dataTransfer.setData('text/plain', nodeType);
        e.dataTransfer.effectAllowed = 'move';
        hideTooltip();
        onDragStart(nodeType);
      }}
      onDragEnd={() => {
        onDragEnd();
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      style={{ WebkitUserSelect: 'none', userSelect: 'none' }}
      className="relative flex flex-col items-center justify-center gap-1 px-1.5 py-2 pf-rounded-md border border-border-subtle bg-transparent hover:bg-bg-hover/60 hover:border-border-default transition-colors cursor-grab active:cursor-grabbing group focus:outline-none focus-visible:border-accent/50"
    >
      <div className="flex h-6 w-6 items-center justify-center pf-rounded-sm pointer-events-none" style={{ backgroundColor: meta.color + '18' }}>
        <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} />
      </div>
      <span className="pf-text-xxs font-medium text-text-secondary group-hover:text-text-primary w-full text-center leading-tight line-clamp-2 transition-colors pointer-events-none">
        {t(`workflow.nodeTypes.${nodeType}`)}
      </span>
      {/* Tooltip rendered to body via portal so it's not clipped by overflow containers */}
      {tooltipPos && createPortal(
        <div
          className="fixed z-[9999] w-48 p-2 pf-rounded-md bg-bg-elevated border border-border-default/60 shadow-lg pointer-events-none"
          style={{ top: tooltipPos.top, left: tooltipPos.left }}
        >
          <div className="pf-text-xs font-semibold text-text-primary mb-0.5">{t(`workflow.nodeTypes.${nodeType}`)}</div>
          <div className="pf-text-xxs text-text-disabled leading-4">{t(`workflow.nodeDescs.${nodeType}`)}</div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
//  Main Workspace
// ═══════════════════════════════════════════

export function WorkflowWorkspace() {
  return (
    <ReactFlowProvider>
      <WorkflowWorkspaceInner />
    </ReactFlowProvider>
  );
}

function WorkflowWorkspaceInner() {
  const { t } = useTranslation();
  const theme = useThemeStore((s) => s.resolved);

  const workflows = useWorkflowStore((s) => s.workflows);
  const loading = useWorkflowStore((s) => s.loading);
  const activeWorkflowId = useWorkflowStore((s) => s.activeWorkflowId);
  const dirty = useWorkflowStore((s) => s.dirty);
  const executionStatus = useWorkflowStore((s) => s.executionStatus);
  const executionProgress = useWorkflowStore((s) => s.executionProgress);
  const nodeResults = useWorkflowStore((s) => s.nodeResults);

  const fetchWorkflows = useWorkflowStore((s) => s.fetchWorkflows);
  const createWf = useWorkflowStore((s) => s.createWorkflow);
  const saveWf = useWorkflowStore((s) => s.saveWorkflow);
  const deleteWf = useWorkflowStore((s) => s.deleteWorkflow);
  const setActiveId = useWorkflowStore((s) => s.setActiveWorkflowId);
  const setDirty = useWorkflowStore((s) => s.setDirty);
  const runWf = useWorkflowStore((s) => s.runWorkflow);
  const cancelExec = useWorkflowStore((s) => s.cancelExecution);
  const clearExec = useWorkflowStore((s) => s.clearExecution);
  const subscribeProgress = useWorkflowStore((s) => s.subscribeProgress);

  const [search, setSearch] = useState('');
  const [nodeSearch, setNodeSearch] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [rightPanel, setRightPanel] = useState<'config' | 'results'>('config');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [isPaletteDragging, setIsPaletteDragging] = useState(false);
  // Resizable sidebar width via drag handle
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [rightPanelWidth, setRightPanelWidth] = useState(300);
  const resizingRef = useRef<'left' | 'right' | null>(null);
  const resizeStartRef = useRef({ x: 0, width: 0 });
  const draggedNodeTypeRef = useRef<NodeType | null>(null);

  // Active workflow data — local editing state
  const activeWorkflow = useMemo(() => workflows.find((w) => w.id === activeWorkflowId) || null, [workflows, activeWorkflowId]);
  const [localWorkflow, setLocalWorkflow] = useState<Workflow | null>(null);

  // Track structural version to avoid re-deriving RF nodes on position-only changes
  const structureVersionRef = useRef(0);
  const [structureVersion, setStructureVersion] = useState(0);
  const bumpStructure = useCallback(() => {
    structureVersionRef.current += 1;
    setStructureVersion(structureVersionRef.current);
  }, []);

  // Context menu (node / edge / canvas)
  const { showMenu, MenuComponent: ContextMenuComponent } = useContextMenu();

  // Sync local state when active workflow changes
  useEffect(() => {
    setLocalWorkflow(activeWorkflow ? { ...activeWorkflow } : null);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    bumpStructure();
  }, [activeWorkflow?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // React Flow state
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const reactFlowInstance = useReactFlow();

  // Forward refs for callbacks used inside rf nodes/edges (avoid stale closures, avoid rebuild churn)
  const callbacksRef = useRef<{
    onDeleteNode?: (id: string) => void;
    onDuplicateNode?: (id: string) => void;
    onDeleteEdge?: (id: string) => void;
  }>({});

  // Rebuild RF nodes only on structural changes
  useEffect(() => {
    if (!localWorkflow) { setRfNodes([]); setRfEdges([]); return; }
    const onDeleteNode = (id: string) => callbacksRef.current.onDeleteNode?.(id);
    const onDuplicateNode = (id: string) => callbacksRef.current.onDuplicateNode?.(id);
    const onDeleteEdge = (id: string) => callbacksRef.current.onDeleteEdge?.(id);
    setRfNodes(toRfNodes(localWorkflow.nodes, nodeResults, onDeleteNode, onDuplicateNode));
    setRfEdges(toRfEdges(localWorkflow.edges, onDeleteEdge));
  }, [structureVersion, nodeResults, setRfNodes, setRfEdges]); // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to progress events
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    subscribeProgress().then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [subscribeProgress]);

  // Fetch on mount
  useEffect(() => { fetchWorkflows(); }, [fetchWorkflows]);

  // ── Resize handlers ──
  const handleResizeStart = useCallback((side: 'left' | 'right', e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = side;
    resizeStartRef.current = { x: e.clientX, width: side === 'left' ? sidebarWidth : rightPanelWidth };

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - resizeStartRef.current.x;
      if (resizingRef.current === 'left') {
        setSidebarWidth(Math.max(180, Math.min(500, resizeStartRef.current.width + delta)));
      } else {
        setRightPanelWidth(Math.max(200, Math.min(600, resizeStartRef.current.width - delta)));
      }
    };
    const onUp = () => {
      resizingRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [sidebarWidth, rightPanelWidth]);

  // ── Handlers ──

  const handleCreate = useCallback(async () => {
    await createWf(t('workflow.untitled'));
  }, [createWf, t]);

  const handleDelete = useCallback(async (id: string, name: string) => {
    const { confirm } = await import('@tauri-apps/plugin-dialog');
    const yes = await confirm(t('workflow.deleteConfirm', { name }));
    if (yes) await deleteWf(id);
  }, [deleteWf, t]);

  const handleSave = useCallback(async () => {
    if (!localWorkflow) return;
    await saveWf(localWorkflow);
  }, [localWorkflow, saveWf]);

  const handleRun = useCallback(async () => {
    if (!localWorkflow) return;
    if (dirty) await saveWf(localWorkflow);
    setRightPanel('results');
    await runWf(localWorkflow.id);
  }, [localWorkflow, dirty, saveWf, runWf]);

  const handleNodesChange: typeof onNodesChange = useCallback((changes) => {
    onNodesChange(changes);
    for (const change of changes) {
      if (change.type === 'position' && change.dragging === false && change.position) {
        setLocalWorkflow((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            nodes: prev.nodes.map((n) =>
              n.id === change.id ? { ...n, position: change.position } : n
            ),
          };
        });
        setDirty(true);
      }
      if (change.type === 'remove') {
        setLocalWorkflow((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            nodes: prev.nodes.filter((n) => n.id !== change.id),
            edges: prev.edges.filter((e) => e.sourceNodeId !== change.id && e.targetNodeId !== change.id),
          };
        });
        bumpStructure();
        setDirty(true);
      }
    }
  }, [onNodesChange, setDirty, bumpStructure]);

  const onConnect: OnConnect = useCallback((connection: Connection) => {
    setRfEdges((eds) => addEdge({ ...connection, type: 'labeled', markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 }, style: { strokeWidth: 2 } }, eds));
    setLocalWorkflow((prev) => {
      if (!prev) return prev;
      const newEdge: FlowEdge = {
        id: crypto.randomUUID(),
        sourceNodeId: connection.source,
        targetNodeId: connection.target,
        sourceHandle: connection.sourceHandle || undefined,
      };
      return { ...prev, edges: [...prev.edges, newEdge] };
    });
    bumpStructure();
    setDirty(true);
  }, [setRfEdges, setDirty, bumpStructure]);

  const addNodeAtPosition = useCallback((nodeType: NodeType, position: { x: number; y: number }) => {
    const id = crypto.randomUUID();
    const meta = NODE_TYPE_META[nodeType];
    const newNode: FlowNode = {
      id,
      name: meta.label,
      nodeType,
      config: defaultConfig(nodeType),
      position,
    };
    setLocalWorkflow((prev) => prev ? { ...prev, nodes: [...prev.nodes, newNode] } : prev);
    bumpStructure();
    setDirty(true);
    setSelectedNodeId(id);
    setRightPanel('config');
  }, [setDirty, bumpStructure]);

  const handleAddNode = useCallback((nodeType: NodeType) => {
    if (!localWorkflow) return;
    addNodeAtPosition(nodeType, { x: 250, y: localWorkflow.nodes.length * 120 + 60 });
  }, [localWorkflow, addNodeAtPosition]);

  const handlePaletteDragStart = useCallback((nodeType: NodeType) => {
    draggedNodeTypeRef.current = nodeType;
    setIsPaletteDragging(true);
  }, []);

  const handlePaletteDragEnd = useCallback(() => {
    draggedNodeTypeRef.current = null;
    setIsPaletteDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsPaletteDragging(true);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const nodeType = (
      e.dataTransfer.getData('application/protoforge-node-type')
      || e.dataTransfer.getData('text/plain')
      || draggedNodeTypeRef.current
    ) as NodeType;
    draggedNodeTypeRef.current = null;
    setIsPaletteDragging(false);
    if (!nodeType || !NODE_TYPE_META[nodeType]) return;
    const position = reactFlowInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addNodeAtPosition(nodeType, position);
  }, [reactFlowInstance, addNodeAtPosition]);

  const handleDeleteNode = useCallback((nodeId: string) => {
    setLocalWorkflow((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        nodes: prev.nodes.filter((n) => n.id !== nodeId),
        edges: prev.edges.filter((e) => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId),
      };
    });
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
    bumpStructure();
    setDirty(true);
  }, [selectedNodeId, setDirty, bumpStructure]);

  const handleDeleteEdge = useCallback((edgeId: string) => {
    setLocalWorkflow((prev) => {
      if (!prev) return prev;
      return { ...prev, edges: prev.edges.filter((e) => e.id !== edgeId) };
    });
    if (selectedEdgeId === edgeId) setSelectedEdgeId(null);
    bumpStructure();
    setDirty(true);
  }, [selectedEdgeId, setDirty, bumpStructure]);

  const handleDuplicateNode = useCallback((nodeId: string) => {
    setLocalWorkflow((prev) => {
      if (!prev) return prev;
      const src = prev.nodes.find((n) => n.id === nodeId);
      if (!src) return prev;
      const newNode: FlowNode = {
        id: crypto.randomUUID(),
        name: `${src.name} (copy)`,
        nodeType: src.nodeType,
        config: JSON.parse(JSON.stringify(src.config || {})),
        position: src.position
          ? { x: src.position.x + 40, y: src.position.y + 40 }
          : { x: 280, y: 80 },
      };
      return { ...prev, nodes: [...prev.nodes, newNode] };
    });
    bumpStructure();
    setDirty(true);
  }, [setDirty, bumpStructure]);

  const handleDisconnectNode = useCallback((nodeId: string) => {
    setLocalWorkflow((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        edges: prev.edges.filter((e) => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId),
      };
    });
    bumpStructure();
    setDirty(true);
  }, [setDirty, bumpStructure]);

  const handleClearCanvas = useCallback(async () => {
    if (!localWorkflow) return;
    const { confirm } = await import('@tauri-apps/plugin-dialog');
    const yes = await confirm(t('workflow.menu.clearCanvasConfirm'));
    if (!yes) return;
    setLocalWorkflow((prev) => prev ? { ...prev, nodes: [], edges: [] } : prev);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    bumpStructure();
    setDirty(true);
  }, [localWorkflow, t, setDirty, bumpStructure]);

  const handleReverseEdge = useCallback((edgeId: string) => {
    setLocalWorkflow((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        edges: prev.edges.map((e) =>
          e.id === edgeId
            ? { ...e, sourceNodeId: e.targetNodeId, targetNodeId: e.sourceNodeId, sourceHandle: undefined }
            : e
        ),
      };
    });
    bumpStructure();
    setDirty(true);
  }, [setDirty, bumpStructure]);

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    onEdgesChange(changes);
    let removed = false;
    for (const change of changes) {
      if (change.type === 'remove') {
        setLocalWorkflow((prev) => {
          if (!prev) return prev;
          return { ...prev, edges: prev.edges.filter((e) => e.id !== change.id) };
        });
        if (selectedEdgeId === change.id) setSelectedEdgeId(null);
        removed = true;
      }
    }
    if (removed) {
      bumpStructure();
      setDirty(true);
    }
  }, [onEdgesChange, selectedEdgeId, setDirty, bumpStructure]);

  const handleNodeClick = useCallback((_: unknown, node: Node) => {
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    setRightPanel('config');
  }, []);

  const handleEdgeClick = useCallback((_: unknown, edge: Edge) => {
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
  }, []);

  const handlePaneClick = useCallback(() => {
    setSelectedEdgeId(null);
  }, []);

  // ── Context menus ──
  const handleNodeContextMenu = useCallback((e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    const items: ContextMenuEntry[] = [
      { id: 'duplicate', label: t('workflow.menu.duplicateNode'), icon: <Copy className="w-3.5 h-3.5" />, onClick: () => handleDuplicateNode(node.id) },
      { id: 'disconnect', label: t('workflow.menu.disconnectNode'), icon: <Unlink2 className="w-3.5 h-3.5" />, onClick: () => handleDisconnectNode(node.id) },
      { type: 'divider' },
      { id: 'delete', label: t('workflow.menu.deleteNode'), icon: <Trash2 className="w-3.5 h-3.5" />, danger: true, onClick: () => handleDeleteNode(node.id) },
    ];
    showMenu(e, items);
  }, [t, showMenu, handleDuplicateNode, handleDisconnectNode, handleDeleteNode]);

  const handleEdgeContextMenu = useCallback((e: React.MouseEvent, edge: Edge) => {
    e.preventDefault();
    const items: ContextMenuEntry[] = [
      { id: 'reverse', label: t('workflow.menu.reverseEdge'), icon: <ArrowLeftRight className="w-3.5 h-3.5" />, onClick: () => handleReverseEdge(edge.id) },
      { type: 'divider' },
      { id: 'delete', label: t('workflow.menu.deleteEdge'), icon: <Trash2 className="w-3.5 h-3.5" />, danger: true, onClick: () => handleDeleteEdge(edge.id) },
    ];
    showMenu(e, items);
  }, [t, showMenu, handleReverseEdge, handleDeleteEdge]);

  const handlePaneContextMenu = useCallback((e: React.MouseEvent | MouseEvent) => {
    e.preventDefault();
    const items: ContextMenuEntry[] = [
      { id: 'fit', label: t('workflow.menu.fitView'), icon: <Maximize className="w-3.5 h-3.5" />, onClick: () => reactFlowInstance.fitView({ padding: 0.2, duration: 200 }) },
      { id: 'select-all', label: t('workflow.menu.selectAll'), icon: <CheckSquare className="w-3.5 h-3.5" />, onClick: () => reactFlowInstance.setNodes((nds) => nds.map((n) => ({ ...n, selected: true }))) },
      { type: 'divider' },
      { id: 'clear', label: t('workflow.menu.clearCanvas'), icon: <Eraser className="w-3.5 h-3.5" />, danger: true, onClick: () => void handleClearCanvas() },
    ];
    showMenu(e as React.MouseEvent, items);
  }, [t, showMenu, reactFlowInstance, handleClearCanvas]);

  // Keep callbacksRef in sync with the latest handlers (used by rfNodes/rfEdges to avoid stale closures)
  useEffect(() => {
    callbacksRef.current = {
      onDeleteNode: handleDeleteNode,
      onDuplicateNode: handleDuplicateNode,
      onDeleteEdge: handleDeleteEdge,
    };
  }, [handleDeleteNode, handleDuplicateNode, handleDeleteEdge]);

  const handleUpdateNode = useCallback((updates: Partial<FlowNode>) => {
    if (!selectedNodeId) return;
    setLocalWorkflow((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        nodes: prev.nodes.map((n) => n.id === selectedNodeId ? { ...n, ...updates } : n),
      };
    });
    setDirty(true);
  }, [selectedNodeId, setDirty]);

  // ── Rename ──
  const startRename = useCallback((id: string, currentName: string) => {
    setRenamingId(id);
    setRenameValue(currentName);
  }, []);

  const commitRename = useCallback(async () => {
    if (!renamingId || !renameValue.trim()) { setRenamingId(null); return; }
    const wf = workflows.find((w) => w.id === renamingId);
    if (wf) {
      await saveWf({ ...wf, name: renameValue.trim() });
      if (localWorkflow && localWorkflow.id === renamingId) {
        setLocalWorkflow((prev) => prev ? { ...prev, name: renameValue.trim() } : prev);
      }
    }
    setRenamingId(null);
  }, [renamingId, renameValue, workflows, saveWf, localWorkflow]);

  const toggleCategory = useCallback((catId: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  }, []);

  const selectedNode = localWorkflow?.nodes.find((n) => n.id === selectedNodeId) || null;
  const isRunning = executionStatus === 'running';
  const filteredWorkflows = search
    ? workflows.filter((w) => w.name.toLowerCase().includes(search.toLowerCase()))
    : workflows;

  // ── Delete node / edge via keyboard ──
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Don't intercept Delete/Backspace while user is typing in inputs
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedEdgeId) {
        handleDeleteEdge(selectedEdgeId);
      } else if (selectedNodeId) {
        handleDeleteNode(selectedNodeId);
      }
    }
  }, [selectedNodeId, selectedEdgeId, handleDeleteNode, handleDeleteEdge]);

  // Filtered node categories for search
  const filteredCategories = useMemo(() => {
    if (!nodeSearch.trim()) return NODE_CATEGORIES;
    const q = nodeSearch.toLowerCase();
    return NODE_CATEGORIES.map((cat) => ({
      ...cat,
      nodes: cat.nodes.filter((nt) => {
        const meta = NODE_TYPE_META[nt];
        return meta.label.toLowerCase().includes(q) || nt.toLowerCase().includes(q);
      }),
    })).filter((cat) => cat.nodes.length > 0);
  }, [nodeSearch]);

  return (
    <div className={cn('flex h-full min-h-0 bg-bg-app', isFullscreen && 'fixed inset-0 z-[900]')} onKeyDown={handleKeyDown} tabIndex={-1}>
      {/* ── Left Sidebar: workflow list + categorized node palette ── */}
      <div className="shrink-0 flex flex-col border-r border-border-default/60 bg-bg-primary/60" style={{ width: sidebarWidth }}>
        {/* Workflow list header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-default/60 shrink-0">
          <span className="pf-text-xs font-semibold text-text-secondary">{t('workflow.title')}</span>
          <button onClick={handleCreate} className="wb-icon-btn" title={t('workflow.newWorkflow')}>
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-border-default/30 shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-text-disabled" />
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={t('workflow.title') + '...'}
              className="h-7 w-full pf-rounded-md border border-border-default/40 bg-bg-secondary/30 pl-7 pr-2 pf-text-xs text-text-primary outline-none placeholder:text-text-disabled focus:border-accent/40"
            />
          </div>
        </div>

        {/* Workflow list */}
        <div className="flex-1 min-h-0 overflow-y-auto" style={{ maxHeight: '40%' }}>
          {loading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-text-disabled" /></div>
          ) : filteredWorkflows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 px-4 text-center gap-2">
              <WorkflowIcon className="h-6 w-6 text-text-disabled opacity-40" />
              <p className="pf-text-xs text-text-disabled">{t('workflow.noWorkflows')}</p>
              <button onClick={handleCreate} className="pf-text-xs text-accent hover:underline">{t('workflow.newWorkflow')}</button>
            </div>
          ) : (
            filteredWorkflows.map((w) => (
              <div
                key={w.id}
                onClick={() => setActiveId(w.id)}
                className={cn(
                  'group flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-bg-hover/50 cursor-pointer',
                  w.id === activeWorkflowId && 'bg-accent/8 border-r-2 border-accent',
                )}
              >
                <WorkflowIcon className="h-3.5 w-3.5 text-text-tertiary shrink-0" />
                {renamingId === w.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="pf-text-xs text-text-primary flex-1 min-w-0 bg-bg-input border border-accent/40 pf-rounded-sm px-1.5 py-0.5 outline-none"
                  />
                ) : (
                  <span
                    className="pf-text-xs text-text-primary flex-1 truncate"
                    onDoubleClick={(e) => { e.stopPropagation(); startRename(w.id, w.name); }}
                  >
                    {w.name}
                  </span>
                )}
                <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-all">
                  <button
                    onClick={(e) => { e.stopPropagation(); startRename(w.id, w.name); }}
                    className="p-0.5 text-text-disabled hover:text-text-secondary"
                    title={t('workflow.rename')}
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(w.id, w.name); }}
                    className="p-0.5 text-text-disabled hover:text-red-500"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* ── Node Palette — categorized cards with search ── */}
        {localWorkflow && (
          <div className="border-t border-border-default/60 flex flex-col flex-1 min-h-0">
            {/* Palette header with search */}
            <div className="px-3 py-2 border-b border-border-default/30 shrink-0">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="pf-text-xxs font-semibold text-text-disabled uppercase tracking-wider">{t('workflow.addNode')}</span>
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-text-disabled" />
                <input
                  value={nodeSearch} onChange={(e) => setNodeSearch(e.target.value)}
                  placeholder={t('workflow.searchNodes')}
                  className="h-7 w-full pf-rounded-md border border-border-default/40 bg-bg-secondary/30 pl-7 pr-2 pf-text-xxs text-text-primary outline-none placeholder:text-text-disabled focus:border-accent/40"
                />
              </div>
            </div>

            {/* Categories */}
            <div className="flex-1 min-h-0 overflow-y-auto px-2.5 pb-3">
              {filteredCategories.map((cat) => {
                const isCollapsed = collapsedCategories.has(cat.id);
                return (
                  <div key={cat.id} className="mt-2.5 first:mt-2">
                    <button
                      onClick={() => toggleCategory(cat.id)}
                      className="flex items-center gap-1 w-full px-1.5 py-1.5 pf-text-xxs font-semibold text-text-disabled uppercase tracking-wider hover:text-text-tertiary transition-colors"
                    >
                      {isCollapsed ? <ChevronRight className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
                      {t(cat.labelKey)}
                      <span className="pf-text-xxs text-text-disabled/50 ml-auto normal-case tracking-normal">{cat.nodes.length}</span>
                    </button>
                    {!isCollapsed && (
                      <div className="grid gap-1.5 mt-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(74px, 1fr))' }}>
                        {cat.nodes.map((nt) => (
                          <NodeCard
                            key={nt}
                            nodeType={nt}
                            onAdd={handleAddNode}
                            onDragStart={handlePaletteDragStart}
                            onDragEnd={handlePaletteDragEnd}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Left resize handle ── */}
      <div
        className="w-[3px] shrink-0 cursor-col-resize hover:bg-accent/30 active:bg-accent/50 transition-colors"
        onMouseDown={(e) => handleResizeStart('left', e)}
      />

      {/* ── Center: Canvas ── */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Toolbar */}
        {localWorkflow && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border-default/60 bg-bg-primary/50 shrink-0">
            <span className="pf-text-sm font-semibold text-text-primary truncate flex-1">
              {localWorkflow.name}
              {dirty && <span className="text-text-disabled ml-1">*</span>}
            </span>
            <button onClick={handleSave} disabled={!dirty} className={cn('wb-ghost-btn pf-text-xs inline-flex items-center gap-1', !dirty && 'opacity-40')}>
              <Save className="h-3 w-3" /> {t('workflow.save')}
            </button>
            {isRunning ? (
              <button onClick={cancelExec} className="flex items-center gap-1 h-7 px-3 pf-rounded-lg bg-red-500 pf-text-xs font-semibold text-white hover:bg-red-600 transition-colors">
                <Square className="h-3 w-3" /> {t('workflow.stop')}
              </button>
            ) : (
              <button onClick={handleRun} className="flex items-center gap-1 h-7 px-3 pf-rounded-lg bg-accent pf-text-xs font-semibold text-white hover:bg-accent/90 transition-colors shadow-sm">
                <Play className="h-3 w-3" /> {t('workflow.run')}
              </button>
            )}
            <div className="w-[1px] h-4 bg-border-default shrink-0" />
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="wb-icon-btn"
              title={isFullscreen ? t('workflow.exitFullscreen') : t('workflow.fullscreen')}
            >
              {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          </div>
        )}

        {/* Canvas */}
        <div
          className={cn('flex-1 min-h-0 relative transition-colors', isPaletteDragging && 'bg-accent/3')}
        >
          {localWorkflow ? (
            <>
              {isPaletteDragging && (
                <div className="pointer-events-none absolute inset-3 z-10 rounded-2xl border border-dashed border-accent/55 bg-accent/4 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.06)]">
                  <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full border border-accent/20 bg-bg-elevated/95 px-3 py-1.5 pf-text-xxs font-medium text-accent shadow-sm">
                    {t('workflow.emptyCanvas')}
                  </div>
                </div>
              )}
              <ReactFlow
                nodes={rfNodes}
                edges={rfEdges}
                onNodesChange={handleNodesChange}
                onEdgesChange={handleEdgesChange}
                onConnect={onConnect}
                onNodeClick={handleNodeClick}
                onEdgeClick={handleEdgeClick}
                onPaneClick={handlePaneClick}
                onNodeContextMenu={handleNodeContextMenu}
                onEdgeContextMenu={handleEdgeContextMenu}
                onPaneContextMenu={handlePaneContextMenu}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                fitView
                deleteKeyCode={null}
                colorMode={theme === 'dark' ? 'dark' : 'light'}
                defaultEdgeOptions={{ type: 'labeled', markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 }, style: { strokeWidth: 2 } }}
              >
                <Background gap={16} size={1} />
                <Controls showInteractive={false} />
                <MiniMap
                  nodeStrokeWidth={3}
                  pannable
                  zoomable
                />
              </ReactFlow>
              {ContextMenuComponent}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-text-disabled gap-3">
              <WorkflowIcon className="h-12 w-12 opacity-20" />
              <p className="pf-text-sm">{t('workflow.noWorkflowsHint')}</p>
              <button onClick={handleCreate} className="flex items-center gap-1.5 h-8 px-4 pf-rounded-lg bg-accent pf-text-xs font-semibold text-white hover:bg-accent/90 transition-colors shadow-sm">
                <Plus className="h-3.5 w-3.5" /> {t('workflow.newWorkflow')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Right resize handle ── */}
      {localWorkflow && (selectedNode || nodeResults.length > 0 || executionStatus !== null) && (
        <div
          className="w-[3px] shrink-0 cursor-col-resize hover:bg-accent/30 active:bg-accent/50 transition-colors"
          onMouseDown={(e) => handleResizeStart('right', e)}
        />
      )}

      {/* ── Right Panel: Config / Results ── */}
      {localWorkflow && (selectedNode || nodeResults.length > 0 || executionStatus !== null) && (
        <div className="shrink-0 border-l border-border-default/60 bg-bg-primary/60 flex flex-col" style={{ width: rightPanelWidth }}>
          {/* Panel tabs */}
          <div className="flex border-b border-border-default/60 shrink-0">
            <button
              onClick={() => setRightPanel('config')}
              className={cn('flex-1 py-2 pf-text-xs font-medium text-center transition-colors', rightPanel === 'config' ? 'text-accent border-b-2 border-accent' : 'text-text-tertiary hover:text-text-primary')}
            >
              {t('workflow.nodeConfig')}
            </button>
            <button
              onClick={() => setRightPanel('results')}
              className={cn('flex-1 py-2 pf-text-xs font-medium text-center transition-colors', rightPanel === 'results' ? 'text-accent border-b-2 border-accent' : 'text-text-tertiary hover:text-text-primary')}
            >
              {t('workflow.resultPanel')}
              {nodeResults.length > 0 && (
                <span className="ml-1 pf-text-xxs text-text-disabled">({nodeResults.length})</span>
              )}
            </button>
          </div>

          {/* Panel content */}
          <div className="flex-1 min-h-0">
            {rightPanel === 'config' ? (
              selectedNode ? (
                <NodeConfigPanel
                  node={selectedNode}
                  onChange={handleUpdateNode}
                  onClose={() => setSelectedNodeId(null)}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-text-disabled pf-text-xs px-4 text-center">
                  {t('workflow.selectNode')}
                </div>
              )
            ) : (
              <ExecutionPanel
                nodeResults={nodeResults}
                progress={executionProgress}
                status={executionStatus}
                onClear={clearExec}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
