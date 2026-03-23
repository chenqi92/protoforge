/**
 * CryptoContextMenu — 全局加密/解密事件处理器
 * 
 * 职责：
 * 1. 监听 Monaco 里 crypto actions 派发的 `crypto-action` 事件 → 弹出参数对话框
 * 2. 监听 `crypto-result` 事件 → 弹出结果对话框
 * 3. 在非 Monaco 区域监听 `contextmenu` → 显示加密/解密右键菜单
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Lock, Unlock, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { runCrypto } from '@/services/pluginService';
import { usePluginStore } from '@/stores/pluginStore';
import type { InstalledCryptoAlgorithm, CryptoAlgorithm } from '@/types/plugin';
import { CryptoParamsDialog } from './CryptoParamsDialog';
import { CryptoResultDialog } from './CryptoResultDialog';

interface MenuPosition {
  x: number;
  y: number;
}

interface PendingAction {
  pluginId: string;
  algorithm: CryptoAlgorithm;
  mode: 'encrypt' | 'decrypt';
  selectedText: string;
  /** 原始 input 元素 — 用于加密后回写 */
  sourceInput?: HTMLInputElement | HTMLTextAreaElement;
  /** Monaco editor id — 如果来自 Monaco 则有值 */
  editorId?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  encode: '编码',
  hash: '哈希',
  symmetric: '对称加密',
  asymmetric: '非对称加密',
};

const CATEGORY_ORDER = ['encode', 'hash', 'symmetric', 'asymmetric'];

/**
 * 获取当前页面的选中文本 —— 兼容 input/textarea 和普通文本选区
 */
function getSelectedText(): { text: string; inputEl?: HTMLInputElement | HTMLTextAreaElement } {
  // 1) 先检查 focused input/textarea 的 selection
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
    const inputEl = active as HTMLInputElement | HTMLTextAreaElement;
    const start = inputEl.selectionStart ?? 0;
    const end = inputEl.selectionEnd ?? 0;
    if (start !== end) {
      return { text: inputEl.value.substring(start, end), inputEl };
    }
  }
  // 2) fallback 到 window.getSelection()
  const sel = window.getSelection();
  const text = sel?.toString().trim() || '';
  return { text };
}

