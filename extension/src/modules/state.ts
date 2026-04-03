import type { StateData, StateSnapshot } from "../shared/types";
import type { CdpBridge } from "../background/cdp-bridge";

const STATE_STORES = [
  "__REDUX_STORE__", "__store__",
  "__NEXT_DATA__", "__nuxt__", "__NUXT__",
  "__INITIAL_STATE__", "__APP_STATE__",
];

async function captureSnapshot(bridge: CdpBridge): Promise<StateSnapshot> {
  const snapshot = await bridge.evaluate<StateSnapshot>(`
    (() => {
      const stores = {};
      const storeKeys = ${JSON.stringify(STATE_STORES)};

      for (const key of storeKeys) {
        try {
          if (window[key] !== undefined) {
            if (key === '__REDUX_STORE__' && typeof window[key].getState === 'function') {
              stores[key] = JSON.parse(JSON.stringify(window[key].getState()));
            } else {
              stores[key] = JSON.parse(JSON.stringify(window[key]));
            }
          }
        } catch(e) {
          stores[key] = '[unserializable]';
        }
      }

      const localKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) localKeys.push(k);
      }

      const sessionKeys = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k) sessionKeys.push(k);
      }

      return {
        timestamp: Date.now(),
        url: window.location.href,
        stores,
        localStorageKeys: localKeys,
        sessionStorageKeys: sessionKeys,
      };
    })()
  `);

  return snapshot;
}

export async function observeState(
  bridge: CdpBridge,
  _url: string,
  options?: Record<string, unknown>
): Promise<StateData> {
  const durationMs = (options?.durationMs as number) ?? 10_000;
  const dispatches: StateData["dispatches"] = [];
  const urlChanges: StateData["urlChanges"] = [];

  // Capture initial state
  const initial = await captureSnapshot(bridge);

  // Inject Redux dispatch interceptor and URL change monitor
  await bridge.evaluate<void>(`
    (() => {
      window.__gaze_state_log__ = [];
      window.__gaze_url_log__ = [];

      // Redux dispatch interceptor
      try {
        if (window.__REDUX_STORE__ && typeof window.__REDUX_STORE__.dispatch === 'function') {
          const origDispatch = window.__REDUX_STORE__.dispatch.bind(window.__REDUX_STORE__);
          window.__REDUX_STORE__.dispatch = function(action) {
            window.__gaze_state_log__.push({
              timestamp: Date.now(),
              action: action.type || 'unknown',
              payload: JSON.stringify(action).slice(0, 500),
            });
            return origDispatch(action);
          };
        }
      } catch(e) {}

      // URL change monitor
      const origPushState = history.pushState.bind(history);
      const origReplaceState = history.replaceState.bind(history);
      let lastUrl = window.location.href;

      history.pushState = function(...args) {
        const result = origPushState(...args);
        window.__gaze_url_log__.push({ timestamp: Date.now(), from: lastUrl, to: window.location.href });
        lastUrl = window.location.href;
        return result;
      };
      history.replaceState = function(...args) {
        const result = origReplaceState(...args);
        window.__gaze_url_log__.push({ timestamp: Date.now(), from: lastUrl, to: window.location.href });
        lastUrl = window.location.href;
        return result;
      };
    })()
  `);

  // Wait for observation window
  await new Promise(resolve => setTimeout(resolve, durationMs));

  // Collect logged state changes
  const logged = await bridge.evaluate<{
    dispatches: StateData["dispatches"];
    urlChanges: StateData["urlChanges"];
  }>(`
    (() => ({
      dispatches: window.__gaze_state_log__ || [],
      urlChanges: window.__gaze_url_log__ || [],
    }))()
  `);

  dispatches.push(...logged.dispatches);
  urlChanges.push(...logged.urlChanges);

  // Cleanup
  await bridge.evaluate<void>(`
    (() => {
      delete window.__gaze_state_log__;
      delete window.__gaze_url_log__;
    })()
  `);

  return { initial, dispatches, urlChanges };
}
