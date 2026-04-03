import type { AuthData, AuthRequest } from "../shared/types";
import type { CdpBridge } from "../background/cdp-bridge";

// URL patterns that suggest auth-related endpoints
const AUTH_URL_PATTERNS = [
  /\/(login|logout|signin|signout|auth|oauth|token|refresh|session|register|password|2fa|mfa|verify)/i,
  /\/(api|v\d+)\/(user|account|me|profile|identity)/i,
];


const TOKEN_RESPONSE_PATTERNS = [
  /["']?(access_token|refresh_token|id_token|token|jwt|session_id|sessionid)["']?\s*[:=]\s*["']([^"']{10,})["']/gi,
];

function isAuthUrl(url: string): boolean {
  return AUTH_URL_PATTERNS.some(re => re.test(url));
}

function extractTokens(body: string): string[] {
  const tokens: string[] = [];
  for (const re of TOKEN_RESPONSE_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      tokens.push(`${m[1]}: ${m[2].slice(0, 50)}...`);
    }
  }
  return tokens;
}

export async function observeAuth(
  bridge: CdpBridge,
  _url: string,
  options?: Record<string, unknown>
): Promise<AuthData> {
  const durationMs = (options?.durationMs as number) ?? 10_000;
  const requests: AuthRequest[] = [];
  const pending = new Map<string, Partial<AuthRequest>>();

  await bridge.enableNetwork();

  const off = bridge.onEvent((method, params) => {
    const p = params as Record<string, unknown>;

    if (method === "Network.requestWillBeSent") {
      const req = p.request as Record<string, unknown>;
      const url = req.url as string;
      if (!isAuthUrl(url)) return;

      const requestHeaders = Object.entries(
        (req.headers as Record<string, string>) ?? {}
      ).map(([name, value]) => ({ name, value }));

      pending.set(p.requestId as string, {
        url,
        method: req.method as string,
        requestHeaders,
        requestBody: (req.postData as string) ?? null,
        responseStatus: 0,
        responseHeaders: [],
        responseBody: null,
        tokens: [],
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

      bridge.send<{ body: string; base64Encoded: boolean }>(
        "Network.getResponseBody",
        { requestId: p.requestId as string }
      ).then(({ body, base64Encoded }) => {
        if (entry) {
          const decoded = base64Encoded ? atob(body) : body;
          entry.responseBody = decoded.slice(0, 10_000);
          entry.tokens = extractTokens(decoded);
        }
      }).catch(() => {});
    }

    if (method === "Network.loadingFinished") {
      const entry = pending.get(p.requestId as string);
      if (entry?.url) {
        setTimeout(() => {
          requests.push(entry as AuthRequest);
          pending.delete(p.requestId as string);
        }, 500);
      }
    }
  });

  await new Promise(resolve => setTimeout(resolve, durationMs));
  off();

  // Check stored tokens
  const storedTokens = await bridge.evaluate<AuthData["storedTokens"]>(`
    (() => {
      const tokens = [];
      const tokenKeys = ['token','access_token','refresh_token','id_token','jwt','session','auth'];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && tokenKeys.some(k => key.toLowerCase().includes(k))) {
          tokens.push({ location: 'localStorage', key, value: (localStorage.getItem(key) || '').slice(0, 200) });
        }
      }
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && tokenKeys.some(k => key.toLowerCase().includes(k))) {
          tokens.push({ location: 'sessionStorage', key, value: (sessionStorage.getItem(key) || '').slice(0, 200) });
        }
      }
      return tokens;
    })()
  `);

  const sessionIndicators = await bridge.evaluate<string[]>(`
    (() => {
      const indicators = [];
      if (document.cookie) indicators.push('cookies present');
      if (localStorage.length > 0) indicators.push('localStorage has ' + localStorage.length + ' keys');
      if (sessionStorage.length > 0) indicators.push('sessionStorage has ' + sessionStorage.length + ' keys');
      if (window.__user || window.currentUser || window.user) indicators.push('window.user object present');
      if (window.__AUTH__ || window.__auth__) indicators.push('window.__AUTH__ present');
      return indicators;
    })()
  `);

  return { requests, storedTokens, sessionIndicators };
}
