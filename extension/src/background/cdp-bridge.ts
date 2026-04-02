/**
 * CDP Bridge
 * Typed wrapper around chrome.debugger.
 * All CDP communication flows through here.
 */

export class CdpBridge {
  private readonly target: chrome.debugger.Debuggee;
  private attached = false;

  constructor(tabId: number) {
    this.target = { tabId };
  }

// Lifecycle
  async attach(): Promise<void> {
    if (this.attached) return;
    return new Promise((resolve, reject) => {
      chrome.debugger.attach(this.target, "1.3", () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          this.attached = true;
          resolve();
        }
      });
    });
  }

  async detach(): Promise<void> {
    if (!this.attached) return;
    return new Promise((resolve, reject) => {
      chrome.debugger.detach(this.target, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          this.attached = false;
          resolve();
        }
      });
    });
  }

  get isAttached(): boolean {
    return this.attached;
  }

// Core
  async send<TResult = unknown>(
    method: string,
    params?: Record<string, unknown>
  ): Promise<TResult> {
    if (!this.attached) {
      throw new Error(`CdpBridge: not attached — cannot call ${method}`);
    }
    return new Promise((resolve, reject) => {
      chrome.debugger.sendCommand(
        this.target,
        method,
        params ?? {},
        (result) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(result as TResult);
          }
        }
      );
    });
  }

// DOM
  async getDocumentHtml(): Promise<string> {
    const { root } = await this.send<{ root: { nodeId: number } }>(
      "DOM.getDocument",
      { depth: -1, pierce: true }
    );
    const { outerHTML } = await this.send<{ outerHTML: string }>(
      "DOM.getOuterHTML",
      { nodeId: root.nodeId }
    );
    return outerHTML;
  }

// Runtime
  async evaluate<T = unknown>(expression: string): Promise<T> {
    const result = await this.send<{
      result: { value?: T; type: string };
      exceptionDetails?: unknown;
    }>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });

    if (result.exceptionDetails) {
      throw new Error(
        `Runtime.evaluate exception: ${JSON.stringify(result.exceptionDetails)}`
      );
    }

    return result.result.value as T;
  }

// Network
  async enableNetwork(): Promise<void> {
    await this.send("Network.enable");
  }

  async disableNetwork(): Promise<void> {
    await this.send("Network.disable");
  }

  async getCookies(): Promise<chrome.cookies.Cookie[]> {
    const { cookies } = await this.send<{ cookies: chrome.cookies.Cookie[] }>(
      "Network.getAllCookies"
    );
    return cookies;
  }

// Storage
  async getLocalStorage(): Promise<Record<string, string>> {
    return this.evaluate<Record<string, string>>(`
      (() => {
        const out = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k !== null) out[k] = localStorage.getItem(k) ?? "";
        }
        return out;
      })()
    `);
  }

  async getSessionStorage(): Promise<Record<string, string>> {
    return this.evaluate<Record<string, string>>(`
      (() => {
        const out = {};
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (k !== null) out[k] = sessionStorage.getItem(k) ?? "";
        }
        return out;
      })()
    `);
  }

// Heap
  async takeHeapSnapshot(): Promise<string> {
    const chunks: string[] = [];

    const onChunk = (
      _source: chrome.debugger.Debuggee,
      method: string,
      params: unknown
    ) => {
      if (method === "HeapProfiler.addHeapSnapshotChunk") {
        chunks.push((params as { chunk: string }).chunk);
      }
    };

    chrome.debugger.onEvent.addListener(onChunk);

    await this.send("HeapProfiler.enable");
    await this.send("HeapProfiler.takeHeapSnapshot", {
      reportProgress: false,
      treatGlobalObjectsAsRoots: true,
      captureNumericValue: false,
    });

    chrome.debugger.onEvent.removeListener(onChunk);
    return chunks.join("");
  }

// Event listener
  onEvent(
    callback: (method: string, params: unknown) => void
  ): () => void {
    const listener = (
      source: chrome.debugger.Debuggee,
      method: string,
      params: unknown
    ) => {
      if (source.tabId === this.target.tabId) {
        callback(method, params);
      }
    };
    chrome.debugger.onEvent.addListener(listener);
    return () => chrome.debugger.onEvent.removeListener(listener);
  }
}
