/**
 * GlobalContextMenu — 统一全局右键菜单
 *
 * 完全替代浏览器默认右键菜单，提供：
 * - Cut / Copy / Paste / Select All（所有 input/textarea/Monaco）
 * - Format Document（Monaco）
 * - 设为环境变量（选中文本时）
 * - Mock 数据生成   → hover → 子菜单
 * - 加密 / 编码     → hover → 子菜单
 * - 解密 / 解码     → hover → 子菜单
 * - 插件贡献的右键菜单项
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { runCrypto, runGenerator, runContextMenuAction } from '@/services/pluginService';
import { usePluginStore } from '@/stores/pluginStore';
import { EXPORT_FORMATS, getByPath, collectColumnsFromArray, doExportToFile, type FormatDef } from '@/components/ui/ResponseExportDropdown';
import { copyTextToClipboard } from '@/lib/clipboard';
import type { InstalledCryptoAlgorithm, CryptoAlgorithm, GeneratorContribution, ContextMenuContribution } from '@/types/plugin';
import { CryptoParamsDialog } from './CryptoParamsDialog';
import { CryptoResultDialog } from './CryptoResultDialog';
import { SetEnvVariableDialog } from '@/components/env/SetEnvVariableDialog';
import { ProtocolParserPanel } from '@/components/plugins/ProtocolParserPanel';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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

type ContextTarget = 'monaco' | 'input' | 'general';

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

function isInputLike(target: Element): boolean {
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  const el = target.closest('input, textarea');
  if (el) return true;
  // contentEditable elements (e.g. VariableInlineInput)
  return !!getContentEditableElement(target);
}

function getInputElement(target: Element): HTMLInputElement | HTMLTextAreaElement | null {
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
    return target as HTMLInputElement | HTMLTextAreaElement;
  }
  return target.closest('input, textarea') as HTMLInputElement | HTMLTextAreaElement | null;
}

function getContentEditableElement(target: Element): HTMLElement | null {
  if ((target as HTMLElement).isContentEditable) return target as HTMLElement;
  return target.closest('[contenteditable="true"]') as HTMLElement | null;
}

/* ── 主组件 ────────────────────────────────────────── */

