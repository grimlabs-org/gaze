/**
 * Service Worker Entry Point
 * Coordinates the CDP bridge, native bridge, and scan lifecycle.
 */

import { CdpBridge } from "./cdp-bridge";
import { NativeBridge } from "./native-bridge";
import type {
  HostMessage,
  ModuleId,
  ScanRequestMessage,
} from "../shared/types";

// State
const native = new NativeBridge();
const bridges = new Map<number, CdpBridge>();

// Native Messaging
native.connect();

native.onMessage(async (message: HostMessage) => {
  switch (message.type) {
    case "PING":
      native.send({ type: "PONG", id: message.id });
      break;

    case "SCAN_REQUEST":
      await handleScanRequest(message);
      break;

    default:
      console.warn("[SW] Unhandled message type:", message.type);
  }
});

// Scan Handler
async function handleScanRequest(message: ScanRequestMessage): Promise<void> {
  const { id, tabId, url, modules } = message;

  // Get or create bridge for this tab
  if (!bridges.has(tabId)) {
    bridges.set(tabId, new CdpBridge(tabId));
  }
  const bridge = bridges.get(tabId)!;

  try {
    await bridge.attach();

    // Run requested modules sequentially
    // Modules will be imported and wired in as they are built
    const allFindings = [];
    const start = Date.now();

    for (const moduleId of modules) {
      try {
        const findings = await runModule(moduleId, bridge, url);

        native.send({
          type: "MODULE_RESULT",
          id,
          moduleId,
          findings,
        });

        allFindings.push(...findings);
      } catch (err) {
        console.error(`[SW] Module ${moduleId} failed:`, err);
      }
    }

    native.send({
      type: "SCAN_RESULT",
      id,
      findings: allFindings,
      duration: Date.now() - start,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    native.send({ type: "SCAN_ERROR", id, error });
  } finally {
    await bridge.detach().catch(() => {});
    bridges.delete(tabId);
  }
}

// Module Runner
async function runModule(
  moduleId: ModuleId,
  bridge: CdpBridge,
  url: string
) {
  switch (moduleId) {
    case "storage": {
      const { runStorageAudit } = await import("../modules/storage");
      return runStorageAudit(bridge, url);
    }
    case "dom": {
      const { runDomScan } = await import("../modules/dom");
      return runDomScan(bridge, url);
    }
    case "network": {
      const { runNetworkScan } = await import("../modules/network");
      return runNetworkScan(bridge, url);
    }
    case "fingerprint": {
      const { runFingerprint } = await import("../modules/fingerprint");
      return runFingerprint(bridge, url);
    }
    case "prototype": {
      const { runPrototypeScan } = await import("../modules/prototype");
      return runPrototypeScan(bridge, url);
    }
    case "memory": {
      const { runMemoryScan } = await import("../modules/memory");
      return runMemoryScan(bridge, url);
    }
    default:
      return [];
  }
}

// Debugger Cleanup
chrome.debugger.onDetach.addListener(({ tabId }) => {
  if (!tabId) return;
  bridges.delete(tabId);
});

// Keep Alive 

// Native messaging port keeps the service worker alive
// while a scan is in progress

console.log("[Gaze] Service worker started");
