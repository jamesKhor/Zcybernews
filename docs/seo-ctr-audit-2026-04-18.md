# SEO CTR + Meta Description Audit — 2026-04-18

**Owner:** Maya (Commercial Marketing Lead)
**Data source:** Google Search Console, last 90 days, pulled 2026-04-18
**Scope:** Top 10 queries by impressions/clicks

---

## 1. Executive summary

We rank. We don't convert the click. Average position 7.5 should pull **3–5% CTR** at baseline; we're at **0.8%**. That's ~75% of expected SERP demand leaking on the way from impression to click. One query ("adaptavist breach") converts at 18% — same position band, same site, same design — because the title and excerpt promise a specific named outcome ("source code stolen", "NASA and Visa"). The other nine read like wire-copy summaries: generic verbs ("addresses", "enable", "patches"), no stakes, no numbers, no reason to click over the BleepingComputer result two slots above us. Fix is upstream: a **10-article hand-patch today** to stop the bleeding, a **prompt change this week** so every new article ships with click-optimized excerpts, then measure CTR weekly against a 2.5% target by 2026-05-16. At current ramp (~1.2K impressions/day) a 0.8% → 2.5% lift is ~20 extra clicks/day — ~600/month — at zero marginal CAC.

---

## 2. Top-10 query audit

Format per row: **query → URL → current title/excerpt → score → rewrite**.

Scoring rubric (1–5):

- **T** = Title intent-match + specificity
- **E** = Excerpt stakes + numbers + CTA-implied
- Totals ≤5 are the reason we lose the click.

---

### 2.1 `adaptavist breach` — 2 clicks / 11 imp / **18% CTR** (CONTROL — do not touch)

- **URL:** `/en/articles/2026-04-14-thegentlemen-ransomware-breaches-adaptavist-source-code-stol`
- **Title:** "TheGentlemen Ransomware Breaches Adaptavist, Source Code Stolen"
- **Excerpt:** "TheGentlemen ransomware group claims a total infrastructure breach of Atlassian partner Adaptavist, stealing source code and customer data from clients like NASA and Visa."
- **Score:** T=5, E=5. **This is our template.** Named actor. Named victim. Specific payload ("source code"). Name-brand downstream victims ("NASA and Visa"). Concrete stakes.
- **Action:** none. Study it.

---

### 2.2 `orthanc dicom rce` — 0 clicks / 27 imp / **0% CTR** (PRIORITY — highest missed demand)

- **URL:** `/en/articles/2026-04-13-orthanc-dicom-vulnerabilities-dos-info-disclosure-rce`
- **Title (60ch):** "Orthanc DICOM Vulnerabilities Allow DoS, Info Disclosure, RCE" — 60ch, OK
- **Excerpt (90ch):** "Multiple vulnerabilities in Orthanc DICOM server enable DoS, info disclosure, and RCE attacks. Patch immediately."
- **Score:** T=3 (acronym-heavy, no CVE), E=2 (no CVE, no version, no sector, "patch immediately" is lazy). Searcher is a healthcare IT admin or DFIR analyst — they want CVE IDs and affected versions on the SERP.
- **Rewrite:**
  - Title: `Orthanc DICOM Server: CVE-2023-26012 Enables Pre-Auth RCE on Medical Imaging` (90ch — trim to 60: `Orthanc DICOM CVE-2023-26012: Pre-Auth RCE on Imaging Servers`) — **59ch**
  - Excerpt: `Three flaws in Orthanc DICOM server let unauthenticated attackers crash, read, or take over hospital imaging systems. Affected versions and patch details inside.` — **155ch**

---

### 2.3 `capsule security series a april 2026` — 0 clicks / 17 imp / **0% CTR**

- **URL:** `/en/articles/2026-04-15-capsule-security-emerges-from-stealth-with-platform-to-constrain-ai-agent-action`
- **Title:** "Capsule Security Emerges from Stealth with Platform to Constrain AI Agent" — 74ch, **truncated in SERP** and title cuts mid-sentence
- **Excerpt (180ch):** "Capsule Security launches with $7M in seed funding for a platform designed to enforce security policies on AI agents, preventing data exfiltration, unauthorized actions, and manipulation via prompt injection."
- **Score:** T=2 (truncated + ends at "AI Agent"), E=3 (has $7M, but buries lede + runs long). Query specifically asks "series a" — we said "seed". That's a factual demand mismatch: searchers bounce back when the snippet contradicts the query.
- **Rewrite:**
  - Title: `Capsule Security Exits Stealth with $7M Seed to Lock Down AI Agents` — **59ch**
  - Excerpt: `Capsule Security launches with $7M seed funding and a policy platform that blocks prompt injection, data exfiltration, and rogue actions by enterprise AI agents.` — **155ch**

