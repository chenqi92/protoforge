import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import {
  Plus, Trash2, CheckCircle2, XCircle, Copy, GripVertical,
  Zap, ChevronDown, Crosshair,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import type { TestResult, HttpResponse } from '@/types/http';

// ── Assertion model ──

type AssertionField =
  | 'status'
  | 'statusText'
  | 'body'
  | 'bodyJson'
  | 'header'
  | 'duration'
  | 'bodySize'
  | 'contentType';

type AssertionOp =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'matches'
  | 'exists'
  | 'isType';

export interface Assertion {
  id: string;
  enabled: boolean;
  name: string;
  field: AssertionField;
  /** For 'header' field: the header name; for 'bodyJson': the JSON path */
  fieldArg: string;
  operator: AssertionOp;
  expected: string;
}

const FIELD_OPTIONS: { value: AssertionField; label: string; hasArg?: boolean; argPlaceholder?: string }[] = [
  { value: 'status', label: 'Status Code' },
  { value: 'statusText', label: 'Status Text' },
  { value: 'bodyJson', label: 'JSON Path', hasArg: true, argPlaceholder: 'data.id' },
  { value: 'body', label: 'Body (raw)' },
  { value: 'header', label: 'Header', hasArg: true, argPlaceholder: 'Content-Type' },
  { value: 'duration', label: 'Duration (ms)' },
  { value: 'bodySize', label: 'Body Size (bytes)' },
  { value: 'contentType', label: 'Content-Type' },
];

const OP_OPTIONS: { value: AssertionOp; label: string; noExpected?: boolean }[] = [
  { value: 'equals', label: '==' },
  { value: 'notEquals', label: '!=' },
  { value: 'contains', label: 'contains' },
  { value: 'notContains', label: '!contains' },
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
  { value: 'gte', label: '>=' },
  { value: 'lte', label: '<=' },
  { value: 'matches', label: 'regex' },
  { value: 'exists', label: 'exists', noExpected: true },
  { value: 'isType', label: 'is type' },
];

function createAssertion(overrides?: Partial<Assertion>): Assertion {
  return {
    id: crypto.randomUUID(),
    enabled: true,
    name: '',
    field: 'status',
    fieldArg: '',
    operator: 'equals',
    expected: '200',
    ...overrides,
  };
}

// ── Presets ──

type PresetKey = 'status200' | 'status2xx' | 'jsonNotEmpty' | 'duration' | 'contentJson' | 'bodyContains';

const PRESETS: { key: PresetKey; labelKey: string; make: () => Partial<Assertion> }[] = [
  { key: 'status200', labelKey: 'assertion.presetStatus200', make: () => ({ field: 'status', operator: 'equals', expected: '200' }) },
  { key: 'status2xx', labelKey: 'assertion.presetStatus2xx', make: () => ({ field: 'status', operator: 'matches', expected: '^2\\d{2}$' }) },
  { key: 'jsonNotEmpty', labelKey: 'assertion.presetJsonNotEmpty', make: () => ({ field: 'body', operator: 'notEquals', expected: '' }) },
  { key: 'duration', labelKey: 'assertion.presetDuration', make: () => ({ field: 'duration', operator: 'lt', expected: '500' }) },
  { key: 'contentJson', labelKey: 'assertion.presetContentJson', make: () => ({ field: 'contentType', operator: 'contains', expected: 'json' }) },
  { key: 'bodyContains', labelKey: 'assertion.presetBodyContains', make: () => ({ field: 'body', operator: 'contains', expected: '' }) },
];

// ── Code generation ──

function generateFieldAccess(a: Assertion): string {
  switch (a.field) {
    case 'status': return 'pm.response.code';
    case 'statusText': return 'pm.response.statusText';
    case 'body': return 'pm.response.body';
    case 'duration': return 'pm.response.responseTime';
    case 'bodySize': return 'pm.response.body.length';
    case 'contentType':
      return 'pm.response.headers.find(h => h.key.toLowerCase() === "content-type")?.value || ""';
    case 'header':
      return `pm.response.headers.find(h => h.key.toLowerCase() === ${JSON.stringify(a.fieldArg.toLowerCase())})?.value`;
    case 'bodyJson': {
      const path = a.fieldArg.split('.').map(p => `[${JSON.stringify(p)}]`).join('');
      return `pm.response.json()${path}`;
    }
  }
}

function generateComparison(a: Assertion): string {
  const expected = a.expected;
  const isNumeric = a.field === 'status' || a.field === 'duration' || a.field === 'bodySize';
  const expectedExpr = isNumeric ? expected : JSON.stringify(expected);

  switch (a.operator) {
    case 'equals':
      return isNumeric
        ? `if (actual !== ${expectedExpr}) throw new Error("Expected ${expected}, got " + actual);`
        : `if (String(actual) !== ${expectedExpr}) throw new Error("Expected ${expected}, got " + actual);`;
    case 'notEquals':
      return isNumeric
        ? `if (actual === ${expectedExpr}) throw new Error("Expected not ${expected}");`
        : `if (String(actual) === ${expectedExpr}) throw new Error("Expected not ${expected}");`;
    case 'contains':
      return `if (!String(actual).includes(${JSON.stringify(expected)})) throw new Error("Expected to contain '${expected}', got " + actual);`;
    case 'notContains':
      return `if (String(actual).includes(${JSON.stringify(expected)})) throw new Error("Expected not to contain '${expected}'");`;
    case 'gt':
      return `if (!(actual > ${expected})) throw new Error("Expected > ${expected}, got " + actual);`;
    case 'lt':
      return `if (!(actual < ${expected})) throw new Error("Expected < ${expected}, got " + actual);`;
    case 'gte':
      return `if (!(actual >= ${expected})) throw new Error("Expected >= ${expected}, got " + actual);`;
    case 'lte':
      return `if (!(actual <= ${expected})) throw new Error("Expected <= ${expected}, got " + actual);`;
    case 'matches':
      return `if (!new RegExp(${JSON.stringify(expected)}).test(String(actual))) throw new Error("Expected to match /${expected}/, got " + actual);`;
    case 'exists':
      return `if (actual === undefined || actual === null) throw new Error("Expected to exist, got " + actual);`;
    case 'isType':
      return `if (typeof actual !== ${JSON.stringify(expected)}) throw new Error("Expected type ${expected}, got " + typeof actual);`;
  }
}

function generateTestName(a: Assertion): string {
  if (a.name) return a.name;
  const fieldLabel = FIELD_OPTIONS.find(f => f.value === a.field)?.label || a.field;
  const opLabel = OP_OPTIONS.find(o => o.value === a.operator)?.label || a.operator;
  const argSuffix = a.fieldArg ? ` [${a.fieldArg}]` : '';
  const expectedSuffix = a.operator !== 'exists' ? ` ${a.expected}` : '';
  return `${fieldLabel}${argSuffix} ${opLabel}${expectedSuffix}`;
}

export function generateAssertionCode(assertions: Assertion[]): string {
  const active = assertions.filter(a => a.enabled);
  if (active.length === 0) return '';

  const lines = ['// ── Visual Assertions (auto-generated) ──'];
  for (const a of active) {
    const name = generateTestName(a);
    const accessor = generateFieldAccess(a);
    const comparison = generateComparison(a);
    lines.push(
      `pm.test(${JSON.stringify(name)}, () => {`,
      `  var actual = ${accessor};`,
      `  ${comparison}`,
      `});`,
      '',
    );
  }
  return lines.join('\n');
}

// ── Extract actual value from response for preview ──

function extractActualValue(a: Assertion, response: HttpResponse | null | undefined): string | undefined {
  if (!response) return undefined;
  try {
    switch (a.field) {
      case 'status': return String(response.status);
      case 'statusText': return response.statusText;
      case 'body': return response.body.length > 120 ? response.body.slice(0, 120) + '...' : response.body;
      case 'duration': return String(response.durationMs);
      case 'bodySize': return String(response.bodySize);
      case 'contentType': {
        const ct = response.headers.find(([k]) => k.toLowerCase() === 'content-type');
        return ct ? ct[1] : undefined;
      }
      case 'header': {
        if (!a.fieldArg) return undefined;
        const h = response.headers.find(([k]) => k.toLowerCase() === a.fieldArg.toLowerCase());
        return h ? h[1] : undefined;
      }
      case 'bodyJson': {
        if (!a.fieldArg) return undefined;
        const json = JSON.parse(response.body);
        const parts = a.fieldArg.split('.');
        let val: unknown = json;
        for (const p of parts) {
          if (val == null || typeof val !== 'object') return undefined;
          val = (val as Record<string, unknown>)[p];
        }
        return val === undefined ? undefined : typeof val === 'object' ? JSON.stringify(val) : String(val);
      }
    }
  } catch {
    return undefined;
  }
}

// ── JSON Path Picker ──

function collectJsonPaths(obj: unknown, prefix: string, maxDepth: number): string[] {
  if (maxDepth <= 0 || obj == null || typeof obj !== 'object') return [];
  const paths: string[] = [];
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    paths.push(path);
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      paths.push(...collectJsonPaths(val, path, maxDepth - 1));
    }
  }
  return paths;
}

