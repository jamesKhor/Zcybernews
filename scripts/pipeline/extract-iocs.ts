/**
 * IOC + MITRE TTP extractors — pure regex helpers over article body +
 * cross-checked against source material.
 *
 * Design (2026-04-23 B-023):
 *   - Every extracted IOC MUST also appear in the source material.
 *     Prevents hallucinated IOCs from slipping into frontmatter even
 *     if the LLM invents one in prose. (Same contract post-process.ts
 *     used for hashes + IPs since Phase P-A.)
 *   - "Appears in source" check is normalized (lowercase, whitespace
 *     collapsed) so "CVE-2026-1234" matches "cve-2026-1234" etc.
 *   - Domain / URL / email extraction deliberately EXCLUDES an
 *     allow-list of infrastructure that's almost never the attack's
 *     actual IOC (github.com, cloudflare.com, google.com, etc.). These
 *     appear in legitimate context in nearly every article.
 *   - MITRE technique extractor returns TTPEntry[] with technique_name
 *     looked up from a curated map of the ~80 most common techniques.
 *     Techniques NOT in the map are skipped (cleaner than shipping
 *     entries with empty technique_name).
 *
 * PURE — no fs, no network, no state mutation. Safe to unit-test in
 * isolation and call from both post-process.ts and the backfill
 * script.
 */

import type { IOCEntry, TTPEntry } from "../../lib/types.js";

// ─── Primitive regex ─────────────────────────────────────────────────

const MD5_REGEX = /\b[a-fA-F0-9]{32}\b/g;
const SHA1_REGEX = /\b[a-fA-F0-9]{40}\b/g;
const SHA256_REGEX = /\b[a-fA-F0-9]{64}\b/g;
/** IPv4 with RFC1918 + localhost filtered at use-site (not here). */
const IPV4_REGEX = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
/**
 * Domain regex — simple TLD-anchored hostname. Excludes IPs (distinct
 * pattern), but includes subdomains. Length-capped to avoid pathological
 * matches like "a.b.c.d.e.f...".
 */
const DOMAIN_REGEX =
  /\b(?=[a-z0-9])(?:[a-z0-9-]{1,63}\.){1,4}(?:com|net|org|io|co|ru|cn|ir|kp|uk|de|fr|jp|biz|info|tech|xyz|cloud|app|dev|ai|pro|online|site|store|icu|top|support|live|press|email|mobi)\b/gi;
/** URL — http(s) prefix with a path. Used for C2 / phishing URLs. */
const URL_REGEX = /\bhttps?:\/\/[a-z0-9][a-z0-9.\-]*[a-z0-9]\/[^\s"'<>)]+/gi;
/** Email — RFC-lite, good enough for triage. */
const EMAIL_REGEX =
  /\b[a-z0-9][a-z0-9._%+-]*@[a-z0-9][a-z0-9.\-]*\.[a-z]{2,}\b/gi;
/**
 * MITRE ATT&CK technique ID — TNNNN or TNNNN.NNN (sub-technique).
 * Word-boundary on both sides to avoid matching T1190 inside longer
 * tokens.
 */
const MITRE_TECHNIQUE_REGEX = /\bT\d{4}(?:\.\d{3})?\b/g;

// ─── Allow-list: domains that are ALMOST NEVER the actual IOC ────────
//
// Articles routinely reference legitimate infrastructure in prose
// ("fix available on github.com/vendor/repo", "Cloudflare WAF blocked
// …", "reported via microsoft.com/msrc"). These should NEVER be listed
// as IOCs even if they appear in both body AND source — they're
// context, not indicators.
//
// Case-insensitive exact match on the domain; subdomain of a listed
// domain is also ignored (e.g. "blog.microsoft.com" → skipped).
const DOMAIN_ALLOWLIST = new Set<string>([
  // Code / infra / developer
  "github.com",
  "gitlab.com",
  "bitbucket.org",
  "stackoverflow.com",
  "docker.com",
  "npmjs.com",
  "pypi.org",
  // Major clouds / platforms
  "microsoft.com",
  "google.com",
  "googleusercontent.com",
  "amazon.com",
  "amazonaws.com",
  "azure.com",
  "apple.com",
  "cloudflare.com",
  "cloudflare.net",
  // Security vendors (usually mentioned in prose, not as IOC)
  "bleepingcomputer.com",
  "krebsonsecurity.com",
  "thehackernews.com",
  "cisa.gov",
  "mitre.org",
  "nvd.nist.gov",
  "first.org",
  "schneier.com",
  "darkreading.com",
  "securityweek.com",
  // Social / media
  "twitter.com",
  "x.com",
  "linkedin.com",
  "facebook.com",
  "youtube.com",
  "reddit.com",
  "medium.com",
  "substack.com",
  "wordpress.com",
  // Other common non-IOCs
  "wikipedia.org",
  "archive.org",
  "mozilla.org",
  "wikipedia.com",
]);

/** Returns true if the domain (or any of its parent domains) is on
 *  the allowlist — e.g. "blog.microsoft.com" matches "microsoft.com". */
export function isAllowlistedDomain(domain: string): boolean {
  const lower = domain.toLowerCase();
  if (DOMAIN_ALLOWLIST.has(lower)) return true;
  const parts = lower.split(".");
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join(".");
    if (DOMAIN_ALLOWLIST.has(parent)) return true;
  }
  return false;
}

