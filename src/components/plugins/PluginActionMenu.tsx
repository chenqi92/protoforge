/**
 * PluginActionMenu — 统一的插件操作浮动菜单
 *
 * 当 Monaco 编辑器中的「🪄 Mock 数据」或「🔐 加密/解密」菜单项被点击时，
 * 通过 CustomEvent 触发此组件显示对应的二级子菜单。
 *
 * 事件协议：
 *   'plugin-action-menu' → { type: 'mock' | 'crypto', editorId: string }
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

import { usePluginStore } from '@/stores/pluginStore';
import * as pluginService from '@/services/pluginService';
import type { CryptoAlgorithm } from '@/types/plugin';

/* ── 常量 ─────────────────────────────────────────────── */

const CRYPTO_CATEGORY_LABELS: Record<string, string> = {
  encode: '编码',
  hash: '哈希',
  symmetric: '对称加密',
  asymmetric: '非对称加密',
};
const CRYPTO_CATEGORY_ORDER = ['encode', 'hash', 'symmetric', 'asymmetric'];

/* ── 类型 ─────────────────────────────────────────────── */

interface MenuState {
  type: 'mock' | 'crypto';
  editorId: string;
  /** 当前鼠标光标在屏幕上的位置 */
  x: number;
  y: number;
}

interface CryptoSubState {
  mode: 'encrypt' | 'decrypt';
}

/* ── 组件 ─────────────────────────────────────────────── */

