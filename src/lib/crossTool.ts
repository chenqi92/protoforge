import { useAppStore } from "@/stores/appStore";
import { getMockServerStoreApi } from "@/stores/mockServerStore";

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
