/**
 * CryptoContextMenu — 统一自定义右键菜单
 *
 * 完全替代 Monaco 原生右键菜单 + 处理非 Monaco 区域。
 * - Cut / Copy / Paste（仅 Monaco 内）
 * - Mock 数据生成   → hover → 子菜单
 * - 加密 / 编码     → hover → 子菜单
 * - 解密 / 解码     → hover → 子菜单
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { runCrypto, runGenerator } from '@/services/pluginService';
import { usePluginStore } from '@/stores/pluginStore';
import type { InstalledCryptoAlgorithm, CryptoAlgorithm, GeneratorContribution } from '@/types/plugin';
import { CryptoParamsDialog } from './CryptoParamsDialog';
import { CryptoResultDialog } from './CryptoResultDialog';

/* ── 常量 ──────────────────────────────────────────── */

const CATEGORY_LABELS: Record<string, string> = {
  encode: '编码',
  hash: '哈希',
  symmetric: '对称加密',
  asymmetric: '非对称加密',
};
const CATEGORY_ORDER = ['encode', 'hash', 'symmetric', 'asymmetric'];

/* ── 类型 ──────────────────────────────────────────── */

interface MenuPosition { x: number; y: number }

interface PendingAction {
  pluginId: string;
  algorithm: CryptoAlgorithm;
  mode: 'encrypt' | 'decrypt';
  selectedText: string;
  sourceInput?: HTMLInputElement | HTMLTextAreaElement;
  monacoEditor?: any;
  monacoSelection?: any;
}

/* ── 获取选中文本 ─────────────────────────────────── */

function getSelectedText(): { text: string; inputEl?: HTMLInputElement | HTMLTextAreaElement } {
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
    const el = active as HTMLInputElement | HTMLTextAreaElement;
    const s = el.selectionStart ?? 0;
    const e = el.selectionEnd ?? 0;
    if (s !== e) return { text: el.value.substring(s, e), inputEl: el };
  }
  const sel = window.getSelection();
  return { text: sel?.toString().trim() || '' };
}

/**
 * 获取 Monaco 编辑器实例（如果右键在 Monaco 内）
 */
function getMonacoEditor(target: Element): any | null {
  const monacoEl = target.closest('.monaco-editor');
  if (!monacoEl) return null;
  const editors = (window as any).monaco?.editor?.getEditors() as any[] | undefined;
  if (!editors) return null;
  for (const ed of editors) {
    if (ed.getDomNode() === monacoEl || monacoEl.contains(ed.getDomNode())) return ed;
  }
  return null;
}

/* ── 主组件 ────────────────────────────────────────── */