export function CryptoContextMenu() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<MenuPosition>({ x: 0, y: 0 });
  const [selectedText, setSelectedText] = useState('');
  const [expandedSub, setExpandedSub] = useState<'encrypt' | 'decrypt' | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [resultDialog, setResultDialog] = useState<{ output: string; algorithmName: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const sourceInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // 从 plugin store 获取已安装的 crypto 插件
  const installedPlugins = usePluginStore((s) => s.installedPlugins);

  // 用 ref 保存算法列表，避免 useEffect 闭包问题
  const algorithmsRef = useRef<InstalledCryptoAlgorithm[]>([]);
  const algorithms: InstalledCryptoAlgorithm[] = [];
  const cryptoPlugins = installedPlugins.filter((p) => p.pluginType === 'crypto-tool');
  for (const cp of cryptoPlugins) {
    for (const algo of (cp.contributes?.cryptoAlgorithms || [])) {
      algorithms.push({ pluginId: cp.id, algorithm: algo });
    }
  }
  algorithmsRef.current = algorithms;

  // 1) 监听 Monaco 派发的 crypto-action (需要参数的算法)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      setPendingAction({
        pluginId: detail.pluginId,
        algorithm: detail.algorithm,
        mode: detail.mode,
        selectedText: detail.selectedText,
        editorId: detail.editorId,
      });
    };
    window.addEventListener('crypto-action', handler);
    return () => window.removeEventListener('crypto-action', handler);
  }, []);

  // 2) 监听 crypto-result (解密或错误结果)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      setResultDialog({ output: detail.output, algorithmName: detail.algorithmName });
    };
    window.addEventListener('crypto-result', handler);
    return () => window.removeEventListener('crypto-result', handler);
  }, []);

  // 3) 非 Monaco 区域右键菜单 —— 使用 ref 避免闭包陈旧
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      // Monaco editor 内 → 让 Monaco 自己的 context menu 处理
      const target = e.target as Element;
      if (target.closest('.monaco-editor')) return;

      // 如果没有算法可用 → 不拦截
      if (algorithmsRef.current.length === 0) return;

      // 获取选中文本（兼容 input/textarea）
      const { text, inputEl } = getSelectedText();
      if (!text) return;

      e.preventDefault();
      setSelectedText(text);
      sourceInputRef.current = inputEl || null;

      // 计算菜单位置
      const x = Math.min(e.clientX, window.innerWidth - 280);
      const y = Math.min(e.clientY, window.innerHeight - 300);
      setPosition({ x, y });
      setVisible(true);
      setExpandedSub(null);
    };

    document.addEventListener('contextmenu', handler);
    return () => document.removeEventListener('contextmenu', handler);
  }, []); // 空依赖 — 通过 ref 读取最新算法列表

  // 关闭菜单
  useEffect(() => {
    if (!visible) return;
    const close = () => {
      setVisible(false);
      setExpandedSub(null);
    };
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        close();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [visible]);

  // 按类别分组
  const grouped = algorithms.reduce<Record<string, InstalledCryptoAlgorithm[]>>((acc, item) => {
    const cat = item.algorithm.category || 'encode';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  // 执行加密/解密
  const executeCrypto = useCallback(async (
    pluginId: string,
    algorithm: CryptoAlgorithm,
    mode: 'encrypt' | 'decrypt',
    input: string,
    paramsJson: string = '{}',
    inputEl?: HTMLInputElement | HTMLTextAreaElement | null,
  ) => {
    setLoading(true);
    try {
      const result = await runCrypto(pluginId, algorithm.algorithmId, mode, input, paramsJson);
      if (!result.success) {
        setResultDialog({ output: `❌ ${result.error || '未知错误'}`, algorithmName: algorithm.name });
        return;
      }

      if (mode === 'encrypt') {
        replaceSelectedText(result.output, inputEl);
      } else {
        setResultDialog({ output: result.output, algorithmName: algorithm.name });
      }
    } catch (err: any) {
      setResultDialog({ output: `❌ ${err?.message || err}`, algorithmName: algorithm.name });
    } finally {
      setLoading(false);
      setVisible(false);
    }
  }, []);

  // 非 Monaco 右键菜单中点击算法
  const handleAlgorithmClick = useCallback((
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
      });
      setVisible(false);
    } else {
      executeCrypto(pluginId, algorithm, mode, selectedText, '{}', sourceInputRef.current);
    }
  }, [selectedText, executeCrypto]);

  // 参数弹框确认
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
        setResultDialog({ output: `❌ ${result.error || '未知错误'}`, algorithmName: pendingAction.algorithm.name });
      } else if (pendingAction.mode === 'encrypt') {
        if (pendingAction.editorId) {
          window.dispatchEvent(new CustomEvent('crypto-replace', {
            detail: { editorId: pendingAction.editorId, text: result.output }
          }));
        } else {
          replaceSelectedText(result.output, pendingAction.sourceInput);
        }
      } else {
        setResultDialog({ output: result.output, algorithmName: pendingAction.algorithm.name });
      }
    } catch (err: any) {
      setResultDialog({ output: `❌ ${err?.message || err}`, algorithmName: pendingAction.algorithm.name });
    } finally {
      setLoading(false);
      setPendingAction(null);
    }
  }, [pendingAction]);

  if (!visible && !pendingAction && !resultDialog) return null;

  return (
    <>
      {/* 非 Monaco 区域的右键菜单 */}
      {visible && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] min-w-[220px] rounded-xl border border-border-default bg-bg-surface/95 shadow-xl backdrop-blur-xl"
          style={{ left: position.x, top: position.y, fontSize: 'var(--fs-sm)' }}
        >
          {/* 加密子菜单 */}
          <div
            className="relative"
            onMouseEnter={() => setExpandedSub('encrypt')}
            onMouseLeave={() => setExpandedSub(null)}
          >
            <button
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-text-primary hover:bg-bg-hover rounded-t-xl transition-colors"
            >
              <Lock className="w-3.5 h-3.5 text-amber-500" />
              <span className="flex-1">{t('crypto.encrypt', '加密 / 编码')}</span>
              <ChevronRight className="w-3.5 h-3.5 text-text-tertiary" />
            </button>
            {expandedSub === 'encrypt' && (
              <SubMenu
                grouped={grouped}
                mode="encrypt"
                onSelect={handleAlgorithmClick}
                loading={loading}
              />
            )}
          </div>

          <div className="mx-2 border-t border-border-default/60" />

          {/* 解密子菜单 */}
          <div
            className="relative"
            onMouseEnter={() => setExpandedSub('decrypt')}
            onMouseLeave={() => setExpandedSub(null)}
          >
            <button
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-text-primary hover:bg-bg-hover rounded-b-xl transition-colors"
            >
              <Unlock className="w-3.5 h-3.5 text-emerald-500" />
              <span className="flex-1">{t('crypto.decrypt', '解密 / 解码')}</span>
              <ChevronRight className="w-3.5 h-3.5 text-text-tertiary" />
            </button>
            {expandedSub === 'decrypt' && (
              <SubMenu
                grouped={grouped}
                mode="decrypt"
                onSelect={handleAlgorithmClick}
                loading={loading}
              />
            )}
          </div>
        </div>,
        document.body,
      )}

      {/* 参数填写弹框 */}
      {pendingAction && (
        <CryptoParamsDialog
          algorithm={pendingAction.algorithm}
          mode={pendingAction.mode}
          onConfirm={handleParamsConfirm}
          onCancel={() => setPendingAction(null)}
        />
      )}

      {/* 结果展示弹框 */}
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

