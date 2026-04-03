import type { MemoryData } from "../shared/types";
import type { CdpBridge } from "../background/cdp-bridge";

const STATE_STORE_KEYS = [
  "__NEXT_DATA__",
  "__nuxt__", "__NUXT__",
  "__REDUX_STATE__", "__PRELOADED_STATE__", "__INITIAL_STATE__",
  "__APOLLO_STATE__", "__APOLLO_CLIENT__",
  "__REACT_QUERY_STATE__",
  "__sveltekit_data",
  "__APP_CONFIG__", "__APP_STATE__", "__CONFIG__",
  "__ENV__", "__PUBLIC_ENV__", "__RUNTIME_CONFIG__",
];

interface StringEntry {
  value: string;
  length: number;
  occurrences: number;
}

export async function observeMemory(bridge: CdpBridge, _url: string): Promise<MemoryData> {
  const metrics = await bridge.send<{
    metrics: Array<{ name: string; value: number }>;
  }>("Performance.getMetrics");

  const heapUsed = metrics.metrics.find(m => m.name === "JSHeapUsedSize")?.value ?? 0;
  const heapTotal = metrics.metrics.find(m => m.name === "JSHeapTotalSize")?.value ?? 0;
  const nodeCount = metrics.metrics.find(m => m.name === "Nodes")?.value ?? 0;

  const expression = `
    (() => {
      const storeKeys = ${JSON.stringify(STATE_STORE_KEYS)};
      const seen = new Map();

      function collectStrings(obj, depth) {
        if (depth > 5 || obj === null || obj === undefined) return;
        const type = typeof obj;
        if (type === 'string' && obj.length >= 8) {
          seen.set(obj, (seen.get(obj) || 0) + 1);
          return;
        }
        if (type !== 'object' && type !== 'function') return;
        try {
          const keys = Object.keys(obj).slice(0, 100);
          for (const key of keys) {
            try { collectStrings(obj[key], depth + 1); } catch(e) {}
          }
        } catch(e) {}
      }

      for (const key of storeKeys) {
        try {
          if (window[key] !== undefined) collectStrings(window[key], 0);
        } catch(e) {}
      }

      try {
        if (window.__REDUX_STORE__ && typeof window.__REDUX_STORE__.getState === 'function') {
          collectStrings(window.__REDUX_STORE__.getState(), 0);
        }
      } catch(e) {}

      return [...seen.entries()]
        .sort((a, b) => b[0].length - a[0].length)
        .slice(0, 200)
        .map(([value, occurrences]) => ({ value, length: value.length, occurrences }));
    })()
  `;

  const strings = await bridge.evaluate<StringEntry[]>(expression);

  return {
    strings,
    summary: {
      totalNodes: nodeCount,
      totalSize: heapTotal,
      stringCount: heapUsed,
    },
  };
}
