import { useEffect } from "react";
import { useAppStore } from "@/stores/appStore";

/**
 * Global keyboard shortcuts for ProtoForge desktop app.
 * Must be mounted once at the App level.
 */
export function useKeyboardShortcuts() {
  const addTab = useAppStore((s) => s.addTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const closeCollectionPanel = useAppStore((s) => s.closeCollectionPanel);
  const nextTab = useAppStore((s) => s.nextTab);
  const prevTab = useAppStore((s) => s.prevTab);
  const getActiveTab = useAppStore((s) => s.getActiveTab);
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

      // Ctrl+W — Close current tab
      if (ctrl && !shift && e.key === "w") {
        e.preventDefault();
        const active = getActiveTab();
        if (active) {
          closeTab(active.id);
        } else if (activeCollectionId) {
          closeCollectionPanel();
        }
        return;
      }

      // Ctrl+Tab — Next tab
      if (ctrl && !shift && e.key === "Tab") {
        e.preventDefault();
        nextTab();
        return;
      }

      // Ctrl+Shift+Tab — Previous tab
      if (ctrl && shift && e.key === "Tab") {
        e.preventDefault();
        prevTab();
        return;
      }

      // Ctrl+L — Focus URL input
      if (ctrl && !shift && e.key === "l") {
        e.preventDefault();
        const urlInput = document.querySelector<HTMLInputElement>("[data-url-input]");
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
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeCollectionId, addTab, closeCollectionPanel, closeTab, nextTab, prevTab, getActiveTab]);
}
