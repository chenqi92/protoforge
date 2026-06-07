import { toast } from "sonner";
import { useAppStore } from "@/stores/appStore";
import { getMockServerStoreApi } from "@/stores/mockServerStore";
import { useWorkflowStore } from "@/stores/workflowStore";
import type { FlowNode, FlowEdge } from "@/types/workflow";

/**
 * Open the Mock Server workbench and seed a route from an HTTP request.
 * Parallel helper to Sidebar's handleGenerateMock so cross-tool actions can be
 * triggered directly from the HTTP workspace without touching the Sidebar flow.
 */
export function generateMockFromRequest(req: {
  method?: string;
  url?: string;
  responseExample?: string;
  name?: string;
}): void {
  // Extract path from url, handling absolute urls and {{baseUrl}}/api/xxx templates.
  let path = "/";
  try {
    const urlStr = req.url || "/";
    if (urlStr.startsWith("http")) {
      path = new URL(urlStr).pathname;
    } else {
      const match = urlStr.match(/\}\}(.+)/);
      path = match ? match[1] : urlStr;
    }
  } catch {
    path = req.url || "/";
  }

  const sessionId = useAppStore.getState().openToolTab("mockserver");
  // Defer a tick so the mock server store/session is created before we add the route.
  setTimeout(() => {
    const mockStore = getMockServerStoreApi(sessionId);
    mockStore.getState().addRouteFromTemplate({
      method: req.method || "GET",
      pattern: path,
      bodyTemplate: req.responseExample || '{\n  "message": "mock response"\n}',
      description: req.name || "",
    });
  }, 100);
}

/**
 * Create a new Workflow seeded from an HTTP request, then open the Workflow
 * workbench focused on it. Builds a start (CircleNode) → httpRequest graph
 * matching WorkflowWorkspace's node/edge conventions so it renders correctly.
 *
 * Tauri-backed: createWorkflow/saveWorkflow call `invoke`, so this only works
 * inside the desktop app. In a plain browser (no Tauri) the invoke rejects and
 * we degrade gracefully with an error toast.
 */
export async function sendRequestToWorkflow(req: {
  name?: string;
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  body?: string;
}): Promise<void> {
  try {
    const wf = await useWorkflowStore.getState().createWorkflow(req.name?.trim() || "New Flow");

    const start: FlowNode = {
      id: crypto.randomUUID(),
      name: "开始",
      nodeType: "start",
      config: {},
      position: { x: 80, y: 40 },
    };

    // Mirror defaultConfig('httpRequest') in WorkflowWorkspace, overriding with the request.
    const httpConfig: Record<string, unknown> = {
      method: req.method || "GET",
      url: req.url || "",
      headers: req.headers || {},
      queryParams: req.queryParams || {},
      timeoutMs: 30000,
      followRedirects: true,
      sslVerify: true,
    };
    // HttpNodeConfig.body is a structured object ({type,data}); the node config
    // panel reads body.data. Only attach when there's actual content.
    if (req.body && req.body.trim()) {
      httpConfig.body = { type: "json", data: req.body };
    }

    const http: FlowNode = {
      id: crypto.randomUUID(),
      name: "HTTP 请求",
      nodeType: "httpRequest",
      config: httpConfig,
      position: { x: 60, y: 180 },
    };

    // Edge convention: source bottom-source handle → target (top-target implicit).
    const edge: FlowEdge = {
      id: crypto.randomUUID(),
      sourceNodeId: start.id,
      targetNodeId: http.id,
      sourceHandle: "bottom-source",
    };

    await useWorkflowStore.getState().saveWorkflow({ ...wf, nodes: [start, http], edges: [edge] });

    useAppStore.getState().openToolTab("workflow");
    useWorkflowStore.getState().setActiveWorkflowId(wf.id);

    toast.success("已转为 Workflow / Sent to Workflow");
  } catch (e) {
    console.error("[crossTool] sendRequestToWorkflow failed:", e);
    toast.error("转为 Workflow 失败 / Failed to send to Workflow");
  }
}
