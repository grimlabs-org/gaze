import type { NetworkData, NetworkRequest } from "../shared/types";
import type { CdpBridge } from "../background/cdp-bridge";

export async function observeNetwork(
  bridge: CdpBridge,
  _url: string,
  options?: Record<string, unknown>
): Promise<NetworkData> {
  const durationMs = (options?.durationMs as number) ?? 5000;
  const requests: NetworkRequest[] = [];
  const webSockets: NetworkData["webSockets"] = [];
  const blockedRequests: NetworkData["blockedRequests"] = [];
  const pendingRequests = new Map<string, Partial<NetworkRequest>>();

  await bridge.enableNetwork();

  const off = bridge.onEvent((method, params) => {
    const p = params as Record<string, unknown>;

    if (method === "Network.requestWillBeSent") {
      const req = p.request as Record<string, unknown>;
      pendingRequests.set(p.requestId as string, {
        url: req.url as string,
        method: req.method as string,
        resourceType: p.type as string,
        requestHeaders: Object.entries(
          (req.headers as Record<string, string>) ?? {}
        ).map(([name, value]) => ({ name, value })),
        responseStatus: 0,
        responseHeaders: [],
        timing: 0,
        initiator: JSON.stringify(p.initiator).slice(0, 100),
        size: 0,
      });
    }

    if (method === "Network.responseReceived") {
      const res = p.response as Record<string, unknown>;
      const pending = pendingRequests.get(p.requestId as string);
      if (pending) {
        pending.responseStatus = res.status as number;
        pending.responseHeaders = Object.entries(
          (res.headers as Record<string, string>) ?? {}
        ).map(([name, value]) => ({ name, value }));
        pending.timing = (res.timing as Record<string, number>)?.receiveHeadersEnd ?? 0;
      }
    }

    if (method === "Network.loadingFinished") {
      const pending = pendingRequests.get(p.requestId as string);
      if (pending) {
        pending.size = p.encodedDataLength as number ?? 0;
        requests.push(pending as NetworkRequest);
        pendingRequests.delete(p.requestId as string);
      }
    }

    if (method === "Network.loadingFailed") {
      const pending = pendingRequests.get(p.requestId as string);
      if (pending?.url) {
        blockedRequests.push({
          url: pending.url,
          reason: p.errorText as string ?? "unknown",
        });
      }
      pendingRequests.delete(p.requestId as string);
    }

    if (method === "Network.webSocketCreated") {
      webSockets.push({
        url: p.url as string,
        protocol: "",
      });
    }
  });

  await new Promise(resolve => setTimeout(resolve, durationMs));
  off();

  return { requests, webSockets, blockedRequests };
}
