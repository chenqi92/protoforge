import { useCallback } from 'react';
import { Plus, Trash2, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import type { TestResult } from '@/types/http';

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

function createAssertion(): Assertion {
  return {
    id: crypto.randomUUID(),
    enabled: true,
    name: '',
    field: 'status',
    fieldArg: '',
    operator: 'equals',
    expected: '200',
  };
}

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

// ── Component ──

export function AssertionBuilder({
  assertions,
  onChange,
  testResults,
}: {
  assertions: Assertion[];
  onChange: (assertions: Assertion[]) => void;
  testResults?: TestResult[];
}) {
  const { t } = useTranslation();

  const handleAdd = useCallback(() => {
    onChange([...assertions, createAssertion()]);
  }, [assertions, onChange]);

  const handleRemove = useCallback((id: string) => {
    onChange(assertions.filter(a => a.id !== id));
  }, [assertions, onChange]);

  const handleUpdate = useCallback((id: string, updates: Partial<Assertion>) => {
    onChange(assertions.map(a => a.id === id ? { ...a, ...updates } : a));
  }, [assertions, onChange]);

  // Match test results to assertions by name
  const getResult = (a: Assertion): TestResult | undefined => {
    if (!testResults?.length) return undefined;
    const name = generateTestName(a);
    return testResults.find(tr => tr.name === name);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border-default/60 shrink-0">
        <span className="pf-text-xs font-medium text-text-secondary">
          {t('assertion.title')} ({assertions.filter(a => a.enabled).length})
        </span>
        <button onClick={handleAdd} className="wb-ghost-btn pf-text-xs inline-flex items-center gap-1">
          <Plus className="h-3 w-3" /> {t('assertion.add')}
        </button>
      </div>

      {/* Assertion rows */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {assertions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-disabled px-4 text-center">
            <p className="pf-text-xs">{t('assertion.empty')}</p>
            <button onClick={handleAdd} className="mt-2 wb-ghost-btn pf-text-xs inline-flex items-center gap-1 text-accent">
              <Plus className="h-3 w-3" /> {t('assertion.addFirst')}
            </button>
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {assertions.map((a) => {
              const fieldOpt = FIELD_OPTIONS.find(f => f.value === a.field);
              const opOpt = OP_OPTIONS.find(o => o.value === a.operator);
              const result = getResult(a);

              return (
                <div
                  key={a.id}
                  className={cn(
                    "flex flex-col gap-1.5 p-2 pf-rounded-sm border transition-colors",
                    !a.enabled && "opacity-50",
                    result?.passed === true && "border-emerald-500/30 bg-emerald-500/5",
                    result?.passed === false && "border-red-500/30 bg-red-500/5",
                    result === undefined && "border-border-default/60",
                  )}
                >
                  {/* Row 1: enable + field + arg */}
                  <div className="flex items-center gap-1.5">
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
                      <input
                        type="text"
                        value={a.fieldArg}
                        onChange={(e) => handleUpdate(a.id, { fieldArg: e.target.value })}
                        placeholder={fieldOpt.argPlaceholder}
                        className="wb-field-sm pf-text-xs flex-1 font-mono min-w-[80px]"
                      />
                    )}

                    {/* Result indicator */}
                    {result && (
                      <span className="ml-auto shrink-0">
                        {result.passed
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          : <XCircle className="h-3.5 w-3.5 text-red-500" />}
                      </span>
                    )}

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
