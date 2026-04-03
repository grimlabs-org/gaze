import type { Finding } from "../shared/types";

const findingsEl = document.getElementById("findings")!;
const statusEl = document.getElementById("status")!;
const emptyEl = document.getElementById("empty")!;

const findings: Finding[] = [];

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "FINDING_ADDED") {
    addFinding(message.finding as Finding);
  }
  if (message.type === "SCAN_STARTED") {
    statusEl.textContent = `Scanning ${message.url}...`;
    findings.length = 0;
    findingsEl.innerHTML = "";
    findingsEl.appendChild(emptyEl);
    emptyEl.textContent = "Scanning...";
  }
  if (message.type === "SCAN_COMPLETE") {
    statusEl.textContent = `${findings.length} findings — ${message.duration}ms`;
    if (findings.length === 0) emptyEl.textContent = "No findings";
  }
});

function addFinding(finding: Finding) {
  findings.push(finding);
  if (emptyEl.parentNode) emptyEl.remove();
  const el = document.createElement("div");
  el.className = "finding";
  el.innerHTML = `
    <div class="dot ${finding.severity}"></div>
    <div>
      <div class="finding-title">${finding.title}</div>
      <div class="finding-meta">${finding.severity.toUpperCase()} · ${finding.category}</div>
    </div>
  `;
  findingsEl.appendChild(el);
}
