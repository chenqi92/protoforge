// ProtoForge Workflow Workspace — visual workflow orchestration (Enhanced)
// Layout: sidebar (workflow list + categorized node palette) | canvas (React Flow) | right panel (config + results)
// Features: resizable panels, categorized drag cards, custom node shapes, edge labels, fullscreen mode

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
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
  CheckSquare, PlayCircle, StopCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
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
  base64Encode: Lock,
  base64Decode: Unlock,
  condition: GitBranch,
  loop: Repeat,
  parallel: Columns,
  setVariable: Variable,
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
    case 'base64Encode': return { input: '' };
    case 'base64Decode': return { input: '' };
    case 'condition': return { expression: '' };
    case 'loop': return { iterations: 3 };
    case 'parallel': return { maxConcurrency: 0 };
    case 'setVariable': return { key: '', value: '' };
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
}

/** Standard rectangle node */
function RectangleNode({ data }: { data: FlowNodeData }) {
  const Icon = NODE_ICONS[data.nodeType] || Globe;
  const meta = NODE_TYPE_META[data.nodeType];
  const isRunning = data.status === 'running';
  const isDone = data.status === 'completed';
  const isFailed = data.status === 'failed';

  return (
    <div className={cn(
      'px-3 py-2 pf-rounded-lg border-2 bg-bg-primary shadow-sm min-w-[160px] transition-colors',
      isRunning && 'border-amber-500 ring-2 ring-amber-500/20',
      isDone && 'border-emerald-500',
      isFailed && 'border-red-500',
      !isRunning && !isDone && !isFailed && 'border-border-default',
    )}>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-accent !border-2 !border-bg-primary" />
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
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-accent !border-2 !border-bg-primary" />
    </div>
  );
}

/** Circle node (start/end) */
function CircleNode({ data }: { data: FlowNodeData }) {
  const Icon = NODE_ICONS[data.nodeType] || Globe;
  const meta = NODE_TYPE_META[data.nodeType];
  const isEnd = data.nodeType === 'end';
  const isRunning = data.status === 'running';
  const isDone = data.status === 'completed';
  const isFailed = data.status === 'failed';

  return (
    <div className={cn(
      'flex h-14 w-14 items-center justify-center rounded-full border-2 bg-bg-primary shadow-sm transition-colors',
      isEnd && 'ring-2 ring-offset-1',
      isRunning && 'border-amber-500 ring-amber-500/20',
      isDone && 'border-emerald-500',
      isFailed && 'border-red-500',
      !isRunning && !isDone && !isFailed && 'border-border-default',
    )} style={isEnd && !isRunning && !isDone && !isFailed ? { boxShadow: `0 0 0 3px ${meta.color}40` } : undefined}>
      {data.nodeType !== 'start' && (
        <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-accent !border-2 !border-bg-primary" />
      )}
      <Icon className="h-5 w-5" style={{ color: meta.color }} />
      {data.nodeType !== 'end' && (
        <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-accent !border-2 !border-bg-primary" />
      )}
    </div>
  );
}

