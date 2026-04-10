export function buildTranslationPrompt(
  enContent: string,
  title: string,
): string {
  return `You are a professional Chinese (Simplified) translator specialising in cybersecurity content.
Translate the following English cybersecurity article into natural, fluent Simplified Chinese (简体中文).

RULES:
- Keep all technical terms accurate (CVE IDs, tool names, IP addresses, hashes must remain unchanged)
- Keep all markdown formatting (## headings, **bold**, \`code\`, links) intact
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
  return `Translate these two strings from English to Simplified Chinese (简体中文). Return ONLY valid JSON with keys "title" and "excerpt".

English title: ${enTitle}
English excerpt: ${enExcerpt}

Output example: {"title": "中文标题", "excerpt": "中文摘要"}`;
}