export function GlobalContextMenu() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<MenuPosition>({ x: 0, y: 0 });
  const [selectedText, setSelectedText] = useState('');
  const [contextTarget, setContextTarget] = useState<ContextTarget>('general');
  const [hoveredSub, setHoveredSub] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [resultDialog, setResultDialog] = useState<{ output: string; algorithmName: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [parserDialogData, setParserDialogData] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const sourceInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const contentEditableRef = useRef<HTMLElement | null>(null);
  const monacoEditorRef = useRef<any>(null);
  const monacoSelectionRef = useRef<any>(null);
  const modalGuardRef = useRef(false);

  const installedPlugins = usePluginStore((s) => s.installedPlugins);

  // 响应体导出元信息由 ResponseViewer 预先缓存，避免右键时同步解析大 JSON
  const responseBodyRef = useRef('');
  const bestArrayPathRef = useRef('');
  const [hasResponseArrays, setHasResponseArrays] = useState(false);
  const [exportDialog, setExportDialog] = useState<{ fmt: FormatDef; body: string; path: string } | null>(null);

  const syncResponseExportMeta = useCallback(() => {
    const body = (window as any).__pf_response_body;
    responseBodyRef.current = typeof body === 'string' ? body : '';

    const meta = (window as any).__pf_response_export_meta;
    if (!body || !meta || meta.body !== body) {
      bestArrayPathRef.current = '';
      setHasResponseArrays(false);
      return;
    }

    bestArrayPathRef.current = typeof meta.bestArrayPath === 'string' ? meta.bestArrayPath : '';
    setHasResponseArrays(Boolean(bestArrayPathRef.current));
  }, []);

  const handleExportFormat = useCallback((fmt: FormatDef) => {
    setVisible(false);
    setHoveredSub(null);
    const path = bestArrayPathRef.current;
    const body = responseBodyRef.current;
    if (!path || !body) return;
    if (fmt.needsOptions) {
      // 立即弹对话框，列信息在对话框内异步计算
      setExportDialog({ fmt, body, path });
    } else {
      doExportToFile(body, path, fmt).catch(console.warn);
    }
  }, []);

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

  // 检查是否有协议解析器插件
  const hasParserPlugins = installedPlugins.some((p) => p.pluginType === 'protocol-parser');

  // 构建插件右键菜单项列表
  const pluginMenuItems: { pluginId: string; item: ContextMenuContribution }[] = [];
  for (const p of installedPlugins) {
    for (const item of (p.contributes?.contextMenuItems || [])) {
      pluginMenuItems.push({ pluginId: p.id, item });
    }
  }

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

  // 监听协议解析打开事件
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.data) setParserDialogData(d.data);
    };
    window.addEventListener('open-protocol-parser', handler);
    return () => window.removeEventListener('open-protocol-parser', handler);
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

  useEffect(() => {
    modalGuardRef.current = !!(exportDialog || pendingAction || resultDialog || parserDialogData);
  }, [exportDialog, pendingAction, resultDialog, parserDialogData]);

  useEffect(() => {
    if (!visible || contextTarget !== 'monaco') {
      setHasResponseArrays(false);
      return;
    }

    const handleMetaReady = (e: Event) => {
      const d = (e as CustomEvent<{ body?: string }>).detail;
      const currentBody = (window as any).__pf_response_body;
      if (d?.body && d.body !== currentBody) return;
      syncResponseExportMeta();
    };

    syncResponseExportMeta();
    window.addEventListener('pf-response-export-meta-ready', handleMetaReady);
    return () => window.removeEventListener('pf-response-export-meta-ready', handleMetaReady);
  }, [visible, contextTarget, syncResponseExportMeta]);

  // 全局 contextmenu
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Element;

      if (modalGuardRef.current) {
        e.preventDefault();
        return;
      }

      // 如果右键目标在声明了 data-contextmenu-zone 的区域内，交给组件自行处理
      if (target.closest('[data-contextmenu-zone]')) return;

      // 结构性 UI 区域（标题栏、状态栏、按钮、Tab 等）不应弹出全局菜单
      // 仅 Monaco 编辑器、input/textarea 和包含文本内容的区域才需要
      const isStructuralUI = !!(
        target.closest('[data-titlebar]') ||
        target.closest('[data-statusbar]') ||
        target.closest('button') ||
        target.closest('[role="tablist"]') ||
        target.closest('[data-no-contextmenu]')
      );

      const monacoEditor = getMonacoEditor(target);
      const inputLike = !monacoEditor && isInputLike(target);

      // 桌面端始终阻止默认右键菜单
      e.preventDefault();

      // 结构性 UI：既非编辑器也非输入框，直接退出
      if (isStructuralUI && !monacoEditor && !inputLike) return;

      let text = '';
      let inputEl: HTMLInputElement | HTMLTextAreaElement | undefined;

      if (monacoEditor) {
        const selection = monacoEditor.getSelection();
        text = selection ? monacoEditor.getModel()?.getValueInRange(selection) || '' : '';
        monacoEditorRef.current = monacoEditor;
        monacoSelectionRef.current = selection;
        sourceInputRef.current = null;
        setContextTarget('monaco');
        syncResponseExportMeta();
      } else if (inputLike) {
        const el = getInputElement(target);
        const ceEl = !el ? getContentEditableElement(target) : null;
        if (el) {
          const s = el.selectionStart ?? 0;
          const end = el.selectionEnd ?? 0;
          text = s !== end ? el.value.substring(s, end) : '';
          inputEl = el;
        } else if (ceEl) {
          const sel = window.getSelection();
          text = sel?.toString() || '';
        }
        monacoEditorRef.current = null;
        monacoSelectionRef.current = null;
        sourceInputRef.current = inputEl || null;
        contentEditableRef.current = ceEl || null;
        setContextTarget('input');
        bestArrayPathRef.current = '';
        setHasResponseArrays(false);
      } else {
        const result = getSelectedText();
        text = result.text;
        inputEl = result.inputEl;
        monacoEditorRef.current = null;
        monacoSelectionRef.current = null;
        sourceInputRef.current = inputEl || null;
        setContextTarget('general');
        bestArrayPathRef.current = '';
        setHasResponseArrays(false);
      }

      // 对于一般区域（非 Monaco、非 input），仅在有选中文本时才显示菜单
      if (!monacoEditor && !inputLike && !text) return;

      e.stopPropagation();
      setSelectedText(text);

      const x = Math.min(e.clientX, window.innerWidth - 260);
      const y = Math.min(e.clientY, window.innerHeight - 400);
      setPosition({ x, y });
      setVisible(true);
      setHoveredSub(null);
    };

    document.addEventListener('contextmenu', handler, true);
    return () => document.removeEventListener('contextmenu', handler, true);
  }, [syncResponseExportMeta]);

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

  // ── 剪贴板操作 ──
  const handleCut = useCallback(() => {
    if (contextTarget === 'monaco') {
      const ed = monacoEditorRef.current;
      if (ed) { ed.focus(); ed.trigger('custom', 'editor.action.clipboardCutAction', null); }
    } else if (contentEditableRef.current) {
      const ce = contentEditableRef.current;
      const sel = window.getSelection();
      if (sel && sel.toString()) {
        copyTextToClipboard(sel.toString());
        ce.focus();
        document.execCommand('delete');
      }
    } else {
      const el = sourceInputRef.current;
      if (el) {
        const s = el.selectionStart ?? 0;
        const e = el.selectionEnd ?? 0;
        const cutText = el.value.substring(s, e);
        copyTextToClipboard(cutText);
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
          || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(el, el.value.substring(0, s) + el.value.substring(e));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.focus();
        el.setSelectionRange(s, s);
      }
    }
    setVisible(false);
  }, [contextTarget]);

  const handleCopy = useCallback(() => {
    if (contextTarget === 'monaco') {
      const ed = monacoEditorRef.current;
      if (ed) { ed.focus(); ed.trigger('custom', 'editor.action.clipboardCopyAction', null); }
    } else {
      copyTextToClipboard(selectedText);
    }
    setVisible(false);
  }, [contextTarget, selectedText]);

  const handlePaste = useCallback(async () => {
    if (contextTarget === 'monaco') {
      const ed = monacoEditorRef.current;
      if (ed) {
        ed.focus();
        const text = await navigator.clipboard.readText();
        const selection = ed.getSelection();
        if (selection) {
          ed.executeEdits('paste', [{ range: selection, text, forceMoveMarkers: true }]);
        }
      }
    } else if (contentEditableRef.current) {
      const ce = contentEditableRef.current;
      ce.focus();
      const text = await navigator.clipboard.readText();
      document.execCommand('insertText', false, text);
    } else {
      const el = sourceInputRef.current;
      if (el) {
        const text = await navigator.clipboard.readText();
        const s = el.selectionStart ?? 0;
        const e = el.selectionEnd ?? 0;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
          || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(el, el.value.substring(0, s) + text + el.value.substring(e));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.focus();
        el.setSelectionRange(s + text.length, s + text.length);
      }
    }
    setVisible(false);
  }, [contextTarget]);

  const handleSelectAll = useCallback(() => {
    if (contextTarget === 'monaco') {
      const ed = monacoEditorRef.current;
      if (ed) {
        ed.focus();
        const model = ed.getModel();
        if (model) {
          ed.setSelection(model.getFullModelRange());
        }
      }
    } else if (contentEditableRef.current) {
      const ce = contentEditableRef.current;
      ce.focus();
      const range = document.createRange();
      range.selectNodeContents(ce);
      const sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
    } else {
      const el = sourceInputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(0, el.value.length);
      }
    }
    setVisible(false);
  }, [contextTarget]);

  const handleFormat = useCallback(() => {
    const ed = monacoEditorRef.current;
    if (ed) {
      ed.focus();
      ed.trigger('custom', 'editor.action.formatDocument', null);
    }
    setVisible(false);
  }, []);

  const handleSetEnvVariable = useCallback(() => {
    if (selectedText) {
      window.dispatchEvent(new CustomEvent('set-env-variable', { detail: { value: selectedText } }));
    }
    setVisible(false);
  }, [selectedText]);

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

  // ── 插件右键菜单项点击 ──
  const handlePluginMenuAction = useCallback(async (pluginId: string, action: string) => {
    setVisible(false);
    try {
      const contextType = contextTarget === 'monaco' ? 'editor' : contextTarget;
      const result = await runContextMenuAction(pluginId, action, selectedText, JSON.stringify({ context: contextType }));
      if (result.error) {
        setResultDialog({ output: `[Error] ${result.error}`, algorithmName: action });
        return;
      }
      if (result.replaceSelection && result.output != null) {
        const ed = monacoEditorRef.current;
        const sel = monacoSelectionRef.current;
        if (ed && sel) {
          ed.focus();
          ed.executeEdits('plugin-action', [{ range: sel, text: result.output, forceMoveMarkers: true }]);
        } else {
          replaceSelectedText(result.output, sourceInputRef.current);
        }
      } else if (result.output) {
        setResultDialog({ output: result.output, algorithmName: action });
      }
    } catch (err: any) {
      setResultDialog({ output: `[Error] ${err?.message || err}`, algorithmName: action });
    }
  }, [contextTarget, selectedText]);

  const hasEncrypt = algorithms.some((a) => a.algorithm.supportEncrypt);
  const hasDecrypt = algorithms.some((a) => a.algorithm.supportDecrypt);
  const showClipboard = contextTarget === 'monaco' || contextTarget === 'input';

  // 过滤适用于当前 context 的插件菜单项
  const contextKey = contextTarget === 'monaco' ? 'editor' : contextTarget;
  const filteredPluginItems = pluginMenuItems.filter(({ item }) => {
    if (item.requiresSelection && !selectedText) return false;
    return item.contexts.includes(contextKey) || item.contexts.includes('global');
  });

  if (!visible && !pendingAction && !resultDialog && !exportDialog && !parserDialogData) {
    return <SetEnvVariableDialog />;
  }

  return (
    <>
      {visible && createPortal(
        <div
          ref={menuRef}
          data-contextmenu-zone="global-context-menu"
          className="fixed z-[var(--z-toast)] min-w-[200px] rounded-xl border border-border-default bg-bg-surface/95 shadow-xl backdrop-blur-xl py-1"
          style={{ left: position.x, top: position.y, fontSize: 'var(--fs-sm)' }}
        >
          {/* 剪贴板操作 — Monaco 和 input/textarea */}
          {showClipboard && (
            <>
              <MenuItem label={t('contextMenu.cut', '剪切')} shortcut="⌘X" onClick={handleCut} disabled={!selectedText} />
              <MenuItem label={t('contextMenu.copy', '复制')} shortcut="⌘C" onClick={handleCopy} disabled={!selectedText} />
              <MenuItem label={t('contextMenu.paste', '粘贴')} shortcut="⌘V" onClick={handlePaste} />
              <MenuItem label={t('contextMenu.selectAll', '全选')} shortcut="⌘A" onClick={handleSelectAll} />
              <Divider />
            </>
          )}

          {/* Monaco 专属操作 */}
          {contextTarget === 'monaco' && (
            <>
              <MenuItem label={t('contextMenu.formatDocument', '格式化文档')} shortcut="⇧⌥F" onClick={handleFormat} />
              <Divider />
            </>
          )}

          {/* 设为环境变量 */}
          {selectedText && (
            <>
              <MenuItem label={t('contextMenu.setAsEnvVariable', '设为环境变量')} onClick={handleSetEnvVariable} />
            </>
          )}

          {/* 协议解析 — 有选中文本且有解析器插件时显示 */}
          {selectedText && hasParserPlugins && (
            <MenuItem
              label={t('contextMenu.protocolParse', '协议解析')}
              onClick={() => {
                setVisible(false);
                window.dispatchEvent(new CustomEvent('open-protocol-parser', { detail: { data: selectedText } }));
              }}
            />
          )}

          {/* 导出数组 — 直接列所有格式 */}
          {contextTarget === 'monaco' && hasResponseArrays && (
            <HoverSubmenu
              label={`${t('contextMenu.exportArray', '导出数组')} (${bestArrayPathRef.current === '(root)' ? '根' : bestArrayPathRef.current})`}
              hoverKey="export-array"
              hoveredSub={hoveredSub}
              onHover={setHoveredSub}
            >
              {EXPORT_FORMATS.map((fmt) => (
                <button
                  key={fmt.id}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-bg-hover transition-colors"
                  onClick={() => handleExportFormat(fmt)}
                >
                  <span>{fmt.name}</span>
                  <span className="ml-auto pf-text-xxs text-text-disabled">{fmt.extension}</span>
                </button>
              ))}
            </HoverSubmenu>
          )}

          {selectedText && <Divider />}

          {/* 🪄 Mock 数据生成 — 仅在有插入目标时显示（Monaco / input） */}
          {generators.length > 0 && (contextTarget === 'monaco' || contextTarget === 'input') && (
            <HoverSubmenu
              label={t('contextMenu.mockData', 'Mock 数据')}
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

          {/* 加密 / 编码 */}
          {hasEncrypt && selectedText && (
            <HoverSubmenu
              label={t('contextMenu.encrypt', '加密 / 编码')}
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

          {/* 解密 / 解码 */}
          {hasDecrypt && selectedText && (
            <HoverSubmenu
              label={t('contextMenu.decrypt', '解密 / 解码')}
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

          {/* 插件贡献的菜单项 */}
          {filteredPluginItems.length > 0 && (
            <>
              <Divider />
              {filteredPluginItems.map(({ pluginId, item }) => (
                <MenuItem
                  key={`${pluginId}:${item.menuItemId}`}
                  label={item.label}
                  onClick={() => handlePluginMenuAction(pluginId, item.action)}
                />
              ))}
            </>
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

      <SetEnvVariableDialog />

      {/* 导出选项对话框（SQL 表名+字段选择、InfluxDB 参数） */}
      {exportDialog && createPortal(
        <ExportOptionsDialog
          fmt={exportDialog.fmt}
          body={exportDialog.body}
          path={exportDialog.path}
          onExport={(opts) => {
            const { fmt, body, path } = exportDialog;
            setExportDialog(null);
            doExportToFile(body, path, fmt, opts).catch(console.warn);
          }}
          onClose={() => setExportDialog(null)}
        />,
        document.body,
      )}

      {/* 协议解析对话框 */}
      {parserDialogData && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40" data-contextmenu-zone="parser-dialog" onClick={() => setParserDialogData(null)}>
          <div
            className="relative w-[640px] max-h-[80vh] flex flex-col pf-rounded-lg border border-border-default bg-bg-primary shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-default/60">
              <span className="pf-text-sm font-semibold text-text-primary">{t('contextMenu.protocolParse', '协议解析')}</span>
              <button onClick={() => setParserDialogData(null)} className="p-1 rounded hover:bg-bg-hover text-text-tertiary">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-auto">
              <ProtocolParserPanel initialData={parserDialogData} compact />
            </div>
          </div>
        </div>,
        document.body,
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
  const triggerRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const [subStyle, setSubStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    if (hoveredSub !== hoverKey || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const subW = 220; // min-width estimate
    const subH = subRef.current?.scrollHeight || 300;

    // 水平方向：优先右侧，空间不够则左侧
    const goLeft = rect.right + subW + 8 > window.innerWidth;
    // 垂直方向：如果底部溢出则上移
    let top = 0;
    if (rect.top + subH > window.innerHeight - 8) {
      top = Math.max(-(subH - rect.height), -(rect.top - 8));
    }

    setSubStyle({
      ...(goLeft ? { right: '100%', marginRight: 4 } : { left: '100%', marginLeft: 4 }),
      top,
      maxHeight: window.innerHeight - 16,
      overflowY: 'auto' as const,
    });
  }, [hoveredSub, hoverKey]);

  return (
    <div
      ref={triggerRef}
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
          ref={subRef}
          className="absolute z-[var(--z-toast)] min-w-[180px] rounded-xl border border-border-default bg-bg-surface/95 shadow-xl backdrop-blur-xl py-1"
          style={{ fontSize: 'var(--fs-sm)', ...subStyle }}
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

/* ── 导出选项对话框（SQL 表名+字段选择 / InfluxDB 参数） ── */

function ExportOptionsDialog({
  fmt,
  body,
  path,
  onExport,
  onClose,
}: {
  fmt: FormatDef;
  body: string;
  path: string;
  onExport: (opts: Record<string, string>) => void;
  onClose: () => void;
}) {
  const isInflux = fmt.id === 'influxdb';
  const [tableName, setTableName] = useState('table_name');
  const [measurement, setMeasurement] = useState('data');
  const [tagKeys, setTagKeys] = useState('');
  const [columns, setColumns] = useState<string[]>([]);
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set());
  const [aliases, setAliases] = useState<Record<string, string>>({});
  // 列名从前几行采样，微秒级完成
  useEffect(() => {
    if (isInflux) return;
    try {
      const arr = getByPath(JSON.parse(body), path);
      const cols = Array.isArray(arr) ? collectColumnsFromArray(arr) : [];
      setColumns(cols);
      setSelectedCols(new Set(cols));
    } catch { /* ignore */ }
  }, [body, path, isInflux]);

  const handleExport = () => {
    if (isInflux) {
      onExport({ measurement, tagKeys });
    } else {
      const opts: Record<string, string> = { tableName };
      if (selectedCols.size < columns.length) {
        opts.selectedColumns = [...selectedCols].join(',');
      }
      const usedAliases = Object.fromEntries(
        Object.entries(aliases).filter(([k, v]) => v && selectedCols.has(k))
      );
      if (Object.keys(usedAliases).length > 0) {
        opts.columnAliases = JSON.stringify(usedAliases);
      }
      onExport(opts);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40" data-contextmenu-zone="export-dialog" onClick={onClose}>
      <div className="w-[480px] max-h-[70vh] flex flex-col pf-rounded-lg border border-border-default bg-bg-primary shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default/60">
          <span className="pf-text-sm font-semibold text-text-primary">{fmt.name}</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-bg-hover text-text-tertiary">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-4 space-y-3">
          {isInflux ? (
            <>
              <div>
                <label className="block pf-text-xs font-medium text-text-secondary mb-1">Measurement</label>
                <input value={measurement} onChange={(e) => setMeasurement(e.target.value)}
                  className="w-full px-2 py-1.5 pf-rounded-sm border border-border-default bg-bg-secondary pf-text-xs" />
              </div>
              <div>
                <label className="block pf-text-xs font-medium text-text-secondary mb-1">Tag Keys (逗号分隔)</label>
                <input value={tagKeys} onChange={(e) => setTagKeys(e.target.value)}
                  className="w-full px-2 py-1.5 pf-rounded-sm border border-border-default bg-bg-secondary pf-text-xs" placeholder="device_id,city" />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block pf-text-xs font-medium text-text-secondary mb-1">表名</label>
                <input value={tableName} onChange={(e) => setTableName(e.target.value)}
                  className="w-full px-2 py-1.5 pf-rounded-sm border border-border-default bg-bg-secondary pf-text-xs" />
              </div>
              {columns.length > 0 && (
                <div>
                  <label className="block pf-text-xs font-medium text-text-secondary mb-1">
                    字段选择 ({selectedCols.size}/{columns.length})
                    <button className="ml-2 text-accent pf-text-xxs hover:underline"
                      onClick={() => setSelectedCols(selectedCols.size === columns.length ? new Set() : new Set(columns))}>
                      {selectedCols.size === columns.length ? '取消全选' : '全选'}
                    </button>
                  </label>
                  <div className="max-h-[200px] overflow-auto border border-border-default/60 pf-rounded-sm">
                    {columns.map((col) => (
                      <div key={col} className="flex items-center gap-2 px-2 py-1 hover:bg-bg-hover/50 border-b border-border-default/30 last:border-0">
                        <input type="checkbox" checked={selectedCols.has(col)}
                          onChange={() => setSelectedCols((prev) => { const n = new Set(prev); if (n.has(col)) n.delete(col); else n.add(col); return n; })}
                          className="rounded border-border-default shrink-0" />
                        <span className="pf-text-xs font-mono text-text-primary min-w-[100px]">{col}</span>
                        <span className="pf-text-xxs text-text-disabled mx-1">→</span>
                        <input
                          value={aliases[col] || ''}
                          onChange={(e) => setAliases((p) => ({ ...p, [col]: e.target.value }))}
                          placeholder={col}
                          className="flex-1 px-1.5 py-0.5 pf-rounded-sm border border-border-default/40 bg-transparent pf-text-xs text-text-secondary placeholder:text-text-disabled/50"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border-default/60">
          <button onClick={onClose} className="px-3 py-1.5 pf-rounded-sm pf-text-xs text-text-secondary hover:bg-bg-hover">取消</button>
          <button onClick={handleExport} disabled={!isInflux && selectedCols.size === 0}
            className="px-3 py-1.5 pf-rounded-sm pf-text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50">
            导出
          </button>
        </div>
      </div>
    </div>
  );
}