export function CryptoContextMenu() {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<MenuPosition>({ x: 0, y: 0 });
  const [selectedText, setSelectedText] = useState('');
  const [hoveredSub, setHoveredSub] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [resultDialog, setResultDialog] = useState<{ output: string; algorithmName: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const sourceInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const monacoEditorRef = useRef<any>(null);
  const monacoSelectionRef = useRef<any>(null);

  const installedPlugins = usePluginStore((s) => s.installedPlugins);

  // 构建算法列表
  const algorithmsRef = useRef<InstalledCryptoAlgorithm[]>([]);
  const algorithms: InstalledCryptoAlgorithm[] = [];
  const cryptoPlugins = installedPlugins.filter((p) => p.pluginType === 'crypto-tool');
  for (const cp of cryptoPlugins) {
    for (const algo of (cp.contributes?.cryptoAlgorithms || [])) {
      algorithms.push({ pluginId: cp.id, algorithm: algo });
    }
  }
  algorithmsRef.current = algorithms;

  // 构建生成器列表
  const generatorsRef = useRef<{ pluginId: string; gen: GeneratorContribution }[]>([]);
  const generators: { pluginId: string; gen: GeneratorContribution }[] = [];
  for (const p of installedPlugins.filter((p) => p.pluginType === 'data-generator')) {
    for (const g of (p.contributes?.generators || [])) {
      generators.push({ pluginId: p.id, gen: g });
    }
  }
  generatorsRef.current = generators;

  // 是否在 Monaco 内 → 决定是否显示 Cut/Copy/Paste
  const isInMonacoRef = useRef(false);

  // 监听 crypto-action（来自其他组件的参数弹框请求）
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d) return;
      setPendingAction({
        pluginId: d.pluginId,
        algorithm: d.algorithm,
        mode: d.mode,
        selectedText: d.selectedText,
        monacoEditor: d.editorId ? getMonacoEditorById(d.editorId) : undefined,
      });
    };
    window.addEventListener('crypto-action', handler);
    return () => window.removeEventListener('crypto-action', handler);
  }, []);

  // 监听 crypto-result
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d) return;
      setResultDialog({ output: d.output, algorithmName: d.algorithmName });
    };
    window.addEventListener('crypto-result', handler);
    return () => window.removeEventListener('crypto-result', handler);
  }, []);

  // 全局 contextmenu
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Element;

      // 如果右键目标在声明了 data-contextmenu-zone 的区域内，
      // 说明该区域有自己的右键菜单（如 Sidebar），不拦截
      if (target.closest('[data-contextmenu-zone]')) return;

      const monacoEditor = getMonacoEditor(target);

      let text = '';
      let inputEl: HTMLInputElement | HTMLTextAreaElement | undefined;

      if (monacoEditor) {
        // Monaco: 从编辑器获取选区 & 文本
        const selection = monacoEditor.getSelection();
        text = selection ? monacoEditor.getModel()?.getValueInRange(selection) || '' : '';
        monacoEditorRef.current = monacoEditor;
        monacoSelectionRef.current = selection;
        isInMonacoRef.current = true;
        sourceInputRef.current = null;
      } else {
        // 非 Monaco: 从 input/textarea 或 window.getSelection
        const result = getSelectedText();
        text = result.text;
        inputEl = result.inputEl;
        monacoEditorRef.current = null;
        monacoSelectionRef.current = null;
        isInMonacoRef.current = false;
        sourceInputRef.current = inputEl || null;
      }

      // 如果在 Monaco 内 → 总是拦截（显示我们的菜单）
      // 如果不在 Monaco 内 → 只在有选中文本且有插件时拦截
      const hasPlugins = algorithmsRef.current.length > 0 || generatorsRef.current.length > 0;
      if (!monacoEditor && (!text || !hasPlugins)) return;

      e.preventDefault();
      e.stopPropagation();
      setSelectedText(text);

      const x = Math.min(e.clientX, window.innerWidth - 260);
      const y = Math.min(e.clientY, window.innerHeight - 400);
      setPosition({ x, y });
      setVisible(true);
      setHoveredSub(null);
    };

    document.addEventListener('contextmenu', handler, true); // capture phase
    return () => document.removeEventListener('contextmenu', handler, true);
  }, []);

  // 关闭
  useEffect(() => {
    if (!visible) return;
    const close = () => { setVisible(false); setHoveredSub(null); };
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [visible]);

  // 按类别分组 crypto
  const grouped = algorithms.reduce<Record<string, InstalledCryptoAlgorithm[]>>((acc, item) => {
    const cat = item.algorithm.category || 'encode';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  // ── Monaco 操作 ──
  const handleCut = useCallback(() => {
    const ed = monacoEditorRef.current;
    if (ed) {
      ed.focus();
      ed.trigger('custom', 'editor.action.clipboardCutAction', null);
    }
    setVisible(false);
  }, []);

  const handleCopy = useCallback(() => {
    const ed = monacoEditorRef.current;
    if (ed) {
      ed.focus();
      ed.trigger('custom', 'editor.action.clipboardCopyAction', null);
    } else {
      navigator.clipboard.writeText(selectedText);
    }
    setVisible(false);
  }, [selectedText]);

  const handlePaste = useCallback(async () => {
    const ed = monacoEditorRef.current;
    if (ed) {
      ed.focus();
      const text = await navigator.clipboard.readText();
      const selection = ed.getSelection();
      if (selection) {
        ed.executeEdits('paste', [{ range: selection, text, forceMoveMarkers: true }]);
      }
    }
    setVisible(false);
  }, []);

  // ── Mock 生成器 ──
  const handleGenerate = useCallback(async (pluginId: string, generatorId: string) => {
    setVisible(false);
    try {
      const result = await runGenerator(pluginId, generatorId, '{}');
      if (!result.error && result.data) {
        const ed = monacoEditorRef.current;
        const sel = monacoSelectionRef.current;
        if (ed && sel) {
          ed.focus();
          ed.executeEdits('mock-gen', [{ range: sel, text: result.data, forceMoveMarkers: true }]);
        } else {
          replaceSelectedText(result.data, sourceInputRef.current);
        }
      }
    } catch {}
  }, []);

  // ── Crypto 算法点击 ──
  const handleCryptoClick = useCallback((
    pluginId: string,
    algorithm: CryptoAlgorithm,
    mode: 'encrypt' | 'decrypt',
  ) => {
    const hasParams = algorithm.params && algorithm.params.length > 0;
    if (hasParams) {
      setPendingAction({
        pluginId,
        algorithm,
        mode,
        selectedText,
        sourceInput: sourceInputRef.current || undefined,
        monacoEditor: monacoEditorRef.current || undefined,
        monacoSelection: monacoSelectionRef.current || undefined,
      });
      setVisible(false);
    } else {
      executeCrypto(pluginId, algorithm, mode, selectedText);
    }
  }, [selectedText]);

  const executeCrypto = useCallback(async (
    pluginId: string,
    algorithm: CryptoAlgorithm,
    mode: 'encrypt' | 'decrypt',
    input: string,
    paramsJson = '{}',
  ) => {
    setLoading(true);
    setVisible(false);
    try {
      const result = await runCrypto(pluginId, algorithm.algorithmId, mode, input, paramsJson);
      if (!result.success) {
        setResultDialog({ output: `[Error] ${result.error || '未知错误'}`, algorithmName: algorithm.name });
        return;
      }
      if (mode === 'encrypt') {
        const ed = monacoEditorRef.current;
        const sel = monacoSelectionRef.current;
        if (ed && sel) {
          ed.focus();
          ed.executeEdits('crypto', [{ range: sel, text: result.output, forceMoveMarkers: true }]);
        } else {
          replaceSelectedText(result.output, sourceInputRef.current);
        }
      } else {
        setResultDialog({ output: result.output, algorithmName: algorithm.name });
      }
    } catch (err: any) {
      setResultDialog({ output: `[Error] ${err?.message || err}`, algorithmName: algorithm.name });
    } finally {
      setLoading(false);
    }
  }, []);

  const handleParamsConfirm = useCallback(async (paramsJson: string) => {
    if (!pendingAction) return;
    setLoading(true);
    try {
      const result = await runCrypto(
        pendingAction.pluginId,
        pendingAction.algorithm.algorithmId,
        pendingAction.mode,
        pendingAction.selectedText,
        paramsJson,
      );
      if (!result.success) {
        setResultDialog({ output: `[Error] ${result.error || '未知错误'}`, algorithmName: pendingAction.algorithm.name });
      } else if (pendingAction.mode === 'encrypt') {
        const ed = pendingAction.monacoEditor;
        const sel = pendingAction.monacoSelection;
        if (ed && sel) {
          ed.focus();
          ed.executeEdits('crypto', [{ range: sel, text: result.output, forceMoveMarkers: true }]);
        } else {
          replaceSelectedText(result.output, pendingAction.sourceInput);
        }
      } else {
        setResultDialog({ output: result.output, algorithmName: pendingAction.algorithm.name });
      }
    } catch (err: any) {
      setResultDialog({ output: `[Error] ${err?.message || err}`, algorithmName: pendingAction.algorithm.name });
    } finally {
      setLoading(false);
      setPendingAction(null);
    }
  }, [pendingAction]);

  const hasEncrypt = algorithms.some((a) => a.algorithm.supportEncrypt);
  const hasDecrypt = algorithms.some((a) => a.algorithm.supportDecrypt);
  const isInMonaco = isInMonacoRef.current;

  if (!visible && !pendingAction && !resultDialog) return null;

  return (
    <>
      {visible && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[var(--z-toast)] min-w-[200px] rounded-xl border border-border-default bg-bg-surface/95 shadow-xl backdrop-blur-xl py-1"
          style={{ left: position.x, top: position.y, fontSize: 'var(--fs-sm)' }}
        >
          {/* Cut / Copy / Paste — 仅 Monaco */}
          {isInMonaco && (
            <>
              <MenuItem label="剪切" shortcut="⌘X" onClick={handleCut} disabled={!selectedText} />
              <MenuItem label="复制" shortcut="⌘C" onClick={handleCopy} disabled={!selectedText} />
              <MenuItem label="粘贴" shortcut="⌘V" onClick={handlePaste} />
              <Divider />
            </>
          )}

          {/* 🪄 Mock 数据生成 — hover 子菜单 */}
          {generators.length > 0 && (
            <HoverSubmenu
              label="Mock 数据"
              hoverKey="mock"
              hoveredSub={hoveredSub}
              onHover={setHoveredSub}
            >
              {generators.map((g) => (
                <button
                  key={`${g.pluginId}:${g.gen.generatorId}`}
                  onClick={() => handleGenerate(g.pluginId, g.gen.generatorId)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-bg-hover transition-colors"
                >
                  {g.gen.name}
                </button>
              ))}
            </HoverSubmenu>
          )}

          {/* 加密 / 编码 — hover 子菜单 */}
          {hasEncrypt && selectedText && (
            <HoverSubmenu
              label="加密 / 编码"
              hoverKey="encrypt"
              hoveredSub={hoveredSub}
              onHover={setHoveredSub}
            >
              <CryptoSubItems
                grouped={grouped}
                mode="encrypt"
                loading={loading}
                onClick={handleCryptoClick}
              />
            </HoverSubmenu>
          )}

          {/* 解密 / 解码 — hover 子菜单 */}
          {hasDecrypt && selectedText && (
            <HoverSubmenu
              label="解密 / 解码"
              hoverKey="decrypt"
              hoveredSub={hoveredSub}
              onHover={setHoveredSub}
            >
              <CryptoSubItems
                grouped={grouped}
                mode="decrypt"
                loading={loading}
                onClick={handleCryptoClick}
              />
            </HoverSubmenu>
          )}
        </div>,
        document.body,
      )}

      {pendingAction && (
        <CryptoParamsDialog
          algorithm={pendingAction.algorithm}
          mode={pendingAction.mode}
          onConfirm={handleParamsConfirm}
          onCancel={() => setPendingAction(null)}
        />
      )}

      {resultDialog && (
        <CryptoResultDialog
          output={resultDialog.output}
          algorithmName={resultDialog.algorithmName}
          onClose={() => setResultDialog(null)}
        />
      )}
    </>
  );
}

/* ── 菜单项 ────────────────────────────────────────── */

function MenuItem({
  label,
  shortcut,
  onClick,
  disabled,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center justify-between px-3 py-1.5 text-left transition-colors',
        disabled ? 'text-text-disabled cursor-default' : 'text-text-primary hover:bg-bg-hover',
      )}
    >
      <span>{label}</span>
      {shortcut && <span className="ml-4 text-text-disabled" style={{ fontSize: 'var(--fs-xxs)' }}>{shortcut}</span>}
    </button>
  );
}