// ─── MITRE technique name lookup ─────────────────────────────────────
//
// Curated ~80 most-cited techniques. Extending the map is cheap — add
// a row here as new techniques appear in articles.

interface TechniqueDef {
  name: string;
  tactic: string;
}
const MITRE_TECHNIQUES: Record<string, TechniqueDef> = {
  // Initial Access
  T1190: {
    name: "Exploit Public-Facing Application",
    tactic: "Initial Access",
  },
  T1566: { name: "Phishing", tactic: "Initial Access" },
  "T1566.001": { name: "Spearphishing Attachment", tactic: "Initial Access" },
  "T1566.002": { name: "Spearphishing Link", tactic: "Initial Access" },
  T1195: { name: "Supply Chain Compromise", tactic: "Initial Access" },
  T1078: { name: "Valid Accounts", tactic: "Initial Access" },
  T1133: { name: "External Remote Services", tactic: "Initial Access" },
  T1091: {
    name: "Replication Through Removable Media",
    tactic: "Initial Access",
  },

  // Execution
  T1059: { name: "Command and Scripting Interpreter", tactic: "Execution" },
  "T1059.001": { name: "PowerShell", tactic: "Execution" },
  "T1059.003": { name: "Windows Command Shell", tactic: "Execution" },
  "T1059.007": { name: "JavaScript", tactic: "Execution" },
  T1204: { name: "User Execution", tactic: "Execution" },
  T1106: { name: "Native API", tactic: "Execution" },
  T1053: { name: "Scheduled Task/Job", tactic: "Execution" },

  // Persistence
  T1547: { name: "Boot or Logon Autostart Execution", tactic: "Persistence" },
  T1574: { name: "Hijack Execution Flow", tactic: "Persistence" },
  T1543: { name: "Create or Modify System Process", tactic: "Persistence" },
  T1136: { name: "Create Account", tactic: "Persistence" },
  T1505: { name: "Server Software Component", tactic: "Persistence" },

  // Privilege Escalation
  T1068: {
    name: "Exploitation for Privilege Escalation",
    tactic: "Privilege Escalation",
  },
  T1134: { name: "Access Token Manipulation", tactic: "Privilege Escalation" },
  T1055: { name: "Process Injection", tactic: "Privilege Escalation" },

  // Defense Evasion
  T1562: { name: "Impair Defenses", tactic: "Defense Evasion" },
  "T1562.001": { name: "Disable or Modify Tools", tactic: "Defense Evasion" },
  T1070: { name: "Indicator Removal", tactic: "Defense Evasion" },
  T1027: { name: "Obfuscated Files or Information", tactic: "Defense Evasion" },
  T1036: { name: "Masquerading", tactic: "Defense Evasion" },
  T1218: { name: "System Binary Proxy Execution", tactic: "Defense Evasion" },
  T1497: { name: "Virtualization/Sandbox Evasion", tactic: "Defense Evasion" },
  T1140: {
    name: "Deobfuscate/Decode Files or Information",
    tactic: "Defense Evasion",
  },

  // Credential Access
  T1003: { name: "OS Credential Dumping", tactic: "Credential Access" },
  "T1003.001": { name: "LSASS Memory", tactic: "Credential Access" },
  T1555: {
    name: "Credentials from Password Stores",
    tactic: "Credential Access",
  },
  T1110: { name: "Brute Force", tactic: "Credential Access" },
  T1552: { name: "Unsecured Credentials", tactic: "Credential Access" },
  T1558: {
    name: "Steal or Forge Kerberos Tickets",
    tactic: "Credential Access",
  },

  // Discovery
  T1082: { name: "System Information Discovery", tactic: "Discovery" },
  T1083: { name: "File and Directory Discovery", tactic: "Discovery" },
  T1087: { name: "Account Discovery", tactic: "Discovery" },
  T1016: {
    name: "System Network Configuration Discovery",
    tactic: "Discovery",
  },
  T1046: { name: "Network Service Discovery", tactic: "Discovery" },
  T1057: { name: "Process Discovery", tactic: "Discovery" },
  T1018: { name: "Remote System Discovery", tactic: "Discovery" },
  T1518: { name: "Software Discovery", tactic: "Discovery" },

  // Lateral Movement
  T1021: { name: "Remote Services", tactic: "Lateral Movement" },
  "T1021.001": { name: "Remote Desktop Protocol", tactic: "Lateral Movement" },
  "T1021.002": { name: "SMB/Windows Admin Shares", tactic: "Lateral Movement" },
  T1570: { name: "Lateral Tool Transfer", tactic: "Lateral Movement" },

  // Collection
  T1005: { name: "Data from Local System", tactic: "Collection" },
  T1114: { name: "Email Collection", tactic: "Collection" },
  T1056: { name: "Input Capture", tactic: "Collection" },
  T1560: { name: "Archive Collected Data", tactic: "Collection" },

  // Command and Control
  T1071: { name: "Application Layer Protocol", tactic: "Command and Control" },
  "T1071.001": { name: "Web Protocols", tactic: "Command and Control" },
  "T1071.004": { name: "DNS", tactic: "Command and Control" },
  T1090: { name: "Proxy", tactic: "Command and Control" },
  T1572: { name: "Protocol Tunneling", tactic: "Command and Control" },
  T1573: { name: "Encrypted Channel", tactic: "Command and Control" },
  T1105: { name: "Ingress Tool Transfer", tactic: "Command and Control" },
  T1008: { name: "Fallback Channels", tactic: "Command and Control" },

  // Exfiltration
  T1041: { name: "Exfiltration Over C2 Channel", tactic: "Exfiltration" },
  T1567: { name: "Exfiltration Over Web Service", tactic: "Exfiltration" },
  T1048: {
    name: "Exfiltration Over Alternative Protocol",
    tactic: "Exfiltration",
  },

  // Impact
  T1486: { name: "Data Encrypted for Impact", tactic: "Impact" },
  T1490: { name: "Inhibit System Recovery", tactic: "Impact" },
  T1489: { name: "Service Stop", tactic: "Impact" },
  T1485: { name: "Data Destruction", tactic: "Impact" },
  T1491: { name: "Defacement", tactic: "Impact" },
  T1499: { name: "Endpoint Denial of Service", tactic: "Impact" },
};