---

### 2.4 `kb5082200` — 0 clicks / 17 imp / **0% CTR**

- **URL:** `/en/articles/2026-04-14-microsoft-patches-zero-days-windows-10-extended-security-update`
- **Title:** "Microsoft Patches Two Zero-Days in Final Windows 10 Extended Security Update" — 76ch, **truncated**, and KB number is absent from title
- **Excerpt:** "Microsoft's final extended security update for Windows 10, KB5082200, patches two zero-day vulnerabilities exploited in the wild, alongside other critical fixes for unsupported systems."
- **Score:** T=2 (query is literal KB number; title omits it until after truncation), E=4 (KB present, "two zero-days exploited in the wild" is strong). The title is the bug — KB-number searchers are admins copy-pasting from a patch console and they scan for the exact string.
- **Rewrite:**
  - Title: `KB5082200: Final Windows 10 ESU Patches Two Active Zero-Days` — **60ch**
  - Excerpt: `KB5082200 is Microsoft's last Windows 10 extended security update — it fixes two zero-days under active exploitation plus other critical flaws for unsupported systems.` — **160ch** (trim: drop "under"→"being"; or cut tail)
  - Excerpt (final, 155ch): `KB5082200 is Microsoft's last Windows 10 ESU patch. It fixes two zero-days already being exploited in the wild, plus critical flaws for unsupported systems.`

---

### 2.5 `microsoft adds windows protections for malicious remote desktop files` — 0 clicks / 13 imp / **0% CTR**

- **URL:** `/en/articles/2026-04-14-microsoft-windows-protections-malicious-rdp-files`
- **Title:** "Microsoft Bolsters Windows Defenses Against Malicious RDP File Attacks" — 70ch, borderline truncated
- **Excerpt:** "Windows now blocks untrusted .rdp files by default to stop Storm-1977-style phishing that steals credentials — what changed in the OS, what admins still need to configure, and how to tell if you were targeted."
- **Score:** T=3, E=4. Excerpt is actually strong (Storm-1977 is a named actor, has a CTA triad). But this is **literally the headline the user is searching** — query is verbatim the BleepingComputer article title. We're competing with BleepingComputer on their own words. Need a sharper framing.
- **Rewrite:**
  - Title: `Windows Now Blocks Malicious .rdp Files by Default — What Changed` — **60ch**
  - Excerpt: `Windows now blocks untrusted .rdp files to kill Storm-1977-style credential phishing. Exactly what the OS change covers, what admins still must configure, and how to hunt past victims.` — **182ch → trim** → `Windows now blocks untrusted .rdp files to stop Storm-1977 credential phishing. What the OS change covers, what admins must still configure, and how to hunt victims.` — **155ch**

---

### 2.6 `2026-04 安全性修補程式 (kb5083769) (26200.8246)` — 0 clicks / 10 imp / **0% CTR** (ZH-TW)

