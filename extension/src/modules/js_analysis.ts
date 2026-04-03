import type { JsAnalysisData, JsScript } from "../shared/types";
import type { CdpBridge } from "../background/cdp-bridge";

const MAX_SCRIPT_SIZE = 200_000; // 200KB per script
const MAX_SCRIPTS = 30;

// Patterns to extract from JS source
const API_ENDPOINT_RE = /['"`](\/api\/[^'"`\s]{3,}|https?:\/\/[^'"`\s]{10,}\/api[^'"`\s]*)[`'"]/g;
const DANGEROUS_SINKS = [
  { type: "eval", re: /\beval\s*\(/ },
  { type: "innerHTML", re: /\.innerHTML\s*=/ },
  { type: "outerHTML", re: /\.outerHTML\s*=/ },
  { type: "document.write", re: /document\.write\s*\(/ },
  { type: "insertAdjacentHTML", re: /\.insertAdjacentHTML\s*\(/ },
  { type: "dangerouslySetInnerHTML", re: /dangerouslySetInnerHTML/ },
  { type: "Function constructor", re: /new\s+Function\s*\(/ },
  { type: "setTimeout string", re: /setTimeout\s*\(\s*['"`]/ },
];
const AUTH_PATTERNS = [
  { type: "Authorization header", re: /['"](Authorization|authorization)['"]\s*[:=]/ },
  { type: "Bearer token", re: /Bearer\s+/ },
  { type: "JWT decode", re: /atob\s*\(|jwt|jwtDecode/ },
  { type: "API key param", re: /[?&](api_key|apikey|access_token|token)=/i },
];
const ROLE_CHECK_RE = /\b(role|permission|isAdmin|isAuthenticated|canAccess|hasPermission|authorize)\b/g;
const HARDCODED_RE = /(?:password|secret|key|token|credential)\s*[:=]\s*['"`][^'"`]{8,}[`'"]/gi;

export async function observeJsAnalysis(
  bridge: CdpBridge,
  _url: string,
  options?: Record<string, unknown>
): Promise<JsAnalysisData> {
  const durationMs = (options?.durationMs as number) ?? 8_000;
  const scriptMap = new Map<string, { url: string }>();

  await bridge.send("Debugger.enable");

  // Collect script IDs as they are parsed
  const off = bridge.onEvent((method, params) => {
    if (method === "Debugger.scriptParsed") {
      const p = params as { scriptId: string; url: string };
      if (p.url && !p.url.startsWith("chrome-extension://")) {
        scriptMap.set(p.scriptId, { url: p.url });
      }
    }
  });

  await new Promise(resolve => setTimeout(resolve, durationMs));
  off();

  // Fetch source for each script
  const scripts: JsScript[] = [];
  const scriptEntries = [...scriptMap.entries()].slice(0, MAX_SCRIPTS);

  for (const [scriptId, { url }] of scriptEntries) {
    try {
      const result = await bridge.send<{ scriptSource: string }>(
        "Debugger.getScriptSource",
        { scriptId }
      );
      const source = result.scriptSource.slice(0, MAX_SCRIPT_SIZE);
      scripts.push({ scriptId, url, source, size: result.scriptSource.length });
    } catch {
      // Script may have been GC'd
    }
  }

  // Analyse all sources
  const apiEndpoints = new Set<string>();
  const dangerousSinks: JsAnalysisData["dangerousSinks"] = [];
  const authPatterns: JsAnalysisData["authPatterns"] = [];
  const roleChecks: JsAnalysisData["roleChecks"] = [];
  const hardcodedStrings: JsAnalysisData["hardcodedStrings"] = [];

  for (const script of scripts) {
    const { source, url: scriptUrl } = script;

    // API endpoints
    let m: RegExpExecArray | null;
    API_ENDPOINT_RE.lastIndex = 0;
    while ((m = API_ENDPOINT_RE.exec(source)) !== null) {
      apiEndpoints.add(m[1]);
    }

    // Dangerous sinks
    for (const { type, re } of DANGEROUS_SINKS) {
      if (re.test(source)) {
        const idx = source.search(re);
        dangerousSinks.push({
          type,
          context: source.slice(Math.max(0, idx - 50), idx + 100),
          scriptUrl,
        });
      }
    }

    // Auth patterns
    for (const { type, re } of AUTH_PATTERNS) {
      if (re.test(source)) {
        const idx = source.search(re);
        authPatterns.push({
          type,
          context: source.slice(Math.max(0, idx - 30), idx + 100),
          scriptUrl,
        });
      }
    }

    // Role checks
    ROLE_CHECK_RE.lastIndex = 0;
    while ((m = ROLE_CHECK_RE.exec(source)) !== null) {
      roleChecks.push({
        context: source.slice(Math.max(0, m.index - 50), m.index + 100),
        scriptUrl,
      });
      if (roleChecks.length >= 20) break;
    }

    // Hardcoded credentials
    HARDCODED_RE.lastIndex = 0;
    while ((m = HARDCODED_RE.exec(source)) !== null) {
      hardcodedStrings.push({ value: m[0].slice(0, 200), scriptUrl });
      if (hardcodedStrings.length >= 20) break;
    }
  }

  return {
    scripts: scripts.map(s => ({ ...s, source: s.source.slice(0, 5000) })),
    apiEndpoints: [...apiEndpoints].slice(0, 100),
    dangerousSinks: dangerousSinks.slice(0, 30),
    authPatterns: authPatterns.slice(0, 30),
    roleChecks: roleChecks.slice(0, 30),
    hardcodedStrings: hardcodedStrings.slice(0, 20),
  };
}
