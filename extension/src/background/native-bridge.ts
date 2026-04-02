/**
 * Native Bridge
 * Manages the native messaging connection between the extension
 * and the local host process (MCP server).
 */

import type { HostMessage } from "../shared/types";

type MessageHandler = (message: HostMessage) => void;

export class NativeBridge {
  private port: chrome.runtime.Port | null = null;
  private handlers = new Set<MessageHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly HOST_NAME = "com.gaze.host";

// Connection
  connect(): void {
    if (this.port) return;

    try {
      this.port = chrome.runtime.connectNative(this.HOST_NAME);

      this.port.onMessage.addListener((message: HostMessage) => {
        this.handlers.forEach((h) => h(message));
      });

      this.port.onDisconnect.addListener(() => {
        this.port = null;
        const error = chrome.runtime.lastError?.message ?? "unknown";
        console.warn(`[NativeBridge] Disconnected: ${error}`);
        this.scheduleReconnect();
      });

      console.log("[NativeBridge] Connected to host");
    } catch (err) {
      console.error("[NativeBridge] Connection failed:", err);
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.port) {
      this.port.disconnect();
      this.port = null;
    }
  }

  get isConnected(): boolean {
    return this.port !== null;
  }

// Messaging
  send(message: HostMessage): void {
    if (!this.port) {
      console.warn("[NativeBridge] Cannot send — not connected");
      return;
    }
    this.port.postMessage(message);
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

// Reconnect
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      console.log("[NativeBridge] Attempting reconnect...");
      this.connect();
    }, 3000);
  }
}