export function PluginActionMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [cryptoSub, setCryptoSub] = useState<CryptoSubState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const installedPlugins = usePluginStore((s) => s.installedPlugins);

  /* 监听 Monaco 派发的 plugin-action-menu 事件 */
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d) return;
      setMenu({ type: d.type, editorId: d.editorId, x: d.x ?? 0, y: d.y ?? 0 });
      setCryptoSub(null);
    };
    window.addEventListener('plugin-action-menu', handler);
    return () => window.removeEventListener('plugin-action-menu', handler);
  }, []);

  /* 点击外部 / ESC 关闭 */
  useEffect(() => {
    if (!menu) return;
    const close = () => { setMenu(null); setCryptoSub(null); };
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('mousedown', onMouseDown); document.removeEventListener('keydown', onKeyDown); };
  }, [menu]);

  /* 获取 Monaco editor 实例并在选区执行操作 */
  const getEditorAndSelection = useCallback(() => {
    if (!menu) return null;
    // 通过 monaco 全局查找 editor
    const monacoEditors = (window as any).monaco?.editor?.getEditors() as any[] | undefined;
    const ed = monacoEditors?.find((e: any) => e.getId() === menu.editorId);
    if (!ed) return null;
    const selection = ed.getSelection();
    const selectedText = ed.getModel()?.getValueInRange(selection) || '';
    return { editor: ed, selection, selectedText };
  }, [menu]);

  if (!menu) return null;

  // ── Mock 数据菜单 ──
  if (menu.type === 'mock') {
    const genPlugins = installedPlugins.filter((p) => p.pluginType === 'data-generator');
    const gens: { pluginId: string; id: string; name: string }[] = [];
    for (const p of genPlugins) {
      for (const g of (p.contributes?.generators || [])) {
        gens.push({ pluginId: p.id, id: g.generatorId, name: g.name });
      }
    }

    return createPortal(
      <div
        ref={menuRef}
        className="fixed z-[9999] min-w-[180px] rounded-xl border border-border-default bg-bg-surface/95 shadow-xl backdrop-blur-xl py-1"
        style={{ left: menu.x, top: menu.y, fontSize: 'var(--fs-sm)' }}
      >
        <div className="px-3 py-1.5 text-text-disabled font-medium tracking-wide" style={{ fontSize: 'var(--fs-xxs)' }}>
          Mock 数据
        </div>
        {gens.map((g) => (
          <button
            key={`${g.pluginId}:${g.id}`}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-bg-hover transition-colors"
            onClick={async () => {
              const ctx = getEditorAndSelection();
              if (!ctx) return;
              try {
                const result = await pluginService.runGenerator(g.pluginId, g.id, '{}');
                if (!result.error && result.data && ctx.selection) {
                  ctx.editor.executeEdits('mock-gen', [{
                    range: ctx.selection,
                    text: result.data,
                    forceMoveMarkers: true,
                  }]);
                }
              } catch {}
              setMenu(null);
            }}
          >
            <span className="text-base">🪄</span>
            <span>{g.name}</span>
          </button>
        ))}
        {gens.length === 0 && (
          <div className="px-3 py-2 text-text-disabled" style={{ fontSize: 'var(--fs-xs)' }}>
            未安装 Mock 数据插件
          </div>
        )}
      </div>,
      document.body,
    );
  }

  // ── 加密/解密菜单 ──
  const cryptoPlugins = installedPlugins.filter((p) => p.pluginType === 'crypto-tool');
  type AlgoItem = { pluginId: string; algo: CryptoAlgorithm };
  const allAlgos: AlgoItem[] = [];
  for (const cp of cryptoPlugins) {
    for (const a of (cp.contributes?.cryptoAlgorithms || [])) {
      allAlgos.push({ pluginId: cp.id, algo: a });
    }
  }

  // 按 category 分组
  const grouped: Record<string, AlgoItem[]> = {};
  for (const item of allAlgos) {
    const cat = item.algo.category || 'encode';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
  }

  const handleCryptoClick = async (item: AlgoItem, mode: 'encrypt' | 'decrypt') => {
    const ctx = getEditorAndSelection();
    if (!ctx || !ctx.selectedText) { setMenu(null); return; }

    const hasParams = item.algo.params && item.algo.params.length > 0;
    if (hasParams) {
      window.dispatchEvent(new CustomEvent('crypto-action', {
        detail: {
          pluginId: item.pluginId,
          algorithm: item.algo,
          mode,
          selectedText: ctx.selectedText,
          editorId: menu.editorId,
        },
      }));
      setMenu(null);
      return;
    }

    try {
      const result = await pluginService.runCrypto(item.pluginId, item.algo.algorithmId, mode, ctx.selectedText, '{}');
      if (result.success) {
        if (mode === 'encrypt' && ctx.selection) {
          ctx.editor.executeEdits('crypto', [{
            range: ctx.selection,
            text: result.output,
            forceMoveMarkers: true,
          }]);
        } else {
          window.dispatchEvent(new CustomEvent('crypto-result', {
            detail: { output: result.output, algorithmName: item.algo.name },
          }));
        }
      } else {
        window.dispatchEvent(new CustomEvent('crypto-result', {
          detail: { output: `❌ ${result.error || '未知错误'}`, algorithmName: item.algo.name },
        }));
      }
    } catch (e: any) {
      window.dispatchEvent(new CustomEvent('crypto-result', {
        detail: { output: `❌ ${e?.message || e}`, algorithmName: item.algo.name },
      }));
    }
    setMenu(null);
  };

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[200px] rounded-xl border border-border-default bg-bg-surface/95 shadow-xl backdrop-blur-xl py-1"
      style={{ left: menu.x, top: menu.y, fontSize: 'var(--fs-sm)' }}
    >
      {/* 加密 / 编码 */}
      <div
        className="relative"
        onMouseEnter={() => setCryptoSub({ mode: 'encrypt' })}
        onMouseLeave={() => setCryptoSub(null)}
      >
        <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-text-primary hover:bg-bg-hover transition-colors">
          <span className="text-base">🔐</span>
          <span className="flex-1">加密 / 编码</span>
          <span className="text-text-tertiary text-xs">▸</span>
        </button>
        {cryptoSub?.mode === 'encrypt' && (
          <CryptoSubMenu
            grouped={grouped}
            mode="encrypt"
            onClick={handleCryptoClick}
          />
        )}
      </div>

      <div className="mx-2 border-t border-border-default/50" />

      {/* 解密 / 解码 */}
      <div
        className="relative"
        onMouseEnter={() => setCryptoSub({ mode: 'decrypt' })}
        onMouseLeave={() => setCryptoSub(null)}
      >
        <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-text-primary hover:bg-bg-hover transition-colors">
          <span className="text-base">🔓</span>
          <span className="flex-1">解密 / 解码</span>
          <span className="text-text-tertiary text-xs">▸</span>
        </button>
        {cryptoSub?.mode === 'decrypt' && (
          <CryptoSubMenu
            grouped={grouped}
            mode="decrypt"
            onClick={handleCryptoClick}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ── 加密/解密子菜单 ─────────────────────────────────── */

function CryptoSubMenu({
  grouped,
  mode,
  onClick,
}: {
  grouped: Record<string, { pluginId: string; algo: CryptoAlgorithm }[]>;
  mode: 'encrypt' | 'decrypt';
  onClick: (item: { pluginId: string; algo: CryptoAlgorithm }, mode: 'encrypt' | 'decrypt') => void;
}) {
  return (
    <div
      className="absolute left-full top-0 z-[10000] ml-1 min-w-[180px] rounded-xl border border-border-default bg-bg-surface/95 shadow-xl backdrop-blur-xl py-1"
      style={{ fontSize: 'var(--fs-sm)' }}
    >
      {CRYPTO_CATEGORY_ORDER.map((cat) => {
        const items = grouped[cat];
        if (!items?.length) return null;
        const filtered = items.filter((i) =>
          mode === 'encrypt' ? i.algo.supportEncrypt : i.algo.supportDecrypt,
        );
        if (!filtered.length) return null;

        return (
          <div key={cat}>
            <div className="px-3 py-1 text-text-disabled font-medium tracking-wide" style={{ fontSize: 'var(--fs-xxs)' }}>
              {CRYPTO_CATEGORY_LABELS[cat] || cat}
            </div>
            {filtered.map((item) => (
              <button
                key={`${item.pluginId}:${item.algo.algorithmId}`}
                onClick={() => onClick(item, mode)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-bg-hover transition-colors"
              >
                <span>{item.algo.name}</span>
                {item.algo.params && item.algo.params.length > 0 && (
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
