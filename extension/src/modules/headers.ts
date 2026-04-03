import type { HeadersData } from "../shared/types";
import type { CdpBridge } from "../background/cdp-bridge";

export async function observeHeaders(bridge: CdpBridge, url: string): Promise<HeadersData> {
  // Headers are captured via network module during request observation
  // This module fetches the main document headers via CDP
  await bridge.enableNetwork();

  return new Promise((resolve) => {
    const off = bridge.onEvent((method, params) => {
      if (method === "Network.responseReceived") {
        const p = params as {
          response: {
            url: string;
            status: number;
            headers: Record<string, string>;
            requestHeaders?: Record<string, string>;
            remoteIPAddress?: string;
            protocol?: string;
          };
        };
        if (p.response.url === url || p.response.url.startsWith(url)) {
          off();
          resolve({
            request: Object.entries(p.response.requestHeaders ?? {}).map(([name, value]) => ({ name, value })),
            response: Object.entries(p.response.headers).map(([name, value]) => ({ name, value })),
            statusCode: p.response.status,
            remoteAddress: p.response.remoteIPAddress ?? "",
            protocol: p.response.protocol ?? "",
          });
        }
      }
    });

    // Reload the page to capture headers
    void bridge.send("Page.reload", { ignoreCache: false });

    // Timeout after 10s
    setTimeout(() => {
      off();
      resolve({
        request: [],
        response: [],
        statusCode: 0,
        remoteAddress: "",
        protocol: "",
      });
    }, 10_000);
  });
}