function JsonPathPicker({ response, onPick, onClose }: {
  response: HttpResponse | null | undefined;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const paths = useMemo(() => {
    if (!response?.body) return [];
    try {
      const json = JSON.parse(response.body);
      return collectJsonPaths(json, '', 5);
    } catch {
      return [];
    }
  }, [response]);

  const filtered = filter ? paths.filter(p => p.toLowerCase().includes(filter.toLowerCase())) : paths;

  return (
    <div ref={ref} className="absolute left-0 top-full z-50 mt-1 w-[260px] max-h-[240px] flex flex-col overflow-hidden pf-rounded-lg border border-border-default bg-bg-elevated shadow-lg">
      <div className="px-2 py-1.5 border-b border-border-default/40">
        <input
          autoFocus
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('assertion.pickJsonPathHint')}
          className="w-full bg-transparent pf-text-xs text-text-primary outline-none placeholder:text-text-disabled"
        />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-center pf-text-xs text-text-disabled">
            {paths.length === 0 ? t('assertion.noResponse') : t('assertion.empty')}
          </div>
        ) : (
          filtered.slice(0, 80).map((path) => (
            <button
              key={path}
              onClick={() => { onPick(path); onClose(); }}
              className="flex w-full items-center px-3 py-1.5 text-left pf-text-xs font-mono text-text-secondary hover:bg-bg-hover/60 transition-colors truncate"
            >
              {path}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ── Presets dropdown ──

function PresetsDropdown({ onAdd }: { onAdd: (overrides: Partial<Assertion>) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="wb-ghost-btn pf-text-xs inline-flex items-center gap-1"
      >
        <Zap className="h-3 w-3" /> {t('assertion.presets')} <ChevronDown className="h-2.5 w-2.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-[220px] overflow-hidden pf-rounded-lg border border-border-default bg-bg-elevated shadow-lg">
          <div className="px-3 py-1.5 pf-text-xxs text-text-disabled border-b border-border-default/40">
            {t('assertion.presetsDesc')}
          </div>
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => { onAdd(p.make()); setOpen(false); }}
              className="flex w-full items-center px-3 py-2 text-left pf-text-xs text-text-secondary hover:bg-bg-hover/60 transition-colors"
            >
              {t(p.labelKey)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Component ──

export function AssertionBuilder({
  assertions,
  onChange,
  testResults,
  response,
  compact,
}: {
  assertions: Assertion[];
  onChange: (assertions: Assertion[]) => void;
  testResults?: TestResult[];
  response?: HttpResponse | null;
  /** Compact mode: used in post-script side panel */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const dragSrcRef = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const handleAdd = useCallback((overrides?: Partial<Assertion>) => {
    onChange([...assertions, createAssertion(overrides)]);
  }, [assertions, onChange]);

  const handleRemove = useCallback((id: string) => {
    onChange(assertions.filter(a => a.id !== id));
  }, [assertions, onChange]);

  const handleDuplicate = useCallback((id: string) => {
    const src = assertions.find(a => a.id === id);
    if (!src) return;
    const dup = { ...src, id: crypto.randomUUID(), name: src.name ? `${src.name} (copy)` : '' };
    const idx = assertions.findIndex(a => a.id === id);
    const next = [...assertions];
    next.splice(idx + 1, 0, dup);
    onChange(next);
  }, [assertions, onChange]);

  const handleUpdate = useCallback((id: string, updates: Partial<Assertion>) => {
    onChange(assertions.map(a => a.id === id ? { ...a, ...updates } : a));
  }, [assertions, onChange]);

  // Drag-and-drop reorder
  const handleDragStart = useCallback((idx: number) => { dragSrcRef.current = idx; }, []);
  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  }, []);
  const handleDrop = useCallback((idx: number) => {
    const from = dragSrcRef.current;
    if (from == null || from === idx) { setDragOverIdx(null); return; }
    const next = [...assertions];
    const [moved] = next.splice(from, 1);
    next.splice(idx, 0, moved);
    onChange(next);
    dragSrcRef.current = null;
    setDragOverIdx(null);
  }, [assertions, onChange]);
  const handleDragEnd = useCallback(() => { dragSrcRef.current = null; setDragOverIdx(null); }, []);

  // Match test results to assertions by name
  const getResult = (a: Assertion): TestResult | undefined => {
    if (!testResults?.length) return undefined;
    const name = generateTestName(a);
    return testResults.find(tr => tr.name === name);
  };

  // Summary counts
  const enabledCount = assertions.filter(a => a.enabled).length;
  const passedCount = testResults ? testResults.filter(tr => tr.passed).length : 0;
  const totalTested = testResults?.length || 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border-default/60 shrink-0">
        <div className="flex items-center gap-2">
          <span className="pf-text-xs font-medium text-text-secondary">
            {t('assertion.title')} ({enabledCount})
          </span>
          {totalTested > 0 && (
            <span className={cn(
              "inline-flex items-center gap-1 pf-text-xxs font-semibold px-1.5 py-0.5 pf-rounded-md",
              passedCount === totalTested
                ? "bg-emerald-500/10 text-emerald-600"
                : "bg-red-500/10 text-red-500",
            )}>
              {passedCount === totalTested ? (
                <><CheckCircle2 className="h-3 w-3" /> {t('assertion.allPassed')}</>
              ) : (
                <><XCircle className="h-3 w-3" /> {t('assertion.passCount', { passed: passedCount, total: totalTested })}</>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!compact && <PresetsDropdown onAdd={handleAdd} />}
          <button onClick={() => handleAdd()} className="wb-ghost-btn pf-text-xs inline-flex items-center gap-1">
            <Plus className="h-3 w-3" /> {t('assertion.add')}
          </button>
        </div>
      </div>

      {/* Assertion rows */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {assertions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-disabled px-4 text-center gap-3">
            <p className="pf-text-xs">{t('assertion.empty')}</p>
            <div className="flex items-center gap-2">
              <button onClick={() => handleAdd()} className="wb-ghost-btn pf-text-xs inline-flex items-center gap-1 text-accent">
                <Plus className="h-3 w-3" /> {t('assertion.addFirst')}
              </button>
              {!compact && <PresetsDropdown onAdd={handleAdd} />}
            </div>
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {assertions.map((a, idx) => {
              const fieldOpt = FIELD_OPTIONS.find(f => f.value === a.field);
              const opOpt = OP_OPTIONS.find(o => o.value === a.operator);
              const result = getResult(a);
              const actualValue = response ? extractActualValue(a, response) : undefined;

              return (
                <div
                  key={a.id}
                  draggable
                  onDragStart={() => handleDragStart(idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDrop={() => handleDrop(idx)}
                  onDragEnd={handleDragEnd}
                  className={cn(
                    "flex flex-col gap-1.5 p-2 pf-rounded-sm border transition-colors",
                    !a.enabled && "opacity-50",
                    result?.passed === true && "border-emerald-500/30 bg-emerald-500/5",
                    result?.passed === false && "border-red-500/30 bg-red-500/5",
                    result === undefined && "border-border-default/60",
                    dragOverIdx === idx && "border-accent/60 bg-accent/5",
                  )}
                >
                  {/* Row 0: optional custom name */}
                  {!compact && (
                    <div className="flex items-center gap-1.5">
                      <GripVertical className="h-3 w-3 text-text-disabled cursor-grab shrink-0" />
                      <input
                        type="text"
                        value={a.name}
                        onChange={(e) => handleUpdate(a.id, { name: e.target.value })}
                        placeholder={t('assertion.testName')}
                        className="wb-field-sm pf-text-xs flex-1 text-text-tertiary italic"
                      />
                    </div>
                  )}

                  {/* Row 1: enable + field + arg */}
                  <div className="flex items-center gap-1.5">
                    {compact && <GripVertical className="h-3 w-3 text-text-disabled cursor-grab shrink-0" />}
                    <input
                      type="checkbox"
                      checked={a.enabled}
                      onChange={(e) => handleUpdate(a.id, { enabled: e.target.checked })}
                      className="shrink-0"
                    />

                    {/* Field */}
                    <select
                      value={a.field}
                      onChange={(e) => {
                        const field = e.target.value as AssertionField;
                        const defaults: Partial<Assertion> = { field, fieldArg: '' };
                        if (field === 'status') {
                          defaults.operator = 'equals';
                          defaults.expected = '200';
                        } else if (field === 'duration') {
                          defaults.operator = 'lt';
                          defaults.expected = '500';
                        }
                        handleUpdate(a.id, defaults);
                      }}
                      className="wb-field-sm pf-text-xs min-w-[100px]"
                    >
                      {FIELD_OPTIONS.map(f => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </select>

                    {/* Field arg (header name / JSON path) */}
                    {fieldOpt?.hasArg && (
                      <div className="relative flex-1 min-w-[80px] flex items-center gap-0.5">
                        <input
                          type="text"
                          value={a.fieldArg}
                          onChange={(e) => handleUpdate(a.id, { fieldArg: e.target.value })}
                          placeholder={fieldOpt.argPlaceholder}
                          className="wb-field-sm pf-text-xs flex-1 font-mono"
                        />
                        {a.field === 'bodyJson' && response && (
                          <>
                            <button
                              onClick={() => setPickerFor(pickerFor === a.id ? null : a.id)}
                              className="shrink-0 p-0.5 text-text-disabled hover:text-accent transition-colors"
                              title={t('assertion.pickJsonPath')}
                            >
                              <Crosshair className="h-3 w-3" />
                            </button>
                            {pickerFor === a.id && (
                              <JsonPathPicker
                                response={response}
                                onPick={(path) => handleUpdate(a.id, { fieldArg: path })}
                                onClose={() => setPickerFor(null)}
                              />
                            )}
                          </>
                        )}
                      </div>
                    )}

                    {/* Result indicator */}
                    {result && (
                      <span className="ml-auto shrink-0">
                        {result.passed
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          : <XCircle className="h-3.5 w-3.5 text-red-500" />}
                      </span>
                    )}

                    {/* Actions */}
                    <button onClick={() => handleDuplicate(a.id)} className="shrink-0 p-0.5 text-text-disabled hover:text-text-secondary transition-colors" title={t('assertion.duplicate')}>
                      <Copy className="h-3 w-3" />
                    </button>
                    <button onClick={() => handleRemove(a.id)} className="shrink-0 p-0.5 text-text-disabled hover:text-red-500 transition-colors">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>

                  {/* Row 2: operator + expected */}
                  <div className="flex items-center gap-1.5 pl-5">
                    <select
                      value={a.operator}
                      onChange={(e) => handleUpdate(a.id, { operator: e.target.value as AssertionOp })}
                      className="wb-field-sm pf-text-xs min-w-[80px]"
                    >
                      {OP_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>

                    {!opOpt?.noExpected && (
                      <input
                        type="text"
                        value={a.expected}
                        onChange={(e) => handleUpdate(a.id, { expected: e.target.value })}
                        placeholder={t('assertion.expectedValue')}
                        className="wb-field-sm pf-text-xs flex-1 font-mono"
                      />
                    )}
                  </div>

                  {/* Row 3: actual value preview */}
                  {!compact && a.enabled && (
                    <div className="pl-5 pf-text-xxs text-text-disabled truncate">
                      {actualValue !== undefined ? (
                        <span><span className="text-text-tertiary">{t('assertion.actualValue')}:</span> <span className="font-mono text-text-secondary">{actualValue}</span></span>
                      ) : response ? null : (
                        <span className="italic">{t('assertion.noResponse')}</span>
                      )}
                    </div>
                  )}

                  {/* Error message */}
                  {result && !result.passed && result.error && (
                    <div className="pl-5 pf-text-xxs text-red-500 truncate" title={result.error}>
                      {result.error}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Test Results Panel (for response tab) ──

export function TestResultsPanel({ testResults }: { testResults?: TestResult[] }) {
  const { t } = useTranslation();

  if (!testResults || testResults.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-disabled pf-text-sm">
        <CheckCircle2 className="w-4 h-4 mr-2 opacity-40" />
        {t('assertion.testResultsEmpty')}
      </div>
    );
  }

  const passed = testResults.filter(tr => tr.passed).length;
  const failed = testResults.length - passed;

  return (
    <div className="h-full overflow-auto p-3">
      <div className="flex min-h-full flex-col gap-2.5">
        {/* Summary */}
        <div className="response-summary-row">
          <div className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 pf-rounded-lg pf-text-xs font-semibold",
            failed === 0
              ? "bg-emerald-500/10 text-emerald-600"
              : "bg-red-500/10 text-red-500",
          )}>
            {failed === 0 ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
            {t('assertion.passCount', { passed, total: testResults.length })}
          </div>
          {passed > 0 && (
            <span className="pf-text-xs text-emerald-600">
              {passed} {t('assertion.testPassed')}
            </span>
          )}
          {failed > 0 && (
            <span className="pf-text-xs text-red-500">
              {failed} {t('assertion.testFailed')}
            </span>
          )}
        </div>

        {/* Results list */}
        <div className="response-table-frame w-full">
          <div className="overflow-x-auto">
            <table className="response-table min-w-full">
              <thead>
                <tr>
                  <th className="w-[32px]" />
                  <th className="min-w-[200px]">{t('assertion.title')}</th>
                  <th className="w-[200px]">{t('assertion.error')}</th>
                </tr>
              </thead>
              <tbody>
                {testResults.map((tr, i) => (
                  <tr key={i} className={tr.passed ? '' : 'bg-red-500/[0.03]'}>
                    <td className="text-center">
                      {tr.passed
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 inline" />
                        : <XCircle className="h-3.5 w-3.5 text-red-500 inline" />}
                    </td>
                    <td className={cn("response-table-key", !tr.passed && "text-red-600")}>{tr.name}</td>
                    <td className="response-table-value pf-text-xxs text-red-500 truncate" title={tr.error || ''}>
                      {tr.error || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
