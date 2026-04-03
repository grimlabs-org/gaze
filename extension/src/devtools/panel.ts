const statusEl = document.getElementById("status")!;

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "OBSERVE_RESULT") {
    statusEl.textContent = `Observation received: ${message.observation.module}`;
  }
});
