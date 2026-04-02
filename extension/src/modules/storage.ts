import type { Finding, Evidence } from "../shared/types";
import { scanString, isSuspiciousKey } from "../shared/patterns";
import type { CdpBridge } from "../background/cdp-bridge";

let _id = 0;
const id = () => `storage-${Date.now()}-${_id++}`;

function evidence(type: Evidence["type"], label: string, content: string): Evidence {
  return { type, label, content };
}

export async function runStorageAudit(
  bridge: CdpBridge,
  url: string
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const isHttps = url.startsWith("https://");

  await bridge.enableNetwork();

  const [cookies, local, session] = await Promise.all([
    bridge.getCookies(),
    bridge.getLocalStorage(),
    bridge.getSessionStorage(),
  ]);

  // ── Cookies ────────────────────────────────────────────────────────────────

  for (const cookie of cookies) {
    const c = cookie as unknown as {
      name: string; value: string; domain: string;
      secure: boolean; httpOnly: boolean; sameSite?: string;
    };

    if (isHttps && !c.secure) {
      findings.push({
        id: id(), title: `Cookie missing Secure flag: ${c.name}`,
        description: `Cookie "${c.name}" is served over HTTPS but lacks the Secure flag.`,
        category: "storage", severity: "medium", status: "open",
        evidence: [evidence("text", "Cookie", `Name: ${c.name}\nDomain: ${c.domain}\nSecure: false`)],
        remediations: ["Add the Secure flag: Set-Cookie: name=value; Secure"],
        timestamp: Date.now(), url,
      });
    }

    if (!c.httpOnly && isSuspiciousKey(c.name)) {
      findings.push({
        id: id(), title: `Auth cookie missing HttpOnly: ${c.name}`,
        description: `Cookie "${c.name}" appears to be an auth token but lacks HttpOnly — readable via XSS.`,
        category: "storage", severity: "high", status: "open",
        evidence: [evidence("text", "Cookie", `Name: ${c.name}\nHttpOnly: false`)],
        remediations: ["Add HttpOnly flag to all session/auth cookies."],
        timestamp: Date.now(), url,
      });
    }

    const sameSite = (c.sameSite ?? "").toLowerCase();
    if (!sameSite) {
      findings.push({
        id: id(), title: `Cookie missing SameSite: ${c.name}`,
        description: `Cookie "${c.name}" has no SameSite attribute — vulnerable to CSRF.`,
        category: "storage", severity: "medium", status: "open",
        evidence: [evidence("text", "Cookie", `Name: ${c.name}\nSameSite: not set`)],
        remediations: ["Set SameSite=Strict or SameSite=Lax on all cookies."],
        timestamp: Date.now(), url,
      });
    }

    for (const match of scanString(c.value)) {
      findings.push({
        id: id(), title: `${match.label} in cookie: ${c.name}`,
        description: `Cookie "${c.name}" contains a pattern matching ${match.label}.`,
        category: "storage", severity: match.severity, status: "open",
        evidence: [evidence("text", "Match", `Pattern: ${match.label}\nRedacted: ${match.redacted}`)],
        remediations: ["Never store raw secrets in cookies.", "Rotate the exposed credential immediately."],
        timestamp: Date.now(), url,
      });
    }
  }

  // ── localStorage / sessionStorage ──────────────────────────────────────────

  for (const [store, data] of [["localStorage", local], ["sessionStorage", session]] as const) {
    for (const [key, value] of Object.entries(data)) {
      if (isSuspiciousKey(key)) {
        findings.push({
          id: id(), title: `Sensitive key in ${store}: "${key}"`,
          description: `${store} contains "${key}" — accessible to all JS on this origin including via XSS.`,
          category: "storage", severity: "medium", status: "open",
          evidence: [evidence("code", `${store}["${key}"]`, `Key: ${key}\nValue (preview): ${value.slice(0, 80)}`)],
          remediations: ["Store auth tokens in HttpOnly cookies instead of client-side storage."],
          timestamp: Date.now(), url,
        });
      }

      for (const match of scanString(value)) {
        findings.push({
          id: id(), title: `${match.label} in ${store}["${key}"]`,
          description: `Value of ${store} key "${key}" matches ${match.label}.`,
          category: "storage", severity: match.severity, status: "open",
          evidence: [evidence("code", "Match", `Store: ${store}\nKey: ${key}\nRedacted: ${match.redacted}`)],
          remediations: ["Never store secrets in client-side storage.", "Rotate the exposed credential."],
          timestamp: Date.now(), url,
        });
      }
    }
  }

  return findings;
}
