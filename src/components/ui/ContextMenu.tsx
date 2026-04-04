import { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export interface ContextMenuDivider {
  type: "divider";
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuDivider;

function isDivider(entry: ContextMenuEntry): entry is ContextMenuDivider {
  return "type" in entry && entry.type === "divider";
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Adjust position to stay within viewport
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      setPos({
        x: x + rect.width > vw ? vw - rect.width - 4 : x,
        y: y + rect.height > vh ? vh - rect.height - 4 : y,
      });
    }
  }, [x, y]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[500]"
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      {/* Menu */}
      <div
        ref={menuRef}
        className="fixed z-[501] min-w-[180px] bg-bg-elevated border border-border-default rounded-lg shadow-lg py-1 select-none animate-in fade-in zoom-in-95 duration-100"
        style={{ left: pos.x, top: pos.y }}
      >
        {items.map((entry, i) => {
          if (isDivider(entry)) {
            return <div key={`d-${i}`} className="h-[1px] bg-border-default my-1 mx-2" />;
          }
          return (
            <button
              key={entry.id}
              disabled={entry.disabled}
              onClick={() => { entry.onClick(); onClose(); }}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-[6px] pf-text-sm transition-colors",
                entry.disabled
                  ? "text-text-disabled cursor-not-allowed"
                  : entry.danger
                    ? "text-red-500 hover:bg-red-500/8"
                    : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
              )}
            >
              {entry.icon && <span className="w-4 h-4 flex items-center justify-center shrink-0 opacity-60">{entry.icon}</span>}
              <span className="flex-1 text-left">{entry.label}</span>
              {entry.shortcut && (
                <span className="pf-text-xxs text-text-disabled font-mono ml-4 shrink-0">{entry.shortcut}</span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}

/**
 * Build clipboard context menu items (Cut/Copy/Paste/SelectAll) for a given right-click event.
 * Returns items + divider if the target is an input/textarea, otherwise empty array.
 */
export function buildClipboardItems(
  e: React.MouseEvent,
  t: (key: string, fallback?: string) => string,
): ContextMenuEntry[] {
  const target = e.target as Element;
  const el =
    target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
      ? (target as HTMLInputElement | HTMLTextAreaElement)
      : (target.closest('input, textarea') as HTMLInputElement | HTMLTextAreaElement | null);
  if (!el) return [];

  const s = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  const hasSelection = s !== end;
  const selectedText = hasSelection ? el.value.substring(s, end) : '';

  const copyToClip = (text: string) => navigator.clipboard.writeText(text).catch(() => {});

  const pasteFromClip = async () => {
    const text = await navigator.clipboard.readText();
    const setter =
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ||
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(el, el.value.substring(0, s) + text + el.value.substring(end));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
    el.setSelectionRange(s + text.length, s + text.length);
  };

  const cutText = () => {
    if (!hasSelection) return;
    copyToClip(selectedText);
    const setter =
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ||
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(el, el.value.substring(0, s) + el.value.substring(end));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
    el.setSelectionRange(s, s);
  };

  return [
    { id: '_cut', label: t('contextMenu.cut', '剪切'), shortcut: '⌘X', disabled: !hasSelection, onClick: cutText },
    { id: '_copy', label: t('contextMenu.copy', '复制'), shortcut: '⌘C', disabled: !hasSelection, onClick: () => copyToClip(selectedText) },
    { id: '_paste', label: t('contextMenu.paste', '粘贴'), shortcut: '⌘V', onClick: () => { pasteFromClip(); } },
    { id: '_selectAll', label: t('contextMenu.selectAll', '全选'), shortcut: '⌘A', onClick: () => { el.focus(); el.setSelectionRange(0, el.value.length); } },
    { type: 'divider' as const },
  ];
}

/** Hook for using context menu in any component */
export function useContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null);

  const showMenu = useCallback((e: React.MouseEvent, items: ContextMenuEntry[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  const MenuComponent = menu ? (
    <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />
  ) : null;

  return { showMenu, closeMenu, MenuComponent };
}

/**
 * Zone 兜底右键处理器 — 挂在 data-contextmenu-zone 容器的 onContextMenu 上。
 * 确保 zone 内任何未被子元素拦截的右键事件都能：
 * 1. 阻止浏览器/系统默认菜单
 * 2. 在 input/textarea 上显示剪贴板操作
 */
export function useZoneFallback(t: (key: string, fallback?: string) => string) {
  const { showMenu, MenuComponent } = useContextMenu();

  const handleZoneFallback = useCallback((e: React.MouseEvent) => {
    // 只处理还没被子元素拦截的事件
    const clipItems = buildClipboardItems(e, t);
    if (clipItems.length > 0) {
      // 有 input/textarea → 显示剪贴板菜单
      showMenu(e, clipItems.slice(0, -1)); // 去掉尾部 divider
    } else {
      // 非 input 区域 → 仅阻止默认菜单
      e.preventDefault();
    }
  }, [showMenu, t]);

  return { handleZoneFallback, ZoneFallbackMenu: MenuComponent };
}