/** 子菜单 */
function SubMenu({
  grouped,
  mode,
  onSelect,
  loading,
}: {
  grouped: Record<string, InstalledCryptoAlgorithm[]>;
  mode: 'encrypt' | 'decrypt';
  onSelect: (pluginId: string, algo: CryptoAlgorithm, mode: 'encrypt' | 'decrypt') => void;
  loading: boolean;
}) {
  return (
    <div
      className="absolute left-full top-0 z-[10000] ml-1 min-w-[200px] rounded-xl border border-border-default bg-bg-surface/95 shadow-xl backdrop-blur-xl py-1"
      style={{ fontSize: 'var(--fs-sm)' }}
    >
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
                onClick={() => onSelect(item.pluginId, item.algorithm, mode)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-bg-hover transition-colors',
                  loading && 'opacity-50 cursor-not-allowed',
                )}
              >
                <span>{item.algorithm.name}</span>
                {item.algorithm.params && item.algorithm.params.length > 0 && (
                  <span className="text-text-disabled" style={{ fontSize: 'var(--fs-xxs)' }}>⚙</span>
                )}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** 替换选中的文本 — 兼容 input/textarea 和普通文本 */
function replaceSelectedText(replacement: string, inputEl?: HTMLInputElement | HTMLTextAreaElement | null) {
  // 优先使用传入的 input 元素
  if (inputEl && inputEl.selectionStart !== null && inputEl.selectionEnd !== null) {
    const start = inputEl.selectionStart;
    const end = inputEl.selectionEnd;
    const val = inputEl.value;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set || Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;
    nativeInputValueSetter?.call(inputEl, val.substring(0, start) + replacement + val.substring(end));
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.focus();
    inputEl.setSelectionRange(start, start + replacement.length);
    return;
  }

  // fallback: window.getSelection
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(replacement));
  sel.removeAllRanges();
}