- **URL:** `/en/articles/2026-04-15-microsoft-releases-mandatory-windows-11-security-update-kb5083769` (EN article ranking for a ZH-TW query — means the ZH translation isn't indexed yet OR the ZH copy is weak)
- **Title (EN):** "Microsoft Releases Mandatory Windows 11 Security Update KB5083769" — 66ch
- **Excerpt (EN):** "Microsoft has released cumulative update KB5083769 for Windows 11 versions 25H2 and 24H2, a mandatory Patch Tuesday security release that advances OS builds and addresses vulnerabilities."
- **Score:** T=3 (KB in title, good), E=2 ("addresses vulnerabilities" is content-free — no count, no severity, no build number; the query itself contains a more specific detail "26200.8246" than our copy)
- **Rewrite (EN):**
  - Title: `KB5083769: Mandatory Windows 11 25H2/24H2 Patch — Build 26200.8246` — **64ch → trim** → `KB5083769: Mandatory Windows 11 Patch — Build 26200.8246` — **56ch**
  - Excerpt: `KB5083769 is a mandatory Patch Tuesday update for Windows 11 25H2 and 24H2, advancing builds to 26200.8246. What it installs, which flaws are patched, and install steps.` — **170ch → trim** → `KB5083769 is the mandatory Windows 11 25H2/24H2 Patch Tuesday update, bumping builds to 26200.8246. What it installs, known issues, and install steps.` — **150ch**
- **Also:** verify `/zh/articles/...kb5083769` exists and is indexed. Separate issue for Alex to chase.

---

### 2.7 `mcgraw hill data breach april 2026` — 0 clicks / 8 imp / **0% CTR**

### 2.9 `mcgraw hill data breach 2026` — 0 clicks / 6 imp

**Three URLs match — cannibalization risk.** Google is splitting the rank across three articles for the same story:

1. `/en/threat-intel/2026-04-14-mcgraw-hill-data-breach-salesforce-misconfiguration`
2. `/en/threat-intel/2026-04-16-mcgraw-hill-data-breach-exposes-13-5-million-users-via-salesforce-misconfigurati`
3. `/en/threat-intel/2026-04-17-shinyhunters-leaks-13-5-million-mcgraw-hill-user-records`

**Action — beyond CTR:** consolidate via 301 or canonicalize 1 & 2 to 3 (most recent, strongest framing). Flag to Alex. For this audit, optimize #3 (the canonical).

- **URL (canonical):** `...shinyhunters-leaks-13-5-million-mcgraw-hill-user-records`
- **Title:** "ShinyHunters Leaks 13.5 Million McGraw Hill User Records" — 55ch, good
- **Excerpt:** "The ShinyHunters extortion group leaked data from 13.5 million McGraw Hill user accounts, stolen via a breach of the company's Salesforce environment. The data includes names, emails, and institutional affiliations."
- **Score:** T=4 (strong, but query is "mcgraw hill data breach" — lead with _McGraw Hill_ for query-match), E=4 (solid).
- **Rewrite:**
  - Title: `McGraw Hill Breach: ShinyHunters Leaks 13.5M User Records` — **56ch**
  - Excerpt: `ShinyHunters published data from 13.5 million McGraw Hill accounts — names, emails, institutional affiliations — stolen from a misconfigured Salesforce instance.` — **155ch**
- **Consolidation for 2.1/2.2 duplicates:** redirect or canonical-link to this URL.

---

### 2.8 `intext:"cve-2024-38112"` — 0 clicks / 6 imp / **0% CTR**

This is a Google advanced operator — searcher is a researcher hunting pages that mention this CVE verbatim. Different conversion profile (they want citations, not news). Still worth optimizing.

- **URL:** `/en/articles/2026-04-13-bluehammer-windows-zero-day-exploit-microsoft-disclosure`
- **Title:** "BlueHammer Zero-Day Exploit Highlights Microsoft Disclosure Tensions" — 66ch
- **Excerpt:** "Researcher 'Chaotic Eclipse' released a PoC exploit for a Windows zero-day (CVE-2024-38112), enabling local privilege escalation to SYSTEM, citing grievances with Microsoft's vulnerability handling."
- **Score:** T=3 (title omits CVE for brand framing — bad for CVE-query searcher), E=4 (CVE present, LPE-to-SYSTEM is concrete).
- **Rewrite:**
  - Title: `CVE-2024-38112: BlueHammer PoC Enables Windows SYSTEM Privilege Escalation` — **72ch → trim** → `CVE-2024-38112: BlueHammer PoC Escalates Windows to SYSTEM` — **56ch**
  - Excerpt: `Researcher Chaotic Eclipse published a PoC for CVE-2024-38112 — a Windows zero-day that grants local SYSTEM privileges — citing Microsoft's disclosure handling.` — **158ch → trim** → `Researcher Chaotic Eclipse published a PoC for CVE-2024-38112, a Windows zero-day that grants local SYSTEM privileges, citing MS disclosure failures.` — **148ch**

---

## 3. Pattern analysis — why one works, nine don't

| Signal                                       | Control (adaptavist, 18% CTR)                     | Laggards (avg 0% CTR)                                                                           |
| -------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Named entity in first 5 words of excerpt** | "TheGentlemen ransomware group..."                | "Multiple vulnerabilities...", "Microsoft has released...", "Windows now blocks..."             |
| **Name-brand victim / downstream impact**    | "NASA and Visa"                                   | absent or generic ("unsupported systems", "AI agents")                                          |
| **Specific stolen asset / exploit outcome**  | "source code and customer data"                   | "addresses vulnerabilities", "enable DoS, info disclosure, and RCE attacks" (list, not outcome) |
| **Verb strength**                            | "breaches, stealing, claims" (active, transitive) | "enable, addresses, bolsters, constrains" (weak, abstract)                                      |
| **Numeric specificity**                      | implied ("total infrastructure")                  | "Multiple", "two", "$7M seed" — only 2.4 has it                                                 |
| **CTA hint in excerpt**                      | none needed — the story _is_ the hook             | "Patch immediately" (lazy), most have none                                                      |
| **Query-term lead in title**                 | "Adaptavist" (matches query term 1)               | "Microsoft Bolsters..." (brand-first, not query-first)                                          |

**The rule the control follows and the others don't:**

> **Lead with the named actor or the named victim — whichever matches the searcher's query — in BOTH the title AND the first 4 words of the excerpt. Then deliver one concrete quantified outcome (record count, CVE ID, build number, dollar amount). Drop all weak verbs.**

Every rewrite above applies this rule.

---

## 4. Prompt change — upstream fix

File: `scripts/ai/prompts/article.ts`, section `OUTPUT FORMAT`. Current excerpt instruction (line 111):

```
"excerpt": "Specific 1-2 sentence summary stating WHO did WHAT to WHOM and the impact. Include CVE IDs, threat actor names, or affected products when available. No generic filler like 'a new threat has emerged'. Max 200 chars.",
```

This is close but too permissive. LLMs interpret "summary" as wire-copy register. Replace with a stricter, example-driven spec.

**Replace lines 108–112 with:**

```
OUTPUT FORMAT — respond with ONLY valid JSON, no markdown fences:
{
  "title": "Query-first headline. Lead with the most-searched term: CVE ID, KB number, named actor, named victim, or product name. 50-60 chars. No 'Month YYYY'. Weak verbs banned: bolsters, addresses, highlights, emerges, enables, impacts. Use: breaches, leaks, exploits, patches, blocks, hijacks, steals.",
  "slug": "lowercase-hyphenated-slug-no-date",
  "excerpt": "140-155 chars. Meta description for SERP click-through. MUST start with the named actor OR named victim OR CVE/KB/product identifier — whichever a reader would type into Google. MUST include one concrete number (record count, CVE ID, CVSS, dollars, version, build). MUST name at least one specific stakeholder (company, sector, product version). BANNED phrases: 'addresses vulnerabilities', 'patch immediately', 'a new threat', 'multiple vulnerabilities', 'significant', 'robust'. EXAMPLE (high-CTR): 'ShinyHunters published data from 13.5 million McGraw Hill accounts — names, emails, institutional affiliations — stolen from a misconfigured Salesforce instance.' EXAMPLE (low-CTR, reject): 'Multiple vulnerabilities in Orthanc DICOM server enable DoS, info disclosure, and RCE attacks. Patch immediately.'",
  ...
```

Keep the rest of the JSON schema unchanged. The banned-phrase list plus the pair of examples (one good, one bad, clearly labeled) is what makes LLMs actually change behavior — generic instructions don't.

**Also add to WRITING RULES section:**

```
- The excerpt is a meta description shown on Google search results. It sells the click. If it would fit on a wire-service summary unchanged, it's wrong — wire summaries don't need to convert clicks.
```

---

## 5. Rollout plan

### Phase 1 — today (≤ 30 min)

Hand-patch 9 articles (skip adaptavist). For each:

1. Edit frontmatter `title` and `excerpt` to the rewrite in §2.
2. Do NOT change `slug`, `date`, or body.
3. Commit in one atomic push: `fix(seo): rewrite titles + excerpts on top-10 lagging queries`.
4. Deploy path is content-only → ISR picks up in ~10s.
5. McGraw Hill 301s (2 URLs → 1) in same commit if Raymond can wire it; otherwise separate PR.

Files to touch (absolute):

- `C:\Users\jmskh\projects\zcybernews\content\en\posts\2026-04-13-orthanc-dicom-vulnerabilities-dos-info-disclosure-rce.mdx`
- `C:\Users\jmskh\projects\zcybernews\content\en\posts\2026-04-15-capsule-security-emerges-from-stealth-with-platform-to-constrain-ai-agent-action.mdx`
- `C:\Users\jmskh\projects\zcybernews\content\en\posts\2026-04-14-microsoft-patches-zero-days-windows-10-extended-security-update.mdx`
- `C:\Users\jmskh\projects\zcybernews\content\en\posts\2026-04-14-microsoft-windows-protections-malicious-rdp-files.mdx`
- `C:\Users\jmskh\projects\zcybernews\content\en\posts\2026-04-15-microsoft-releases-mandatory-windows-11-security-update-kb5083769.mdx`
- `C:\Users\jmskh\projects\zcybernews\content\en\posts\2026-04-13-bluehammer-windows-zero-day-exploit-microsoft-disclosure.mdx`
- `C:\Users\jmskh\projects\zcybernews\content\en\threat-intel\2026-04-17-shinyhunters-leaks-13-5-million-mcgraw-hill-user-records.mdx`
- (plus canonical/301 for the two duplicate McGraw Hill URLs — Alex)
- (plus mirror ZH translations in `content\zh\...` — run through Kimi via admin re-translate)

### Phase 2 — this week

Land the prompt change in `scripts/ai/prompts/article.ts`. Merge to main. From that deploy onward, every article shipped by the AI pipeline carries a click-optimized excerpt. No more hand-patching.

Ship `simplify` review on the prompt change — a prompt regression on 800-article/week throughput is expensive.

### Phase 3 — next 4 weeks (measurement window)

**Target:** CTR 0.8% → 2.5% sitewide by 2026-05-16.

Decision gates:

- Week 1 (2026-04-25): 10 patched articles' CTR. If ≥3 of 9 improved by 1pp+ absolute, the rewrite rule is validated. If not, the problem isn't excerpt copy — it's ranking authority, and we escalate to a different intervention.
- Week 2 (2026-05-02): first cohort of articles generated under new prompt enters Search Console rank. Compare cohort-level CTR at matched positions.
- Week 4 (2026-05-16): sitewide CTR check. 2.5% = win. 1.5–2.4% = partial, iterate prompt. <1.5% = root cause isn't copy, escalate.

---

## 6. Monitoring contract

**Weekly pull — every Friday, Maya owns:**

| Metric                                       | Source                               | Target                    | Note                                |
| -------------------------------------------- | ------------------------------------ | ------------------------- | ----------------------------------- |
| Sitewide CTR (28-day rolling)                | GSC → Performance → Queries          | 0.8% → 2.5% by 2026-05-16 | primary KPI                         |
| Top-10 queries by impressions                | GSC → Queries tab                    | monitor drift             | new queries = new rewrites          |
| Per-URL CTR on the 9 patched articles        | GSC → Pages                          | each ≥ 2% within 14 days  | validates Phase 1                   |
| Avg position                                 | GSC → Queries                        | hold or improve vs 7.5    | don't mistake rank drop for CTR win |
| Impressions                                  | GSC                                  | continue climb            | health signal for indexing          |
| New-article CTR (cohort after prompt change) | GSC → Pages filtered by publish date | ≥ 2.5% at position 7-10   | validates Phase 2                   |

**Data pipe:** GSC UI pull is fine at weekly cadence. If cadence becomes daily, wire GSC API → `scripts/monitoring/gsc-weekly.ts` and pipe into the daily ops digest Sam already ships. Not worth building now — volume too low.

**Escalation triggers:**

- CTR drops below current 0.8% → fire immediately, likely a title/description regression from pipeline
- Any patched URL stays at 0% CTR after 14 days → rewrite didn't help, different root cause (rank too low, thumbnail missing, snippet being overridden by Google)

---

**One-line summary for Eric/Sam:**
Audit lives at `C:\Users\jmskh\projects\zcybernews\docs\seo-ctr-audit-2026-04-18.md` — **biggest finding: the AI pipeline writes wire-copy excerpts, not click-bait excerpts; fix is a 10-line prompt change plus 9 manual rewrites today, targeting CTR 0.8% → 2.5% in 28 days (~600 extra clicks/month).**
