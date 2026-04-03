import { CdpBridge } from "./cdp-bridge";
import { observeUrl } from "../modules/url";
import { observeHeaders } from "../modules/headers";
import { observeDom } from "../modules/dom";
import { observeScripts } from "../modules/scripts";
import { observeStorage } from "../modules/storage";
import { observeNetwork } from "../modules/network";
import { observeMemory } from "../modules/memory";
import { observePrototype } from "../modules/prototype";
import { observeCsp } from "../modules/csp";
import { observeFingerprint } from "../modules/fingerprint";
import type {
  HostMessage,
  ModuleId,
  ObserveRequestMessage,
  Observation,
} from "../shared/types";

const bridges = new Map<number, CdpBridge>();
const WS_URL = "ws://localhost:9876";
let ws: WebSocket | null = null;
let keepAliveInterval: ReturnType<typeof setInterval> | null = null;

function connect(): void {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => { console.log("[SW] Connected to host"); startKeepAlive(); };
  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data) as HostMessage;
      void handleHostMessage(message);
    } catch (err) { console.error("[SW] WS parse error:", err); }
  };
  ws.onclose = () => {
    console.log("[SW] Disconnected — retrying in 3s");
    stopKeepAlive(); ws = null; setTimeout(connect, 3000);
  };
  ws.onerror = () => {};
}

function sendToHost(message: HostMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  } else {
    console.warn("[SW] Cannot send — not connected");
  }
}

function startKeepAlive(): void {
  stopKeepAlive();
  keepAliveInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "KEEPALIVE" }));
    }
  }, 20_000);
}

function stopKeepAlive(): void {
  if (keepAliveInterval) { clearInterval(keepAliveInterval); keepAliveInterval = null; }
}

async function handleHostMessage(message: HostMessage): Promise<void> {
  switch (message.type) {
    case "PING":
      sendToHost({ type: "PONG", id: message.id });
      break;
    case "GET_ACTIVE_TAB":
      await handleGetActiveTab(message.id);
      break;
    case "OBSERVE_REQUEST":
      await handleObserveRequest(message);
      break;
    default:
      console.warn("[SW] Unhandled:", (message as HostMessage).type);
  }
}

async function handleGetActiveTab(id: string): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id || !tab.url) {
      sendToHost({ type: "ACTIVE_TAB_ERROR", id, error: "No active tab found" });
      return;
    }
    sendToHost({ type: "ACTIVE_TAB_RESULT", id, tabId: tab.id, url: tab.url, title: tab.title ?? "" });
  } catch (err) {
    sendToHost({ type: "ACTIVE_TAB_ERROR", id, error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleObserveRequest(message: ObserveRequestMessage): Promise<void> {
  const { id, tabId, url, module } = message;

  if (!bridges.has(tabId)) bridges.set(tabId, new CdpBridge(tabId));
  const bridge = bridges.get(tabId)!;

  try {
    await bridge.attach();
    const data = await runModule(module, bridge, url, message.options);
    const observation: Observation = {
      module,
      collectedAt: Date.now(),
      url,
      data,
    };
    sendToHost({ type: "OBSERVE_RESULT", id, observation });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    sendToHost({ type: "OBSERVE_ERROR", id, module, error });
  } finally {
    await bridge.detach().catch(() => {});
    bridges.delete(tabId);
  }
}

async function runModule(
  module: ModuleId,
  bridge: CdpBridge,
  url: string,
  options?: Record<string, unknown>
) {
  switch (module) {
    case "url":         return observeUrl(url);
    case "headers":     return observeHeaders(bridge, url);
    case "dom":         return observeDom(bridge, url);
    case "scripts":     return observeScripts(bridge, url);
    case "storage":     return observeStorage(bridge, url);
    case "network":     return observeNetwork(bridge, url, options);
    case "memory":      return observeMemory(bridge, url);
    case "prototype":   return observePrototype(bridge, url);
    case "csp":         return observeCsp(bridge, url);
    case "fingerprint": return observeFingerprint(bridge, url);
    default:            throw new Error(`Unknown module: ${module}`);
  }
}

chrome.debugger.onDetach.addListener(({ tabId }) => {
  if (!tabId) return;
  bridges.delete(tabId);
});

connect();
console.log("[SW] Service worker started");
