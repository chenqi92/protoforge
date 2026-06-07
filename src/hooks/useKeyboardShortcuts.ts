import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/stores/appStore";

/**
 * Cycles the universal tab strip (request tabs + tool sessions) by `delta`.
 * Reuses the existing nav actions so the dual model stays intact.
 */
function cycleUnifiedTab(delta: 1 | -1): void {
  const store = useAppStore.getState();
  const tabs = store.getUnifiedTabs();
  if (tabs.length <= 1) {
    // Single context — fall back to request-only cycling (no-op if 0/1 tabs).
    if (delta === 1) store.nextTab();
    else store.prevTab();
    return;
  }
  const activeId = store.getActiveUnifiedTabId();
  const currentIndex = tabs.findIndex((t) => t.id === activeId);
  const baseIndex = currentIndex === -1 ? 0 : currentIndex;
  const nextIndex = (baseIndex + delta + tabs.length) % tabs.length;
  const next = tabs[nextIndex];
  if (next.kind === "request" && next.tabId) {
    store.setActiveTab(next.tabId);
  } else if (next.kind === "tool" && next.tool && next.sessionId) {
    store.setActiveToolSession(next.tool, next.sessionId);
  }
}

/**
 * Global keyboard shortcuts for ProtoForge desktop app.
 * Must be mounted once at the App level.
 */
export function useKeyboardShortcuts() {
  const addTab = useAppStore((s) => s.addTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const closeCollectionPanel = useAppStore((s) => s.closeCollectionPanel);
  const activeCollectionId = useAppStore((s) => s.activeCollectionId);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      // Ctrl+N — New tab
      if (ctrl && !shift && e.key === "n") {
        e.preventDefault();
        addTab("http");
        return;
      }

      // Ctrl+W — Close current context (request tab OR tool session)
      if (ctrl && !shift && e.key === "w") {
        e.preventDefault();
        const store = useAppStore.getState();
        const workbench = store.activeWorkbench;
        if (workbench === "requests") {
          const active = store.getActiveTab();
          if (active) {
            closeTab(active.id);
          } else if (activeCollectionId) {
            closeCollectionPanel();
          }
        } else if (workbench !== "home") {
          const sessionId = store.activeToolSessionIds[workbench];
          if (sessionId) store.closeToolSession(workbench, sessionId);
        }
        return;
      }

      // Ctrl+Tab — Next tab (unified strip)
      if (ctrl && !shift && e.key === "Tab") {
        e.preventDefault();
        cycleUnifiedTab(1);
        return;
      }

      // Ctrl+Shift+Tab — Previous tab (unified strip)
      if (ctrl && shift && e.key === "Tab") {
        e.preventDefault();
        cycleUnifiedTab(-1);
        return;
      }

      // Ctrl+\ — Toggle split view
      if (ctrl && !shift && e.key === "\\") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("toggle-split-view"));
        return;
      }

      // Ctrl+B — Toggle sidebar
      if (ctrl && !shift && e.key === "b") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("toggle-sidebar"));
        return;
      }

      // Ctrl+L — Focus URL input
      if (ctrl && !shift && e.key === "l") {
        e.preventDefault();
        const urlInput = document.querySelector<HTMLElement>("[data-url-input]");
        if (urlInput) urlInput.focus();
        return;
      }

      // Ctrl+Enter — Send request (only if not in multiline textarea)
      if (ctrl && e.key === "Enter" && !isInput) {
        e.preventDefault();
        const sendBtn = document.querySelector<HTMLButtonElement>("[data-send-button]");
        if (sendBtn && !sendBtn.disabled) sendBtn.click();
        return;
      }

      // Ctrl+S — Save request
      if (ctrl && !shift && e.key === "s") {
        e.preventDefault();
        const saveBtn = document.querySelector<HTMLButtonElement>("[data-save-button]");
        if (saveBtn) saveBtn.click();
        return;
      }

      // Ctrl+K — Command palette
      if (ctrl && !shift && e.key === "k") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('toggle-command-palette'));
        return;
      }

      // Ctrl+, — Settings
      if (ctrl && !shift && e.key === ",") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("open-settings-modal"));
        return;
      }

      // Ctrl+Shift+I / F12 — Toggle DevTools
      if ((ctrl && shift && e.key === "I") || e.key === "F12") {
        e.preventDefault();
        invoke("toggle_devtools").catch(() => {});
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeCollectionId, addTab, closeCollectionPanel, closeTab]);
}
