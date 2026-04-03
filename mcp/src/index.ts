import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createConnection } from "net";
import { z } from "zod";
import type { HostMessage, ModuleId } from "../../extension/src/shared/types";

const IPC_PATH = process.platform === "win32"
  ? "\\\\.\\pipe\\gaze-mcp"
  : "/tmp/gaze-mcp.sock";

const TERMINAL_TYPES = new Set([
  "PONG", "OBSERVE_RESULT", "OBSERVE_ERROR", "ACTIVE_TAB_RESULT", "ACTIVE_TAB_ERROR",
]);

function sendToHost(message: HostMessage, timeoutMs = 120_000): Promise<HostMessage> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(IPC_PATH);
    let buffer = "";

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.on("connect", () => socket.write(JSON.stringify(message)));

    socket.on("data", (data) => {
      buffer += data.toString();
      let start = 0;
      let depth = 0;
      for (let i = 0; i < buffer.length; i++) {
        if (buffer[i] === "{") depth++;
        if (buffer[i] === "}") {
          depth--;
          if (depth === 0) {
            const chunk = buffer.slice(start, i + 1);
            start = i + 1;
            try {
              const msg = JSON.parse(chunk) as HostMessage;
              if (TERMINAL_TYPES.has(msg.type as string)) {
                clearTimeout(timer);
                socket.destroy();
                resolve(msg);
                return;
              }
            } catch { /* skip */ }
          }
        }
      }
      buffer = buffer.slice(start);
    });

    socket.on("error", (err) => { clearTimeout(timer); reject(err); });
    socket.on("close", () => { clearTimeout(timer); });
  });
}

async function observe(
  tabId: number,
  url: string,
  module: ModuleId,
  options?: Record<string, unknown>
): Promise<string> {
  const message: HostMessage = options !== undefined
    ? { type: "OBSERVE_REQUEST", id: `obs-${Date.now()}`, tabId, url, module, options }
    : { type: "OBSERVE_REQUEST", id: `obs-${Date.now()}`, tabId, url, module };

  const response = await sendToHost(message);

  if (response.type === "OBSERVE_ERROR") {
    return `Error in ${module}: ${response.error}`;
  }

  if (response.type === "OBSERVE_RESULT") {
    const json = JSON.stringify(response.observation.data, null, 2);
    // Truncate if too large
    return json.length > 800_000 ? json.slice(0, 800_000) + "\n...[truncated]" : json;
  }

  return `Unexpected response: ${response.type}`;
}

const server = new McpServer({ name: "gaze", version: "0.3.0" });

// ── Meta tools ────────────────────────────────────────────────────────────────

server.tool("ping", "Check if Gaze host is running.", {}, async () => {
  try {
    const r = await sendToHost({ type: "PING", id: `ping-${Date.now()}` }, 5_000);
    return { content: [{ type: "text", text: r.type === "PONG" ? "Gaze is running." : `Unexpected: ${r.type}` }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Host unreachable: ${err}` }] };
  }
});

server.tool("get_active_tab", "Get the currently active Chrome tab ID and URL.", {}, async () => {
  try {
    const r = await sendToHost({ type: "GET_ACTIVE_TAB", id: `tab-${Date.now()}` }, 5_000);
    if (r.type === "ACTIVE_TAB_RESULT") {
      return { content: [{ type: "text", text: JSON.stringify({ tabId: r.tabId, url: r.url, title: r.title }, null, 2) }] };
    }
    return { content: [{ type: "text", text: `Error: ${JSON.stringify(r)}` }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Failed: ${err}` }] };
  }
});

// ── Base params ───────────────────────────────────────────────────────────────

const tabUrlParams = {
  tabId: z.number().describe("Chrome tab ID"),
  url: z.string().describe("URL of the page"),
};

const tabUrlDurationParams = {
  ...tabUrlParams,
  durationMs: z.number().optional().describe("Observation window in ms. Default 10000."),
};

// ── Structural observation tools ──────────────────────────────────────────────

server.tool("observe_url", "Observe URL structure — protocol, hostname, path, params, fragment.", tabUrlParams,
  async ({ tabId, url }) => ({ content: [{ type: "text", text: await observe(tabId, url, "url") }] }));

