export function buildTranslationPrompt(
  enContent: string,
  title: string,
): string {
  return `You are a professional Chinese (Simplified) translator specialising in cybersecurity content.
Translate the following English cybersecurity article into natural, fluent Simplified Chinese (简体中文).

STRICT DO-NOT-TRANSLATE LIST — keep these EXACTLY as written in English:
- Threat actor / APT group names: e.g. LockBit, APT41, Lazarus Group, Sandworm, Volt Typhoon, REvil, BlackCat, Cl0p, FIN7, TA505, UNC2452, HAFNIUM
- Malware / ransomware / tool names: e.g. Mimikatz, Cobalt Strike, Metasploit, BloodHound, Emotet, TrickBot, Qakbot, ALPHV, BlackMatter, DarkSide
- ALL-CAPS acronyms: EDR, XDR, SOC, SIEM, VPN, RDP, MFA, IAM, CVE, CVSS, IOC, TTP, APT, C2, C&C, DNS, SSL, TLS, HTTP, HTTPS, API, SDK, CLI, AWS, GCP, IAB, RaaS, BEC, OSINT, TTL, IP, OS, AD, LDAP, SMB, WMI, LSASS, DLL, PE, AV, NDR, WAF, IDS, IPS, DMARC, SPF, DKIM, OT, ICS, SCADA, PKI, HSM, MFA
- Product and vendor names: Microsoft, Windows, Linux, macOS, Ivanti, Pulse Secure, Fortinet, Cisco, CrowdStrike, SentinelOne, Splunk, Elastic, OpenAI, GPT-5, MITRE ATT&CK, MITRE ATLAS
- CVE IDs (e.g. CVE-2025-4821), CVSS scores, hash values, IP addresses, domain names, file paths, registry keys
- Code blocks and command-line snippets — never translate content inside \`backticks\` or \`\`\`fenced blocks\`\`\`
- URLs and email addresses

TRANSLATION RULES:
- Translate everything else into natural, fluent Simplified Chinese
- Keep all markdown formatting (## headings, **bold**, \`code\`, tables, lists) intact
- Translate section headings naturally:
  ## Executive Summary → ## 执行摘要
  ## Technical Analysis → ## 技术分析
  ## Indicators of Compromise → ## 入侵指标
  ## Tactics, Techniques & Procedures → ## 战术、技术与程序
  ## Threat Actor Context → ## 威胁行为者背景
  ## Detection & Hunting Queries → ## 检测与溯源查询
  ## Mitigations & Recommendations → ## 缓解措施与建议
  ## References → ## 参考资料
- Do NOT add any content not in the original
- Output ONLY the translated markdown — no preamble, no explanation

ARTICLE TITLE: ${title}

ARTICLE BODY:
${enContent}`;
}

export function buildZhMetaPrompt(enExcerpt: string, enTitle: string): string {
  return `Translate these two strings from English to Simplified Chinese (简体中文).

IMPORTANT: Keep threat actor names, malware names, ALL-CAPS acronyms (EDR, VPN, RDP, APT, C2, IOC, TTP, CVE, etc.), product names, and vendor names in English exactly as-is.
Only translate the descriptive surrounding text into Chinese.

Return ONLY valid JSON with keys "title" and "excerpt". No explanation.

English title: ${enTitle}
English excerpt: ${enExcerpt}

Output example: {"title": "中文标题保留 LockBit 4.0 英文名称", "excerpt": "中文摘要，IOC 和 CVE 保持英文"}`;
}
