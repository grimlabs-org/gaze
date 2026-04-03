// ─── Module IDs ───────────────────────────────────────────────────────────────

export type ModuleId =
  | "url"
  | "headers"
  | "dom"
  | "scripts"
  | "storage"
  | "network"
  | "memory"
  | "prototype"
  | "csp"
  | "fingerprint";

// ─── Observation Data Shapes ──────────────────────────────────────────────────

export interface UrlData {
  raw: string;
  protocol: string;
  hostname: string;
  port: string | null;
  pathname: string;
  params: Array<{ key: string; value: string }>;
  fragment: string | null;
  isHttps: boolean;
}

export interface HeadersData {
  request: Array<{ name: string; value: string }>;
  response: Array<{ name: string; value: string }>;
  statusCode: number;
  remoteAddress: string;
  protocol: string;
}

export interface DomData {
  forms: Array<{
    action: string;
    method: string;
    enctype: string;
    fields: Array<{
      name: string;
      type: string;
      autocomplete: string;
      value?: string;
    }>;
  }>;
  iframes: Array<{
    src: string;
    sandbox: string | null;
    allow: string | null;
  }>;
  inlineHandlers: Array<{
    element: string;
    event: string;
    code: string;
  }>;
  scripts: Array<{
    src: string | null;
    inline: boolean;
    integrity: string | null;
    crossorigin: string | null;
  }>;
  comments: string[];
  metaTags: Array<{ name: string; content: string }>;
  links: Array<{ rel: string; href: string }>;
}

export interface ScriptsData {
  windowProperties: Array<{ key: string; type: string; preview: string }>;
  sourceMaps: string[];
  serviceWorkers: Array<{
    scriptUrl: string;
    scope: string;
    state: string;
  }>;
  evalUsage: boolean;
  postMessageHandlers: number;
}

export interface CookieEntry {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  expires: number | null;
  session: boolean;
  size: number;
}

export interface StorageData {
  cookies: CookieEntry[];
  localStorage: Array<{ key: string; value: string; size: number }>;
  sessionStorage: Array<{ key: string; value: string; size: number }>;
  indexedDB: Array<{
    name: string;
    version: number;
    objectStores: string[];
  }>;
  cacheStorage: Array<{ name: string; urls: string[] }>;
}

export interface NetworkRequest {
  url: string;
  method: string;
  resourceType: string;
  requestHeaders: Array<{ name: string; value: string }>;
  responseStatus: number;
  responseHeaders: Array<{ name: string; value: string }>;
  timing: number;
  initiator: string;
  size: number;
}

export interface NetworkData {
  requests: NetworkRequest[];
  webSockets: Array<{ url: string; protocol: string }>;
  blockedRequests: Array<{ url: string; reason: string }>;
}

export interface MemoryData {
  strings: Array<{ value: string; length: number; occurrences: number }>;
  summary: {
    totalNodes: number;
    totalSize: number;
    stringCount: number;
  };
}

export interface PrototypeData {
  objectProto: Array<{ key: string; type: string; enumerable: boolean }>;
  arrayProto: Array<{ key: string; type: string; enumerable: boolean }>;
  functionProto: Array<{ key: string; type: string; enumerable: boolean }>;
  additions: string[];
}

export interface CspData {
  raw: string | null;
  present: boolean;
  directives: Record<string, string[]>;
  reportUri: string | null;
  reportTo: string | null;
}

export interface FingerprintData {
  globals: Array<{ name: string; value: string }>;
  scriptUrls: string[];
  responseHeaders: Array<{ name: string; value: string }>;
  metaTags: Array<{ name: string; content: string }>;
  htmlSignatures: string[];
}

export type ModuleData =
  | UrlData
  | HeadersData
  | DomData
  | ScriptsData
  | StorageData
  | NetworkData
  | MemoryData
  | PrototypeData
  | CspData
  | FingerprintData;

export interface Observation {
  module: ModuleId;
  collectedAt: number;
  url: string;
  data: ModuleData;
}

// ─── Host Messages ────────────────────────────────────────────────────────────

export type HostMessageType =
  | "OBSERVE_REQUEST"
  | "OBSERVE_RESULT"
  | "OBSERVE_ERROR"
  | "PING"
  | "PONG"
  | "GET_ACTIVE_TAB"
  | "ACTIVE_TAB_RESULT"
  | "ACTIVE_TAB_ERROR";

export interface BaseHostMessage {
  type: HostMessageType;
  id: string;
}

export interface PingMessage extends BaseHostMessage {
  type: "PING";
}

export interface PongMessage extends BaseHostMessage {
  type: "PONG";
}

export interface GetActiveTabMessage extends BaseHostMessage {
  type: "GET_ACTIVE_TAB";
}

export interface ActiveTabResultMessage extends BaseHostMessage {
  type: "ACTIVE_TAB_RESULT";
  tabId: number;
  url: string;
  title: string;
}

export interface ActiveTabErrorMessage extends BaseHostMessage {
  type: "ACTIVE_TAB_ERROR";
  error: string;
}

export interface ObserveRequestMessage extends BaseHostMessage {
  type: "OBSERVE_REQUEST";
  tabId: number;
  url: string;
  module: ModuleId;
  options?: Record<string, unknown>;
}

export interface ObserveResultMessage extends BaseHostMessage {
  type: "OBSERVE_RESULT";
  observation: Observation;
}

export interface ObserveErrorMessage extends BaseHostMessage {
  type: "OBSERVE_ERROR";
  module: ModuleId;
  error: string;
}

export type HostMessage =
  | PingMessage
  | PongMessage
  | GetActiveTabMessage
  | ActiveTabResultMessage
  | ActiveTabErrorMessage
  | ObserveRequestMessage
  | ObserveResultMessage
  | ObserveErrorMessage;
