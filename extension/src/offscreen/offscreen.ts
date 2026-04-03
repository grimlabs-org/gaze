/**
 * Offscreen Document
 * Holds a persistent WebSocket connection to the host process.
 * Relays messages between the host and the service worker.
 */

const WS_URL = "ws://localhost:9876";
const RECONNECT_DELAY = 3000;

let ws: WebSocket | null = null;

function connect(): void {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log("[Offscreen] Connected to host");
    chrome.runtime.sendMessage({ type: "HOST_CONNECTED" });
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      console.log("[Offscreen] Received from host:", message.type, message.id);
      // Forward to service worker
      chrome.runtime.sendMessage({ type: "FROM_HOST", payload: message });
    } catch (err) {
      console.error("[Offscreen] Parse error:", err);
    }
  };

  ws.onclose = () => {
    console.log("[Offscreen] Disconnected — reconnecting...");
    chrome.runtime.sendMessage({ type: "HOST_DISCONNECTED" });
    ws = null;
    setTimeout(connect, RECONNECT_DELAY);
  };

  ws.onerror = (err) => {
    console.error("[Offscreen] WebSocket error:", err);
  };
}

// Listen for messages from service worker to forward to host
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "TO_HOST") {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message.payload));
    } else {
      console.warn("[Offscreen] Cannot send — not connected");
    }
  }
});

connect();
