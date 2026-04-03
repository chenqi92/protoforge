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