// ─── Helpers ─────────────────────────────────────────────────────────

function uniqueMatches(text: string, re: RegExp): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const pattern = new RegExp(re.source, re.flags);
  let m;
  while ((m = pattern.exec(text)) !== null) {
    const lower = m[0].toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      out.push(m[0]);
    }
  }
  return out;
}

/** Case-insensitive, whitespace-collapsed substring check. */
function normalizedIncludes(haystack: string, needle: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
  return norm(haystack).includes(norm(needle));
}

function isPrivateOrLoopbackIp(ip: string): boolean {
  if (ip === "127.0.0.1" || ip.startsWith("0.")) return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  // 172.16.0.0/12
  const m = ip.match(/^172\.(\d+)\./);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 16 && n <= 31) return true;
  }
  return false;
}

// ─── Public extractor ────────────────────────────────────────────────

export interface ExtractIocsInput {
  body: string;
  sourceText: string;
  /** Pre-existing IOCs (e.g. from LLM output) to merge with regex results. */
  existing?: IOCEntry[];
}

/**
 * Extract IOCs from body + cross-check against source text. Existing
 * IOCs (types we don't extract via regex — file_path, registry_key —
 * or manually-curated entries) are preserved; duplicates dedup by
 * normalized value.
 */
export function extractIocs(input: ExtractIocsInput): IOCEntry[] {
  const { body, sourceText, existing = [] } = input;
  const verified: IOCEntry[] = [];
  const seen = new Set<string>();

  const push = (entry: IOCEntry) => {
    const key = `${entry.type}:${entry.value.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    verified.push(entry);
  };

  // Hashes
  for (const h of uniqueMatches(body, MD5_REGEX)) {
    if (normalizedIncludes(sourceText, h))
      push({
        type: "hash_md5",
        value: h,
        confidence: "high",
        description: "Extracted from source material",
      });
  }
  for (const h of uniqueMatches(body, SHA1_REGEX)) {
    if (normalizedIncludes(sourceText, h))
      push({
        type: "hash_sha1",
        value: h,
        confidence: "high",
        description: "Extracted from source material",
      });
  }
  for (const h of uniqueMatches(body, SHA256_REGEX)) {
    if (normalizedIncludes(sourceText, h))
      push({
        type: "hash_sha256",
        value: h,
        confidence: "high",
        description: "Extracted from source material",
      });
  }

  // IPv4 (public only)
  for (const ip of uniqueMatches(body, IPV4_REGEX)) {
    if (isPrivateOrLoopbackIp(ip)) continue;
    if (normalizedIncludes(sourceText, ip))
      push({
        type: "ip",
        value: ip,
        confidence: "high",
        description: "Extracted from source material",
      });
  }

  // Domains (allowlist filters out common non-IOC mentions)
  for (const d of uniqueMatches(body, DOMAIN_REGEX)) {
    if (isAllowlistedDomain(d)) continue;
    if (normalizedIncludes(sourceText, d))
      push({
        type: "domain",
        value: d,
        confidence: "medium",
        description: "Extracted from source material",
      });
  }

  // URLs — keep only those whose domain is NOT allowlisted
  for (const url of uniqueMatches(body, URL_REGEX)) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (isAllowlistedDomain(host)) continue;
      if (normalizedIncludes(sourceText, url))
        push({
          type: "url",
          value: url,
          confidence: "medium",
          description: "Extracted from source material",
        });
    } catch {
      // malformed URL, skip
    }
  }

  // Emails — skip obvious vendor / security-org addresses
  for (const e of uniqueMatches(body, EMAIL_REGEX)) {
    const host = e.split("@")[1]?.toLowerCase() ?? "";
    if (isAllowlistedDomain(host)) continue;
    if (normalizedIncludes(sourceText, e))
      push({
        type: "email",
        value: e,
        confidence: "medium",
        description: "Extracted from source material",
      });
  }

  // Preserve pre-existing IOCs of types we don't regex (file_path,
  // registry_key). Dedup by type+value.
  for (const prior of existing) {
    if (prior.type === "file_path" || prior.type === "registry_key") {
      push(prior);
    }
  }

  return verified;
}

// ─── MITRE TTP extractor ─────────────────────────────────────────────

export interface ExtractTtpsInput {
  body: string;
  existing?: TTPEntry[];
}

/**
 * Extract MITRE ATT&CK technique IDs from body. Each matched ID is
 * mapped to a TTPEntry via the curated MITRE_TECHNIQUES lookup.
 * Unknown technique IDs are skipped (we don't want empty
 * technique_name fields in frontmatter). Existing LLM-provided entries
 * are preserved if they carry a name — they may reference a technique
 * we haven't added to the lookup yet.
 */
export function extractTtps(input: ExtractTtpsInput): TTPEntry[] {
  const { body, existing = [] } = input;
  const matched: TTPEntry[] = [];
  const seen = new Set<string>();

  for (const rawId of uniqueMatches(body, MITRE_TECHNIQUE_REGEX)) {
    const id = rawId.toUpperCase();
    if (seen.has(id)) continue;
    const def = MITRE_TECHNIQUES[id];
    if (!def) continue; // skip unknown techniques rather than emit empty-name entries
    seen.add(id);
    matched.push({
      tactic: def.tactic,
      technique_id: id,
      technique_name: def.name,
    });
  }

  // Preserve existing LLM entries that reference techniques not in our
  // lookup (they carry their own technique_name).
  for (const prior of existing) {
    if (!prior.technique_id) continue;
    const normalized = prior.technique_id.toUpperCase();
    if (seen.has(normalized)) continue;
    if (!prior.technique_name) continue;
    seen.add(normalized);
    matched.push({ ...prior, technique_id: normalized });
  }

  // Sort by tactic (ATT&CK kill-chain order) then technique_id for stable output.
  const TACTIC_ORDER = [
    "Initial Access",
    "Execution",
    "Persistence",
    "Privilege Escalation",
    "Defense Evasion",
    "Credential Access",
    "Discovery",
    "Lateral Movement",
    "Collection",
    "Command and Control",
    "Exfiltration",
    "Impact",
  ];
  matched.sort((a, b) => {
    const ai = TACTIC_ORDER.indexOf(a.tactic ?? "");
    const bi = TACTIC_ORDER.indexOf(b.tactic ?? "");
    if (ai !== bi) return ai - bi;
    return (a.technique_id ?? "").localeCompare(b.technique_id ?? "");
  });

  return matched;
}

// Export regex + lookup for tests + introspection
export const _internals = {
  MD5_REGEX,
  SHA1_REGEX,
  SHA256_REGEX,
  IPV4_REGEX,
  DOMAIN_REGEX,
  URL_REGEX,
  EMAIL_REGEX,
  MITRE_TECHNIQUE_REGEX,
  MITRE_TECHNIQUES,
  DOMAIN_ALLOWLIST,
};