function Divider() {
  return <div className="mx-2 my-1 border-t border-border-default/50" />;
}

/* ── Hover 子菜单容器 ────────────────────────────── */

function HoverSubmenu({
  label,
  hoverKey,
  hoveredSub,
  onHover,
  children,
}: {
  label: string;
  hoverKey: string;
  hoveredSub: string | null;
  onHover: (key: string | null) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="relative"
      onMouseEnter={() => onHover(hoverKey)}
      onMouseLeave={() => onHover(null)}
    >
      <button className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-bg-hover transition-colors">
        <span className="flex-1">{label}</span>
        <span className="text-text-tertiary pf-text-xs">▸</span>
      </button>
      {hoveredSub === hoverKey && (
        <div
          className="absolute left-full top-0 z-[var(--z-toast)] ml-1 min-w-[180px] rounded-xl border border-border-default bg-bg-surface/95 shadow-xl backdrop-blur-xl py-1"
          style={{ fontSize: 'var(--fs-sm)' }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/* ── Crypto 子菜单内容 ────────────────────────────── */

function CryptoSubItems({
  grouped,
  mode,
  loading,
  onClick,
}: {
  grouped: Record<string, InstalledCryptoAlgorithm[]>;
  mode: 'encrypt' | 'decrypt';
  loading: boolean;
  onClick: (pluginId: string, algo: CryptoAlgorithm, mode: 'encrypt' | 'decrypt') => void;
}) {
  return (
    <>
      {CATEGORY_ORDER.map((cat) => {
        const items = grouped[cat];
        if (!items?.length) return null;
        const filtered = items.filter((i) =>
          mode === 'encrypt' ? i.algorithm.supportEncrypt : i.algorithm.supportDecrypt,
        );
        if (!filtered.length) return null;
        return (
          <div key={cat}>
            <div className="px-3 py-1 text-text-disabled font-medium tracking-wide" style={{ fontSize: 'var(--fs-xxs)' }}>
              {CATEGORY_LABELS[cat] || cat}
            </div>
            {filtered.map((item) => (
              <button
                key={`${item.pluginId}:${item.algorithm.algorithmId}`}
                disabled={loading}
                onClick={() => onClick(item.pluginId, item.algorithm, mode)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-bg-hover transition-colors',
                  loading && 'opacity-50 cursor-not-allowed',
                )}
              >
                <span>{item.algorithm.name}</span>
                {item.algorithm.params && item.algorithm.params.length > 0 && (
                  <span className="text-text-disabled" style={{ fontSize: 'var(--fs-xxs)' }}>params</span>
                )}
              </button>
            ))}
          </div>
        );
      })}
    </>
  );
}

/* ── 工具函数 ──────────────────────────────────────── */

function getMonacoEditorById(editorId: string): any | null {
  const editors = (window as any).monaco?.editor?.getEditors() as any[] | undefined;
  return editors?.find((e: any) => e.getId() === editorId) || null;
}

function replaceSelectedText(replacement: string, inputEl?: HTMLInputElement | HTMLTextAreaElement | null) {
  if (inputEl && inputEl.selectionStart !== null && inputEl.selectionEnd !== null) {
    const start = inputEl.selectionStart;
    const end = inputEl.selectionEnd;
    const val = inputEl.value;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(inputEl, val.substring(0, start) + replacement + val.substring(end));
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.focus();
    inputEl.setSelectionRange(start, start + replacement.length);
    return;
  }
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(replacement));
  sel.removeAllRanges();
}
