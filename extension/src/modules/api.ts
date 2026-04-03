import type { ApiData, ApiRequest } from "../shared/types";
import type { CdpBridge } from "../background/cdp-bridge";

const API_RESOURCE_TYPES = new Set([
  "XHR", "Fetch", "WebSocket",
]);

const MAX_BODY_SIZE = 500_000; // 500KB cap per response body

export async function observeApi(
  bridge: CdpBridge,
  _url: string,
  options?: Record<string, unknown>
): Promise<ApiData> {
  const durationMs = (options?.durationMs as number) ?? 10_000;
  const requests: ApiRequest[] = [];
  const pending = new Map<string, Partial<ApiRequest>>();
  const start = Date.now();

  await bridge.enableNetwork();

  const off = bridge.onEvent((method, params) => {
    const p = params as Record<string, unknown>;

    if (method === "Network.requestWillBeSent") {
      const req = p.request as Record<string, unknown>;
      const type = p.type as string;
      if (!API_RESOURCE_TYPES.has(type)) return;

      pending.set(p.requestId as string, {
        requestId: p.requestId as string,
        url: req.url as string,
        method: req.method as string,
        resourceType: type,
        requestHeaders: Object.entries(
          (req.headers as Record<string, string>) ?? {}
        ).map(([name, value]) => ({ name, value })),
        requestBody: (req.postData as string) ?? null,
        responseStatus: 0,
        responseHeaders: [],
        responseBody: null,
        timing: 0,
        initiator: JSON.stringify(p.initiator).slice(0, 200),
      });
    }

    if (method === "Network.responseReceived") {
      const res = p.response as Record<string, unknown>;
      const entry = pending.get(p.requestId as string);
      if (!entry) return;

      entry.responseStatus = res.status as number;
      entry.responseHeaders = Object.entries(
        (res.headers as Record<string, string>) ?? {}
      ).map(([name, value]) => ({ name, value }));
      entry.timing = (res.timing as Record<string, number>)?.receiveHeadersEnd ?? 0;

      // Fetch response body immediately while requestId is still valid
      bridge.send<{ body: string; base64Encoded: boolean }>(
        "Network.getResponseBody",
        { requestId: p.requestId as string }
      ).then(({ body, base64Encoded }) => {
        if (entry) {
          const decoded = base64Encoded
            ? atob(body).slice(0, MAX_BODY_SIZE)
            : body.slice(0, MAX_BODY_SIZE);
          entry.responseBody = decoded;
        }
      }).catch(() => {
        // Body unavailable — skip silently
      });
    }

    if (method === "Network.loadingFinished") {
      const entry = pending.get(p.requestId as string);
      if (entry) {
        // Give body fetch a moment to complete
        setTimeout(() => {
          requests.push(entry as ApiRequest);
          pending.delete(p.requestId as string);
        }, 500);
      }
    }
  });

  await new Promise(resolve => setTimeout(resolve, durationMs));
  off();

  // Flush any remaining pending requests
  for (const [, entry] of pending) {
    if (entry.url) requests.push(entry as ApiRequest);
  }

  return { requests, duration: Date.now() - start };
}
