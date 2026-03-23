/**
 * CryptoContextMenu — 全局右键加密/解密菜单
 * 
 * 特点：
 * 1. 挂载在应用根组件，监听整个页面的 contextmenu 事件
 * 2. 当有文本选中 + 有 crypto 插件安装时才出现
 * 3. 按算法类别分组显示（编码/哈希/对称加密/非对称加密）
 * 4. 无参数算法直接执行，有参数算法弹出 CryptoParamsDialog
 * 5. 加密结果替换选中文本，解密结果弹框展示
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Lock, Unlock, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { runCrypto, listCryptoAlgorithms } from '@/services/pluginService';
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
  /** 用于加密替换的元素和选区范围 */
  targetElement: Element | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  encode: '编码',
  hash: '哈希',
  symmetric: '对称加密',
  asymmetric: '非对称加密',
};

const CATEGORY_ORDER = ['encode', 'hash', 'symmetric', 'asymmetric'];

export function CryptoContextMenu() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<MenuPosition>({ x: 0, y: 0 });
  const [algorithms, setAlgorithms] = useState<InstalledCryptoAlgorithm[]>([]);
  const [selectedText, setSelectedText] = useState('');
  const [expandedSub, setExpandedSub] = useState<'encrypt' | 'decrypt' | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [resultDialog, setResultDialog] = useState<{ output: string; algorithmName: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const targetElementRef = useRef<Element | null>(null);

  // 加载已安装的加密算法
  const refreshAlgorithms = useCallback(async () => {
    try {
      const algos = await listCryptoAlgorithms();
      setAlgorithms(algos);
    } catch {
      setAlgorithms([]);
    }
  }, []);

  useEffect(() => {
    refreshAlgorithms();
  }, [refreshAlgorithms]);

  // 监听 contextmenu 事件
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const selection = window.getSelection();
      const text = selection?.toString().trim() || '';

      // 没有选中文本或没有 crypto 算法 → 不拦截原生右键菜单
      if (!text || algorithms.length === 0) return;

      // 如果在 Monaco editor 中，不拦截（Monaco 有自己的 context menu）
      const target = e.target as Element;
      if (target.closest('.monaco-editor')) return;

      e.preventDefault();
      setSelectedText(text);
      targetElementRef.current = target;

      // 计算菜单位置（确保不超出视口）
      const x = Math.min(e.clientX, window.innerWidth - 280);
      const y = Math.min(e.clientY, window.innerHeight - 300);
      setPosition({ x, y });
      setVisible(true);
      setExpandedSub(null);
    };

    document.addEventListener('contextmenu', handler);
    return () => document.removeEventListener('contextmenu', handler);
  }, [algorithms]);

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
  ) => {
    setLoading(true);
    try {
      const result = await runCrypto(pluginId, algorithm.algorithmId, mode, input, paramsJson);
      if (!result.success) {
        setResultDialog({ output: `❌ ${result.error || '未知错误'}`, algorithmName: algorithm.name });
        return;
      }

      if (mode === 'encrypt') {
        // 加密：尝试替换选中文本
        replaceSelectedText(result.output);
      } else {
        // 解密：展示结果
        setResultDialog({ output: result.output, algorithmName: algorithm.name });
      }
    } catch (err: any) {
      setResultDialog({ output: `❌ ${err?.message || err}`, algorithmName: algorithm.name });
    } finally {
      setLoading(false);
      setVisible(false);
    }
  }, []);

  // 点击算法
  const handleAlgorithmClick = useCallback((
    pluginId: string,
    algorithm: CryptoAlgorithm,
    mode: 'encrypt' | 'decrypt',
  ) => {
    const hasParams = algorithm.params && algorithm.params.length > 0;

    if (hasParams) {
      // 需要参数 → 弹框
      setPendingAction({
        pluginId,
        algorithm,
        mode,
        selectedText,
        targetElement: targetElementRef.current,
      });
      setVisible(false);
    } else {
      // 无参数 → 直接执行
      executeCrypto(pluginId, algorithm, mode, selectedText);
    }
  }, [selectedText, executeCrypto]);

  // 参数弹框确认
  const handleParamsConfirm = useCallback((paramsJson: string) => {
    if (!pendingAction) return;
    executeCrypto(
      pendingAction.pluginId,
      pendingAction.algorithm,
      pendingAction.mode,
      pendingAction.selectedText,
      paramsJson,
    );
    setPendingAction(null);
  }, [pendingAction, executeCrypto]);

  if (!visible && !pendingAction && !resultDialog) return null;

  return (
    <>
      {/* 右键菜单 */}
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

        // 根据 mode 过滤
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

/** 替换当前页面中选中的文本 */
function replaceSelectedText(replacement: string) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;

  const range = sel.getRangeAt(0);
  const ancestor = range.commonAncestorContainer;

  // 如果选区在 input/textarea 中
  const inputEl = (ancestor instanceof Element ? ancestor : ancestor.parentElement)?.closest('input, textarea') as HTMLInputElement | HTMLTextAreaElement | null;
  if (inputEl && inputEl.selectionStart !== null && inputEl.selectionEnd !== null) {
    const start = inputEl.selectionStart;
    const end = inputEl.selectionEnd;
    const val = inputEl.value;
    // 触发 React onChange
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set || Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;
    nativeInputValueSetter?.call(inputEl, val.substring(0, start) + replacement + val.substring(end));
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.setSelectionRange(start, start + replacement.length);
    return;
  }

  // contentEditable / 普通文本节点 — 使用 Range API
  range.deleteContents();
  range.insertNode(document.createTextNode(replacement));
  sel.removeAllRanges();
}
