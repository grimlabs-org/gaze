import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createConnection } from "net";
import { z } from "zod";
import type { HostMessage, ModuleId, Finding } from "../../extension/src/shared/types";

const IPC_PATH = process.platform === "win32"
  ? "\\\\.\\pipe\\gaze-mcp"
  : "/tmp/gaze-mcp.sock";

const TERMINAL_TYPES = new Set([
  "PONG", "SCAN_RESULT", "SCAN_ERROR", "ACTIVE_TAB_RESULT", "ACTIVE_TAB_ERROR",
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

// Trim findings to fit within Claude's 1MB tool result limit
function formatFindings(findings: Finding[], url: string, duration: number): string {
  const summary = {
    critical: findings.filter(f => f.severity === "critical").length,
    high: findings.filter(f => f.severity === "high").length,
    medium: findings.filter(f => f.severity === "medium").length,
    low: findings.filter(f => f.severity === "low").length,
    info: findings.filter(f => f.severity === "info").length,
    total: findings.length,
  };

  // Strip large evidence content, keep structure
  const trimmed = findings.map(f => ({
    id: f.id,
    title: f.title,
    severity: f.severity,
    category: f.category,
    description: f.description,
    remediations: f.remediations,
    status: f.status,
    url: f.url,
    // Truncate evidence content to 500 chars each
    evidence: f.evidence.map(e => ({
      type: e.type,
      label: e.label,
      content: e.content.slice(0, 500) + (e.content.length > 500 ? "…[truncated]" : ""),
    })),
  }));

  const result = { url, duration, summary, findings: trimmed };
  const json = JSON.stringify(result, null, 2);

  // If still too large, return summary only with top findings
  if (json.length > 800_000) {
    const topFindings = trimmed
      .sort((a, b) => {
        const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
        return order[a.severity] - order[b.severity];
      })
      .slice(0, 20)
      .map(f => ({
        title: f.title,
        severity: f.severity,
        category: f.category,
        description: f.description.slice(0, 200),
        remediations: f.remediations.slice(0, 2),
      }));

    return JSON.stringify({
      url,
      duration,
      summary,
      note: `Showing top 20 of ${findings.length} findings. Ask for specific categories for more detail.`,
      findings: topFindings,
    }, null, 2);
  }

  return json;
}

const server = new McpServer({ name: "gaze", version: "0.1.0" });

server.tool("ping", "Check if Gaze host is running.", {}, async () => {
  try {
    const r = await sendToHost({ type: "PING", id: `ping-${Date.now()}` }, 5_000);
    return {
      content: [{
        type: "text",
        text: r.type === "PONG"
          ? "Gaze host is running and extension is connected."
          : `Unexpected: ${JSON.stringify(r)}`,
      }],
    };
  } catch (err) {
    return { content: [{ type: "text", text: `Host unreachable: ${err}` }] };
  }
});

server.tool("get_active_tab", "Get the currently active Chrome tab.", {}, async () => {
  try {
    const r = await sendToHost({ type: "GET_ACTIVE_TAB", id: `tab-${Date.now()}` }, 5_000);
    if (r.type === "ACTIVE_TAB_RESULT") {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ tabId: r.tabId, url: r.url, title: r.title }, null, 2),
        }],
      };
    }
    return { content: [{ type: "text", text: `Error: ${JSON.stringify(r)}` }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Failed: ${err}` }] };
  }
});

server.tool(
  "scan",
  "Run a security scan on a Chrome tab. Call get_active_tab first to get the tab ID.",
  {
    tabId: z.number().describe("Chrome tab ID to scan"),
    url: z.string().describe("URL of the page being scanned"),
    modules: z.array(z.enum([
      "storage", "dom", "network", "fingerprint", "prototype", "memory"
    ])).optional().describe("Modules to run. Defaults to all except memory."),
  },
  async ({ tabId, url, modules }) => {
    const selectedModules: ModuleId[] = (modules as ModuleId[]) ?? [
      "storage", "dom", "network", "fingerprint", "prototype",
    ];

    try {
      const r = await sendToHost({
        type: "SCAN_REQUEST",
        id: `scan-${Date.now()}`,
        tabId,
        url,
        modules: selectedModules,
      }, 120_000);

      if (r.type === "SCAN_ERROR") {
        return { content: [{ type: "text", text: `Scan failed: ${r.error}` }] };
      }

      if (r.type === "SCAN_RESULT") {
        return {
          content: [{
            type: "text",
            text: formatFindings(r.findings, url, r.duration),
          }],
        };
      }

      return {
        content: [{ type: "text", text: `Unexpected response: ${JSON.stringify(r)}` }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Scan failed: ${err}` }] };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[Gaze MCP] Server running");
