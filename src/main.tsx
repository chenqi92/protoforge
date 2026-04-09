import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n"; // i18n 初始化 — 必须在组件渲染前
import "./styles/fonts.css"; // 本地捆绑字体 — 必须在 index.css 前
import "./index.css";

// 根据 URL query param 决定渲染哪个窗口
const params = new URLSearchParams(window.location.search);
const windowType = params.get("window");

async function renderApp() {
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

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <Component />
    </React.StrictMode>,
  );
}

renderApp();
