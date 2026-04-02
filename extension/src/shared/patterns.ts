//  Pattern Definitions 

export interface PatternDef {
  id: string;
  label: string;
  pattern: RegExp;
  severity: "critical" | "high" | "medium";
  redact: (match: string) => string;
}

const redactMiddle = (match: string): string => {
  if (match.length <= 8) return "****";
  return match.slice(0, 4) + "****" + match.slice(-4);
};

export const PATTERNS: PatternDef[] = [
  {
    id: "jwt",
    label: "JSON Web Token",
    pattern: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
    severity: "high",
    redact: (m) => m.slice(0, 20) + "...[JWT REDACTED]",
  },
  {
    id: "anthropic_key",
    label: "Anthropic API Key",
    pattern: /sk-ant-[a-zA-Z0-9_-]{40,}/g,
    severity: "critical",
    redact: redactMiddle,
  },
  {
    id: "openai_key",
    label: "OpenAI API Key",
    pattern: /sk-[a-zA-Z0-9]{48}/g,
    severity: "critical",
    redact: redactMiddle,
  },
  {
    id: "aws_access_key",
    label: "AWS Access Key ID",
    pattern: /(?:ASIA|AKIA|AIPA|AROA|ANPA|ANVA|APKA)[A-Z0-9]{16}/g,
    severity: "critical",
    redact: redactMiddle,
  },
  {
    id: "github_token",
    label: "GitHub Personal Access Token",
    pattern: /ghp_[a-zA-Z0-9]{36}/g,
    severity: "critical",
    redact: redactMiddle,
  },
  {
    id: "github_oauth",
    label: "GitHub OAuth Token",
    pattern: /gho_[a-zA-Z0-9]{36}/g,
    severity: "critical",
    redact: redactMiddle,
  },
  {
    id: "stripe_secret",
    label: "Stripe Secret Key",
    pattern: /sk_live_[a-zA-Z0-9]{24,}/g,
    severity: "critical",
    redact: redactMiddle,
  },
  {
    id: "stripe_pub",
    label: "Stripe Publishable Key (live)",
    pattern: /pk_live_[a-zA-Z0-9]{24,}/g,
    severity: "medium",
    redact: redactMiddle,
  },
  {
    id: "google_api_key",
    label: "Google API Key",
    pattern: /AIza[0-9A-Za-z_-]{35}/g,
    severity: "high",
    redact: redactMiddle,
  },
  {
    id: "credit_card",
    label: "Credit Card Number",
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
    severity: "critical",
    redact: (m) => m.slice(0, 4) + " **** **** " + m.slice(-4),
  },
  {
    id: "bearer_token",
    label: "Bearer Token",
    pattern: /Bearer\s+([a-zA-Z0-9_-]{20,})/g,
    severity: "high",
    redact: () => "Bearer [REDACTED]",
  },
  {
    id: "private_key",
    label: "Private Key (PEM)",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    severity: "critical",
    redact: () => "-----BEGIN PRIVATE KEY----- [REDACTED]",
  },
];

// Scanner 

export interface PatternMatch {
  patternId: string;
  label: string;
  match: string;
  redacted: string;
  index: number;
  severity: "critical" | "high" | "medium";
}

export function scanString(input: string): PatternMatch[] {
  const results: PatternMatch[] = [];

  for (const def of PATTERNS) {
    def.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = def.pattern.exec(input)) !== null) {
      results.push({
        patternId: def.id,
        label: def.label,
        match: match[0],
        redacted: def.redact(match[0]),
        index: match.index,
        severity: def.severity,
      });
      if (match[0].length === 0) def.pattern.lastIndex++;
    }

    def.pattern.lastIndex = 0;
  }

  return results;
}

// Suspicious Key Names 

const SUSPICIOUS_FRAGMENTS = [
  "token", "secret", "api_key", "apikey", "password", "passwd",
  "auth", "credential", "private", "access_key", "session",
  "jwt", "bearer", "oauth", "refresh", "id_token", "key",
];

export function isSuspiciousKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SUSPICIOUS_FRAGMENTS.some((f) => lower.includes(f));
}
