import type { UrlData } from "../shared/types";

export function observeUrl(url: string): UrlData {
  const parsed = new URL(url);
  return {
    raw: url,
    protocol: parsed.protocol.replace(":", ""),
    hostname: parsed.hostname,
    port: parsed.port || null,
    pathname: parsed.pathname,
    params: Array.from(parsed.searchParams.entries()).map(([key, value]) => ({ key, value })),
    fragment: parsed.hash ? parsed.hash.slice(1) : null,
    isHttps: parsed.protocol === "https:",
  };
}
