/**
 * Service Worker Entry Point
 * Static imports only — no dynamic imports to avoid Vite's
 * modulepreload polyfill which uses window.dispatchEvent.
 */

import { CdpBridge } from "./cdp-bridge";
import { runStorageAudit } from "../modules/storage";
import { runDomScan } from "../modules/dom";
import { runNetworkScan } from "../modules/network";
import { runFingerprint } from "../modules/fingerprint";
import { runPrototypeScan } from "../modules/prototype";
import { runMemoryScan } from "../modules/memory";
import type { HostMessage, ModuleId, ScanRequestMessage } from "../shared/types";

// ─── State ───────────────────────────────────────────────────────────────────

const bridges = new Map<number, CdpBridge>();
const WS_URL = "ws://localhost:9876";
let ws: WebSocket | null = null;
let keepAliveInterval: ReturnType<typeof setInterval> | null = null;

// ─── WebSocket Connection ─────────────────────────────────────────────────────

function connect(): void {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log("[SW] Connected to host");
    startKeepAlive();
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data) as HostMessage;
      void handleHostMessage(message);
    } catch (err) {
      console.error("[SW] WS parse error:", err);
    }
  };

  ws.onclose = () => {
    console.log("[SW] Disconnected from host — retrying in 3s");
    stopKeepAlive();
    ws = null;
    setTimeout(connect, 3000);
  };

  ws.onerror = () => {};
}

function sendToHost(message: HostMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  } else {
    console.warn("[SW] Cannot send to host — not connected");
  }
}

// ─── Keepalive ────────────────────────────────────────────────────────────────

function startKeepAlive(): void {
  stopKeepAlive();
  keepAliveInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "KEEPALIVE" }));
    }
  }, 20_000);
}

function stopKeepAlive(): void {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

// ─── Message Handler ──────────────────────────────────────────────────────────

async function handleHostMessage(message: HostMessage): Promise<void> {
  switch (message.type) {
    case "PING":
      sendToHost({ type: "PONG", id: message.id });
      break;
    case "GET_ACTIVE_TAB":
      await handleGetActiveTab(message.id);
      break;
    case "SCAN_REQUEST":
      await handleScanRequest(message);
      break;
    default:
      console.warn("[SW] Unhandled message:", (message as HostMessage).type);
  }
}

// ─── Active Tab ───────────────────────────────────────────────────────────────

async function handleGetActiveTab(id: string): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id || !tab.url) {
      sendToHost({ type: "ACTIVE_TAB_ERROR", id, error: "No active tab found" });
      return;
    }
    sendToHost({
      type: "ACTIVE_TAB_RESULT",
      id,
      tabId: tab.id,
      url: tab.url,
      title: tab.title ?? "",
    });
  } catch (err) {
    sendToHost({
      type: "ACTIVE_TAB_ERROR",
      id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── Scan Handler ─────────────────────────────────────────────────────────────

async function handleScanRequest(message: ScanRequestMessage): Promise<void> {
  const { id, tabId, url, modules } = message;

  if (!bridges.has(tabId)) {
    bridges.set(tabId, new CdpBridge(tabId));
  }
  const bridge = bridges.get(tabId)!;

  try {
    await bridge.attach();

    const allFindings = [];
    const start = Date.now();

    for (const moduleId of modules) {
      try {
        const findings = await runModule(moduleId, bridge, url);
        sendToHost({ type: "MODULE_RESULT", id, moduleId, findings });
        allFindings.push(...findings);
      } catch (err) {
        console.error(`[SW] Module ${moduleId} failed:`, err);
      }
    }

    sendToHost({
      type: "SCAN_RESULT",
      id,
      findings: allFindings,
      duration: Date.now() - start,
    });

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    sendToHost({ type: "SCAN_ERROR", id, error });
  } finally {
    await bridge.detach().catch(() => {});
    bridges.delete(tabId);
  }
}

// ─── Module Runner ────────────────────────────────────────────────────────────

async function runModule(moduleId: ModuleId, bridge: CdpBridge, url: string) {
  switch (moduleId) {
    case "storage":   return runStorageAudit(bridge, url);
    case "dom":       return runDomScan(bridge, url);
    case "network":   return runNetworkScan(bridge, url);
    case "fingerprint": return runFingerprint(bridge, url);
    case "prototype": return runPrototypeScan(bridge, url);
    case "memory":    return runMemoryScan(bridge, url);
    default:          return [];
  }
}

// ─── Debugger Cleanup ─────────────────────────────────────────────────────────

chrome.debugger.onDetach.addListener(({ tabId }) => {
  if (!tabId) return;
  bridges.delete(tabId);
});

// ─── Startup ──────────────────────────────────────────────────────────────────

connect();
console.log("[SW] Service worker started");