server.tool("observe_headers", "Observe HTTP request/response headers — security headers, CORS, server disclosure.", tabUrlParams,
  async ({ tabId, url }) => ({ content: [{ type: "text", text: await observe(tabId, url, "headers") }] }));

server.tool("observe_dom", "Observe DOM — forms, iframes, inline handlers, script tags, HTML comments, meta tags.", tabUrlParams,
  async ({ tabId, url }) => ({ content: [{ type: "text", text: await observe(tabId, url, "dom") }] }));

server.tool("observe_scripts", "Observe JS runtime — non-native window properties, source maps, service workers, eval usage.", tabUrlParams,
  async ({ tabId, url }) => ({ content: [{ type: "text", text: await observe(tabId, url, "scripts") }] }));

server.tool("observe_storage", "Observe storage — cookies (domain-scoped), localStorage, sessionStorage, IndexedDB, Cache API.", tabUrlParams,
  async ({ tabId, url }) => ({ content: [{ type: "text", text: await observe(tabId, url, "storage") }] }));

server.tool("observe_network", "Observe network requests over a time window — URLs, methods, headers, status codes.", tabUrlDurationParams,
  async ({ tabId, url, durationMs }) => ({
    content: [{ type: "text", text: await observe(tabId, url, "network", durationMs !== undefined ? { durationMs } : undefined) }]
  }));

server.tool("observe_memory", "Observe memory — JS heap metrics and strings from framework state stores.", tabUrlParams,
  async ({ tabId, url }) => ({ content: [{ type: "text", text: await observe(tabId, url, "memory") }] }));

server.tool("observe_prototype", "Observe prototype chains — Object/Array/Function.prototype and non-spec additions.", tabUrlParams,
  async ({ tabId, url }) => ({ content: [{ type: "text", text: await observe(tabId, url, "prototype") }] }));

server.tool("observe_csp", "Observe Content Security Policy — raw header, parsed directives, report endpoints.", tabUrlParams,
  async ({ tabId, url }) => ({ content: [{ type: "text", text: await observe(tabId, url, "csp") }] }));

server.tool("observe_fingerprint", "Observe framework/library signals — JS globals, script URLs, HTML signatures, meta tags.", tabUrlParams,
  async ({ tabId, url }) => ({ content: [{ type: "text", text: await observe(tabId, url, "fingerprint") }] }));

// ── Business logic observation tools ─────────────────────────────────────────

server.tool(
  "observe_api",
  "Observe API calls (XHR/Fetch) made by the page — URLs, methods, request/response bodies, auth headers. Captures over a time window.",
  tabUrlDurationParams,
  async ({ tabId, url, durationMs }) => ({
    content: [{ type: "text", text: await observe(tabId, url, "api", durationMs !== undefined ? { durationMs } : undefined) }]
  })
);

server.tool(
  "observe_js_analysis",
  "Analyse loaded JavaScript — extract API endpoints, detect dangerous sinks (eval/innerHTML), auth patterns, role/permission checks, and hardcoded credentials.",
  tabUrlDurationParams,
  async ({ tabId, url, durationMs }) => ({
    content: [{ type: "text", text: await observe(tabId, url, "js_analysis", durationMs !== undefined ? { durationMs } : undefined) }]
  })
);

server.tool(
  "observe_events",
  "Observe DOM event handlers, custom events, postMessage origin checks, and form submit handlers.",
  tabUrlParams,
  async ({ tabId, url }) => ({ content: [{ type: "text", text: await observe(tabId, url, "events") }] })
);

server.tool(
  "observe_auth",
  "Observe authentication flows — intercepts auth-related requests (login, token, session), extracts tokens from responses, checks storage for stored credentials.",
  tabUrlDurationParams,
  async ({ tabId, url, durationMs }) => ({
    content: [{ type: "text", text: await observe(tabId, url, "auth", durationMs !== undefined ? { durationMs } : undefined) }]
  })
);

server.tool(
  "observe_state",
  "Observe client-side state — captures initial state from Redux/Vuex/Next/Nuxt stores, monitors Redux dispatches and URL changes during observation window.",
  tabUrlDurationParams,
  async ({ tabId, url, durationMs }) => ({
    content: [{ type: "text", text: await observe(tabId, url, "state", durationMs !== undefined ? { durationMs } : undefined) }]
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[Gaze MCP] Server running");
