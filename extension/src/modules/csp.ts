import type { CspData } from "../shared/types";
import type { CdpBridge } from "../background/cdp-bridge";

function parseDirectives(csp: string): Record<string, string[]> {
  const directives: Record<string, string[]> = {};
  for (const part of csp.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) directives[name.toLowerCase()] = values;
  }
  return directives;
}

export async function observeCsp(bridge: CdpBridge, _url: string): Promise<CspData> {
  await bridge.enableNetwork();

  // Get CSP from meta tag (already in DOM) or from response headers
  const metaCsp = await bridge.evaluate<string | null>(`
    (() => {
      const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
      return meta ? meta.getAttribute('content') : null;
    })()
  `);

  // Also check response headers captured via CDP
  const headerCsp = await bridge.evaluate<string | null>(`null`); // Will be populated via network module

  const raw = metaCsp || headerCsp;

  if (!raw) {
    return { raw: null, present: false, directives: {}, reportUri: null, reportTo: null };
  }

  const directives = parseDirectives(raw);
  return {
    raw,
    present: true,
    directives,
    reportUri: directives["report-uri"]?.[0] ?? null,
    reportTo: directives["report-to"]?.[0] ?? null,
  };
}
