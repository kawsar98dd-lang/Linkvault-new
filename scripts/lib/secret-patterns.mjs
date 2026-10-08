// Dependency-free secret detection used by the repo scanner and the browser-bundle scanner.
// Findings never contain the full secret (only a short prefix) so CI logs stay safe.

export const PLACEHOLDER = /(change[_-]?me|your[_-]|example|placeholder|dummy|xxxx|<[^>]+>|\$\{?[A-Z_]+\}?|password|redacted|not[_-]?set|todo|test-?only|throwaway)/i;

export function shannonEntropy(s) {
  if (!s) return 0;
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const mask = (v) => `${v.slice(0, 4)}…(${v.length} chars)`;

/** @type {{ id: string, re: RegExp, check?: (m: RegExpExecArray) => boolean, group?: number }[]} */
export const RULES = [
  { id: 'private-key', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g },
  { id: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { id: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'stripe-live-key', re: /\b[sr]k_live_[A-Za-z0-9]{16,}\b/g },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'sentry-auth-token', re: /\bsntrys_[A-Za-z0-9+/=_-]{30,}\b/g },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  {
    id: 'database-url-with-credentials',
    re: /\bpostgres(?:ql)?:\/\/([^:\s/@'"`]+):([^@\s'"`]+)@/g,
    check: (m) => !PLACEHOLDER.test(m[2] ?? '') && (m[2] ?? '').length >= 6,
  },
  {
    id: 'cloudflare-token',
    re: /\b(?:CLOUDFLARE|CF)_?(?:API)?_?(?:TOKEN|KEY)\b\s*[:=]\s*['"]?([A-Za-z0-9_-]{37,})['"]?/gi,
    group: 1,
    check: (m) => !PLACEHOLDER.test(m[1] ?? ''),
  },
  {
    id: 'legacy-browser-secret-key',
    re: /\b(?:SECRET_KEY|ADMIN_HASH)\b\s*[:=]\s*['"]([A-Za-z0-9_-]{8,})['"]/g,
    group: 1,
    check: (m) => !PLACEHOLDER.test(m[1] ?? ''),
  },
  { id: 'legacy-LV_SITE-global', re: /\bwindow\.LV_SITE\b|\bLV_SITE\s*=/g },
  {
    id: 'secret-assignment-high-entropy',
    re: /\b[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY|AUTH_KEY)[A-Z0-9_]*\b\s*[:=]\s*['"]([A-Za-z0-9+/_=-]{20,})['"]/g,
    group: 1,
    check: (m) => !PLACEHOLDER.test(m[1] ?? '') && shannonEntropy(m[1] ?? '') >= 3.5,
  },
];

const ALLOW_MARKER = 'secretscan:allow';

/** @returns {{ rule: string, line: number, preview: string }[]} */
export function findSecrets(text, { skipLegacyRules = false } = {}) {
  const findings = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.includes(ALLOW_MARKER) || line.length > 4000) continue;
    for (const rule of RULES) {
      if (skipLegacyRules && rule.id.startsWith('legacy-')) continue;
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(line)) !== null) {
        if (rule.check && !rule.check(m)) continue;
        const secret = rule.group ? (m[rule.group] ?? m[0]) : m[0];
        findings.push({ rule: rule.id, line: i + 1, preview: mask(secret) });
        if (m[0].length === 0) rule.re.lastIndex++;
      }
    }
  }
  return findings;
}
