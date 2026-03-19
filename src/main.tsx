import React from "react";
import ReactDOM from "react-dom/client";
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
