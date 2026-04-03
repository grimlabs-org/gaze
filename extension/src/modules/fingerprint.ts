import type { FingerprintData } from "../shared/types";
import type { CdpBridge } from "../background/cdp-bridge";

const FRAMEWORK_SIGNATURES = [
  "__NEXT_DATA__", "__nuxt__", "__NUXT__", "__vue__",
  "angular", "ng", "React", "__REDUX_STATE__", "__GATSBY",
  "Ember", "Backbone", "jQuery", "$", "_", "Lodash",
  "wp", "wc", "wpApiSettings",
];

export async function observeFingerprint(bridge: CdpBridge, _url: string): Promise<FingerprintData> {
  const [globals, scriptUrls, metaTags, htmlSignatures] = await Promise.all([
    bridge.evaluate<FingerprintData["globals"]>(`
      (() => {
        const sigs = ${JSON.stringify(FRAMEWORK_SIGNATURES)};
        return sigs
          .filter(k => window[k] !== undefined)
          .map(k => {
            let value = '';
            try {
              const v = window[k];
              if (typeof v === 'string') value = v.slice(0, 200);
              else if (typeof v === 'object' && v !== null) value = JSON.stringify(v).slice(0, 200);
              else value = String(v).slice(0, 200);
            } catch { value = '[access error]'; }
            return { name: k, value };
          });
      })()
    `),
    bridge.evaluate<string[]>(`
      Array.from(document.querySelectorAll('script[src]'))
        .map(s => s.getAttribute('src'))
        .filter(Boolean)
        .slice(0, 50)
    `),
    bridge.evaluate<FingerprintData["metaTags"]>(`
      Array.from(document.querySelectorAll('meta'))
        .map(m => ({
          name: m.getAttribute('name') || m.getAttribute('property') || '',
          content: m.getAttribute('content') || '',
        }))
        .filter(m => m.name && m.content)
        .slice(0, 30)
    `),
    bridge.evaluate<string[]>(`
      (() => {
        const sigs = [];
        if (document.querySelector('[data-reactroot]')) sigs.push('data-reactroot');
        if (document.querySelector('[data-v-]')) sigs.push('vue-scoped-css');
        if (document.querySelector('nuxt-link, [data-n-head]')) sigs.push('nuxt');
        if (document.querySelector('[ng-version]')) sigs.push('angular');
        if (document.querySelector('[data-gatsby]')) sigs.push('gatsby');
        if (document.querySelector('#__NEXT_DATA__')) sigs.push('nextjs');
        if (document.querySelector('[data-svelte]')) sigs.push('svelte');
        return sigs;
      })()
    `),
  ]);

  return { globals, scriptUrls, responseHeaders: [], metaTags, htmlSignatures };
}
