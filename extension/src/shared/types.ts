// ─── Severity ─────────────────────────────────────────────────────────────────

export type Severity = "critical" | "high" | "medium" | "low" | "info";

// ─── Findings ─────────────────────────────────────────────────────────────────

export type FindingCategory =
  | "dom"
  | "storage"
  | "memory"
  | "network"
  | "prototype"
  | "fingerprint";

export type FindingStatus = "open" | "confirmed" | "false_positive";

export interface Evidence {
  type: "code" | "text" | "network" | "heap";
  label: string;
  content: string;
}

export interface Finding {
  id: string;
  title: string;
  description: string;
  category: FindingCategory;
  severity: Severity;
  evidence: Evidence[];
  remediations: string[];
  status: FindingStatus;
  timestamp: number;
  url: string;
}

// ─── Scan ─────────────────────────────────────────────────────────────────────

export type ModuleId =
  | "dom"
  | "storage"
  | "memory"
  | "network"
  | "prototype"
  | "fingerprint";

export type ModuleStatus = "idle" | "running" | "complete" | "error";

export interface ModuleState {
  id: ModuleId;
  label: string;
  status: ModuleStatus;
  findingCount: number;
  error?: string;
}

export type ScanStatus =
  | "idle"
  | "attaching"
  | "running"
  | "complete"
  | "error";

export interface ScanState {
  status: ScanStatus;
  targetUrl: string;
  startedAt?: number;
  completedAt?: number;
  modules: Record<ModuleId, ModuleState>;
  error?: string;
}

// ─── Host Messages ────────────────────────────────────────────────────────────

export type HostMessageType =
  | "SCAN_REQUEST"
  | "SCAN_RESULT"
  | "MODULE_RESULT"
  | "SCAN_ERROR"
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

export interface ScanRequestMessage extends BaseHostMessage {
  type: "SCAN_REQUEST";
  tabId: number;
  url: string;
  modules: ModuleId[];
}

export interface ModuleResultMessage extends BaseHostMessage {
  type: "MODULE_RESULT";
  moduleId: ModuleId;
  findings: Finding[];
}

export interface ScanResultMessage extends BaseHostMessage {
  type: "SCAN_RESULT";
  findings: Finding[];
  duration: number;
}

export interface ScanErrorMessage extends BaseHostMessage {
  type: "SCAN_ERROR";
  error: string;
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

export type HostMessage =
  | PingMessage
  | PongMessage
  | ScanRequestMessage
  | ModuleResultMessage
  | ScanResultMessage
  | ScanErrorMessage
  | GetActiveTabMessage
  | ActiveTabResultMessage
  | ActiveTabErrorMessage;

// ─── Page Brief ───────────────────────────────────────────────────────────────

export interface PageBrief {
  url: string;
  scannedAt: string;
  duration: number;
  techStack: string[];
  summary: Record<Severity, number>;
  findings: Finding[];
}