/** Diamond node (condition) */
function DiamondNode({ data }: { data: FlowNodeData }) {
  const Icon = NODE_ICONS[data.nodeType] || Globe;
  const meta = NODE_TYPE_META[data.nodeType];
  const isRunning = data.status === 'running';
  const isDone = data.status === 'completed';
  const isFailed = data.status === 'failed';

  return (
    <div className="relative" style={{ width: 80, height: 80 }}>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-accent !border-2 !border-bg-primary" style={{ top: -6 }} />
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
      {/* Two source handles: left (false) and right (true), plus bottom */}
      <Handle type="source" position={Position.Bottom} id="bottom" className="!w-3 !h-3 !bg-accent !border-2 !border-bg-primary" style={{ bottom: -6 }} />
      <Handle type="source" position={Position.Right} id="right" className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-bg-primary" style={{ right: -6 }} />
      <Handle type="source" position={Position.Left} id="left" className="!w-3 !h-3 !bg-red-500 !border-2 !border-bg-primary" style={{ left: -6 }} />
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

function LabeledEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, style }: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const edgeLabel = (data as Record<string, unknown> | undefined)?.label as string | undefined;

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      {edgeLabel && (
        <EdgeLabelRenderer>
          <div
            className="pf-text-xxs font-medium px-1.5 py-0.5 pf-rounded-md bg-bg-primary border border-border-default/60 text-text-secondary shadow-sm pointer-events-auto"
            style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {edgeLabel}
          </div>
        </EdgeLabelRenderer>
      )}
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

function toRfNodes(nodes: FlowNode[], nodeResults: NodeResult[]): Node[] {
  return nodes.map((n, i) => {
    const result = nodeResults.find((r) => r.nodeId === n.id);
    return {
      id: n.id,
      type: getNodeRfType(n.nodeType),
      position: n.position || { x: 250, y: i * 120 },
      data: { label: n.name, nodeType: n.nodeType, status: result?.status },
    };
  });
}

function toRfEdges(edges: FlowEdge[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.sourceNodeId,
    target: e.targetNodeId,
    sourceHandle: e.sourceHandle || undefined,
    type: e.label ? 'labeled' : 'default',
    data: e.label ? { label: e.label } : undefined,
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

        {(node.nodeType === 'base64Encode' || node.nodeType === 'base64Decode') && (
          <div>
            <label className={labelCls}>{t('workflow.nodeFields.input')}</label>
            <textarea rows={4} value={(config.input as string) || ''} onChange={(e) => updateConfig('input', e.target.value)} className={textareaCls} />
          </div>
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

        {(node.nodeType === 'start' || node.nodeType === 'end') && (
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
        <WorkflowIcon className="h-8 w-8 opacity-30" />
        <p>{t('workflow.noResults')}</p>
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
              {t('workflow.step', { current: progress.currentStep, total: progress.totalSteps })}
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
                <span className="pf-text-xs font-medium text-text-primary flex-1 truncate">{result.nodeName}</span>
                <span className="pf-text-xxs text-text-disabled">{result.durationMs}ms</span>
                {expanded ? <ChevronDown className="h-3 w-3 text-text-disabled" /> : <ChevronRight className="h-3 w-3 text-text-disabled" />}
              </button>
              {expanded && (
                <div className="px-4 pb-3">
                  {result.error && (
                    <div className="pf-text-xxs text-red-500 mb-2 p-2 pf-rounded-md bg-red-500/5 border border-red-500/20">
                      {result.error}
                    </div>
                  )}
                  <div className="pf-text-xxs text-text-tertiary mb-1">{t('workflow.output')}:</div>
                  <pre className="pf-text-xxs font-mono text-text-secondary bg-bg-secondary/40 p-2 pf-rounded-md overflow-x-auto max-h-[200px] overflow-y-auto">
                    {result.output != null ? JSON.stringify(result.output, null, 2) : t('workflow.noOutput')}
                  </pre>
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
//  Node Palette Card
// ═══════════════════════════════════════════

function NodeCard({ nodeType, onAdd }: { nodeType: NodeType; onAdd: (nt: NodeType) => void }) {
  const { t } = useTranslation();
  const meta = NODE_TYPE_META[nodeType];
  const Icon = NODE_ICONS[nodeType];
  const [hovered, setHovered] = useState(false);

  return (
    <button
      draggable
      onClick={() => onAdd(nodeType)}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/protoforge-node-type', nodeType);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative flex items-center gap-2 w-full px-2 py-1.5 pf-rounded-lg text-left hover:bg-bg-hover/60 transition-all cursor-grab active:cursor-grabbing border border-transparent hover:border-border-default/40 group"
    >
      <div className="flex h-7 w-7 items-center justify-center pf-rounded-md shrink-0" style={{ backgroundColor: meta.color + '15' }}>
        <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} />
      </div>
      <span className="pf-text-xs font-medium text-text-primary truncate flex-1">{t(`workflow.nodeTypes.${nodeType}`)}</span>
      {/* Tooltip on hover */}
      {hovered && (
        <div className="absolute left-full ml-2 z-[300] w-48 p-2 pf-rounded-lg bg-bg-elevated border border-border-default/60 shadow-lg pointer-events-none">
          <div className="pf-text-xs font-semibold text-text-primary mb-0.5">{t(`workflow.nodeTypes.${nodeType}`)}</div>
          <div className="pf-text-xxs text-text-disabled leading-4">{t(`workflow.nodeDescs.${nodeType}`)}</div>
        </div>
      )}
    </button>
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
  const [rightPanel, setRightPanel] = useState<'config' | 'results'>('config');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  // Resizable sidebar width via drag handle
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [rightPanelWidth, setRightPanelWidth] = useState(300);
  const resizingRef = useRef<'left' | 'right' | null>(null);
  const resizeStartRef = useRef({ x: 0, width: 0 });

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

  // Sync local state when active workflow changes
  useEffect(() => {
    setLocalWorkflow(activeWorkflow ? { ...activeWorkflow } : null);
    setSelectedNodeId(null);
    bumpStructure();
  }, [activeWorkflow?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // React Flow state
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const reactFlowInstance = useReactFlow();

  // Rebuild RF nodes only on structural changes
  useEffect(() => {
    if (!localWorkflow) { setRfNodes([]); setRfEdges([]); return; }
    setRfNodes(toRfNodes(localWorkflow.nodes, nodeResults));
    setRfEdges(toRfEdges(localWorkflow.edges));
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

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const nodeType = e.dataTransfer.getData('application/protoforge-node-type') as NodeType;
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

  const handleNodeClick = useCallback((_: unknown, node: Node) => {
    setSelectedNodeId(node.id);
    setRightPanel('config');
  }, []);

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

  // ── Delete node via keyboard ──
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId) {
      handleDeleteNode(selectedNodeId);
    }
  }, [selectedNodeId, handleDeleteNode]);

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
                <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-text-disabled" />
                <input
                  value={nodeSearch} onChange={(e) => setNodeSearch(e.target.value)}
                  placeholder={t('workflow.searchNodes')}
                  className="h-6 w-full pf-rounded-md border border-border-default/40 bg-bg-secondary/30 pl-6 pr-2 pf-text-xxs text-text-primary outline-none placeholder:text-text-disabled focus:border-accent/40"
                />
              </div>
            </div>

            {/* Categories */}
            <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
              {filteredCategories.map((cat) => {
                const isCollapsed = collapsedCategories.has(cat.id);
                return (
                  <div key={cat.id} className="mt-1.5">
                    <button
                      onClick={() => toggleCategory(cat.id)}
                      className="flex items-center gap-1 w-full px-1 py-1 pf-text-xxs font-semibold text-text-disabled uppercase tracking-wider hover:text-text-tertiary transition-colors"
                    >
                      {isCollapsed ? <ChevronRight className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
                      {t(cat.labelKey)}
                      <span className="pf-text-xxs text-text-disabled/50 ml-auto normal-case tracking-normal">{cat.nodes.length}</span>
                    </button>
                    {!isCollapsed && (
                      <div className="space-y-0.5 mt-0.5">
                        {cat.nodes.map((nt) => (
                          <NodeCard key={nt} nodeType={nt} onAdd={handleAddNode} />
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
        <div className="flex-1 min-h-0">
          {localWorkflow ? (
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              onNodesChange={handleNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={handleNodeClick}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
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
      {localWorkflow && (selectedNode || nodeResults.length > 0) && (
        <div
          className="w-[3px] shrink-0 cursor-col-resize hover:bg-accent/30 active:bg-accent/50 transition-colors"
          onMouseDown={(e) => handleResizeStart('right', e)}
        />
      )}

      {/* ── Right Panel: Config / Results ── */}
      {localWorkflow && (selectedNode || nodeResults.length > 0) && (
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
