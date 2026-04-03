import type { StorageData, CookieEntry } from "../shared/types";
import type { CdpBridge } from "../background/cdp-bridge";

function scopedHostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function cookieBelongsToTarget(cookieDomain: string, targetHostname: string): boolean {
  const normalized = cookieDomain.startsWith(".") ? cookieDomain.slice(1) : cookieDomain;
  return targetHostname === normalized || targetHostname.endsWith(`.${normalized}`);
}

export async function observeStorage(bridge: CdpBridge, url: string): Promise<StorageData> {
  const targetHostname = scopedHostname(url);
  await bridge.enableNetwork();

  const [allCookies, local, session, idbInfo, cacheInfo] = await Promise.all([
    bridge.getCookies(),
    bridge.getLocalStorage(),
    bridge.getSessionStorage(),
    bridge.evaluate<Array<{ name: string; version: number; objectStores: string[] }>>(`
      (async () => {
        if (!window.indexedDB) return [];
        try {
          const dbs = await indexedDB.databases?.() || [];
          return dbs.map(db => ({ name: db.name || '', version: db.version || 0, objectStores: [] }));
        } catch { return []; }
      })()
    `),
    bridge.evaluate<Array<{ name: string; urls: string[] }>>(`
      (async () => {
        if (!window.caches) return [];
        try {
          const names = await caches.keys();
          const result = [];
          for (const name of names.slice(0, 10)) {
            const cache = await caches.open(name);
            const keys = await cache.keys();
            result.push({ name, urls: keys.map(r => r.url).slice(0, 20) });
          }
          return result;
        } catch { return []; }
      })()
    `),
  ]);

  const scopedCookies = allCookies
    .filter(c => cookieBelongsToTarget(
      (c as unknown as { domain: string }).domain,
      targetHostname
    ))
    .map(c => {
      const raw = c as unknown as {
        name: string; value: string; domain: string; path: string;
        secure: boolean; httpOnly: boolean; sameSite?: string;
        expires?: number; session?: boolean;
      };
      return {
        name: raw.name,
        value: raw.value,
        domain: raw.domain,
        path: raw.path,
        secure: raw.secure,
        httpOnly: raw.httpOnly,
        sameSite: raw.sameSite ?? "",
        expires: raw.expires ?? null,
        session: raw.session ?? false,
        size: raw.name.length + raw.value.length,
      } satisfies CookieEntry;
    });

  return {
    cookies: scopedCookies,
    localStorage: Object.entries(local).map(([key, value]) => ({
      key, value, size: key.length + value.length,
    })),
    sessionStorage: Object.entries(session).map(([key, value]) => ({
      key, value, size: key.length + value.length,
    })),
    indexedDB: idbInfo,
    cacheStorage: cacheInfo,
  };
}
