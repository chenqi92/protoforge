import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "sonner";
// Note: `./monacoWorkers` is now imported lazily inside Monaco-using components
// (CodeEditor, SqlEditor, RequestDiffModal) to keep Monaco out of the initial bundle.
import { initI18n } from "./i18n"; // i18n 初始化 — 只加载当前语言
import "./styles/fonts.css"; // 本地捆绑字体 — 必须在 index.css 前
import "./index.css";

// 根据 URL query param 决定渲染哪个窗口
const params = new URLSearchParams(window.location.search);
const windowType = params.get("window");

async function renderApp() {
  // Initialize i18n and load the active language bundle in parallel with the window module import
  const i18nReady = initI18n();
  let Component: React.ComponentType;

  switch (windowType) {
    case "capture": {
      const { CaptureWindow } = await import("./windows/CaptureWindow");
      Component = CaptureWindow;
      break;
    }
    case "loadtest": {
      const { LoadTestWindow } = await import("./windows/LoadTestWindow");
      Component = LoadTestWindow;
      break;
    }
    case "tcpudp": {
      const { TcpUdpWindow } = await import("./windows/TcpUdpWindow");
      Component = TcpUdpWindow;
      break;
    }
    case "videostream": {
      const { VideoStreamWindow } = await import("./windows/VideoStreamWindow");
      Component = VideoStreamWindow;
      break;
    }
    case "mockserver": {
      const { MockServerWindow } = await import("./windows/MockServerWindow");
      Component = MockServerWindow;
      break;
    }
    case "dbclient": {
      const { DbClientWindow } = await import("./windows/DbClientWindow");
      Component = DbClientWindow;
      break;
    }
    case "toolbox": {
      const { ToolboxWindow } = await import("./windows/ToolboxWindow");
      Component = ToolboxWindow;
      break;
    }
    case "workflow": {
      const { WorkflowWindow } = await import("./windows/WorkflowWindow");
      Component = WorkflowWindow;
      break;
    }
    default: {
      const { default: App } = await import("./App");
      Component = App;
      break;
    }
  }

  // Wait for i18n before first render so translations are available on mount
  await i18nReady;

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <Component />
      <Toaster
        position="bottom-right"
        theme="system"
        richColors
        closeButton
        toastOptions={{ style: { fontSize: "var(--fs-sm)" } }}
      />
    </React.StrictMode>,
  );
}

renderApp();
