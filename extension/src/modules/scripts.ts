import type { ScriptsData } from "../shared/types";
import type { CdpBridge } from "../background/cdp-bridge";

const NATIVE_WINDOW_KEYS = new Set([
  "window","self","document","location","navigator","screen","history",
  "localStorage","sessionStorage","indexedDB","crypto","performance",
  "fetch","XMLHttpRequest","WebSocket","Worker","Promise","Object",
  "Array","String","Number","Boolean","Symbol","Map","Set","WeakMap",
  "WeakSet","Proxy","Reflect","JSON","Math","Date","RegExp","Error",
  "console","alert","confirm","prompt","setTimeout","setInterval",
  "clearTimeout","clearInterval","requestAnimationFrame","cancelAnimationFrame",
  "addEventListener","removeEventListener","dispatchEvent","postMessage",
  "open","close","focus","blur","print","scroll","scrollTo","scrollBy",
  "getComputedStyle","matchMedia","resizeBy","resizeTo","moveTo","moveBy",
  "atob","btoa","structuredClone","queueMicrotask","reportError",
  "customElements","caches","speechSynthesis","visualViewport",
  "innerWidth","innerHeight","outerWidth","outerHeight","devicePixelRatio",
  "pageXOffset","pageYOffset","screenX","screenY","screenLeft","screenTop",
  "frames","length","top","parent","opener","frameElement","origin",
  "isSecureContext","crossOriginIsolated","name","status","closed",
]);

export async function observeScripts(bridge: CdpBridge, _url: string): Promise<ScriptsData> {
  const [windowProperties, sourceMaps, serviceWorkers, evalUsage, postMessageHandlers] =
    await Promise.all([
      bridge.evaluate<ScriptsData["windowProperties"]>(`
        (() => {
          const native = ${JSON.stringify([...NATIVE_WINDOW_KEYS])};
          const nativeSet = new Set(native);
          return Object.getOwnPropertyNames(window)
            .filter(k => !nativeSet.has(k) && !k.startsWith('webkit'))
            .slice(0, 200)
            .map(k => {
              let preview = '';
              try {
                const v = window[k];
                const t = typeof v;
                if (t === 'string') preview = v.slice(0, 100);
                else if (t === 'object' && v !== null) preview = JSON.stringify(v).slice(0, 100);
                else preview = String(v).slice(0, 100);
                return { key: k, type: t, preview };
              } catch {
                return { key: k, type: 'unknown', preview: '[access error]' };
              }
            });
        })()
      `),
      bridge.evaluate<string[]>(`
        Array.from(document.querySelectorAll('script[src]'))
          .map(s => s.src)
          .filter(src => src.endsWith('.map') || src.includes('sourcemap'))
      `),
      bridge.evaluate<ScriptsData["serviceWorkers"]>(`
        (async () => {
          if (!navigator.serviceWorker) return [];
          const reg = await navigator.serviceWorker.getRegistration();
          if (!reg) return [];
          const sw = reg.active || reg.installing || reg.waiting;
          return [{
            scriptUrl: reg.active?.scriptURL || '',
            scope: reg.scope,
            state: sw?.state || 'unknown',
          }];
        })()
      `),
      bridge.evaluate<boolean>(`
        (() => {
          const scripts = Array.from(document.querySelectorAll('script:not([src])'));
          return scripts.some(s => (s.textContent || '').includes('eval('));
        })()
      `),
      bridge.evaluate<number>(`
        (() => {
          let count = 0;
          const orig = window.addEventListener;
          // Count existing postMessage listeners via getEventListeners workaround
          try {
            const listeners = window.__gaze_pm_count__ || 0;
            return listeners;
          } catch { return 0; }
        })()
      `),
    ]);

  return { windowProperties, sourceMaps, serviceWorkers, evalUsage, postMessageHandlers };
}
