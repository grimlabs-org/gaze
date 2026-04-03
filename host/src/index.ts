import { createServer, Socket } from "net";
import { WebSocketServer, WebSocket } from "ws";
import type { HostMessage } from "../../extension/src/shared/types";

const IPC_PATH = process.platform === "win32"
  ? "\\\\.\\pipe\\gaze-mcp"
  : "/tmp/gaze-mcp.sock";

const WS_PORT = 9876;

process.stdin.resume();
process.stdin.on("end", () => process.exit(0));

const pendingRequests = new Map<string, Socket>();
let extensionSocket: WebSocket | null = null;

// ─── Terminal message types — these close the request ─────────────────────────

const TERMINAL_TYPES = new Set([
  "PONG",
  "SCAN_RESULT",
  "SCAN_ERROR",
  "ACTIVE_TAB_RESULT",
  "ACTIVE_TAB_ERROR",
]);

// ─── WebSocket Server (Extension ↔ Host) ─────────────────────────────────────

const wss = new WebSocketServer({ port: WS_PORT });

wss.on("listening", () => {
  console.error(`[Host] WebSocket server listening on ws://localhost:${WS_PORT}`);
});

wss.on("connection", (ws) => {
  console.error("[Host] Extension connected via WebSocket");
  extensionSocket = ws;

  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data.toString()) as HostMessage;
      const type = (message as { type: string }).type;

      if (type === "KEEPALIVE") return;

      console.error("[Host] From extension:", type, message.id);

      const socket = pendingRequests.get(message.id);
      if (!socket) {
        console.error("[Host] No pending request for id:", message.id);
        return;
      }

      if (!socket.destroyed) {
        socket.write(JSON.stringify(message));
      }

      // Only close the socket on terminal messages
      if (TERMINAL_TYPES.has(type)) {
        socket.end();
        pendingRequests.delete(message.id);
      }
    } catch (err) {
      console.error("[Host] WS parse error:", err);
    }
  });

  ws.on("close", () => {
    console.error("[Host] Extension disconnected");
    extensionSocket = null;
  });

  ws.on("error", (err) => {
    console.error("[Host] WS error:", err.message);
  });
});

// ─── IPC Server (MCP ↔ Host) ──────────────────────────────────────────────────

const ipcServer = createServer((socket) => {
  let buffer = "";

  socket.on("data", (data) => {
    buffer += data.toString();
    try {
      const message = JSON.parse(buffer) as HostMessage;
      buffer = "";

      console.error("[Host] From MCP:", message.type, message.id);

      if (message.type === "PING") {
        socket.write(JSON.stringify({ type: "PONG", id: message.id }));
        socket.end();
        return;
      }

      if (!extensionSocket || extensionSocket.readyState !== WebSocket.OPEN) {
        socket.write(JSON.stringify({
          type: "SCAN_ERROR",
          id: message.id,
          error: "Extension not connected.",
        }));
        socket.end();
        return;
      }

      pendingRequests.set(message.id, socket);
      extensionSocket.send(JSON.stringify(message));

      socket.on("close", () => pendingRequests.delete(message.id));

    } catch {
      // Incomplete JSON
    }
  });

  socket.on("error", (err) => {
    console.error("[Host] IPC socket error:", err.message);
  });
});

ipcServer.on("error", (err: NodeJS.ErrnoException) => {
  console.error("[Host] IPC server error:", err.code, err.message);
});

ipcServer.listen(IPC_PATH, () => {
  console.error(`[Host] IPC server listening at ${IPC_PATH}`);
});

console.error("[Host] Started");
