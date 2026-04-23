/**
 * Pure MDX-source string strippers — no imports, no side effects.
 *
 * Lives separately from `lib/mdx.ts` because that module pulls in
 * React + next-mdx-remote/rsc (heavy + needs the `@/` path alias),
 * which Vitest can't resolve without a vitest config. Keeping the
 * pure regex helpers here lets them be unit-tested directly.
 *
 * `lib/mdx.ts` re-exports these so existing callers keep working
 * without import-path changes.
 */

const REFERENCES_HEADING_RE =
  /\n##\s+(References|Sources|参考文献|参考资料|来源)[\s\S]*$/i;

/**
 * Strip the References section from MDX source. Used to hide the source
 * URL list from public article pages — the reference list is for
 * internal admin review only, not for end-readers.
 *
 * Matches English ("References", "Sources") and Chinese common variants
 * ("参考文献", "参考资料", "来源"). Case-insensitive. Greedy from the
 * heading to end of file.
 */
export function stripReferencesSection(source: string): string {
  return source.replace(REFERENCES_HEADING_RE, "\n");
}

/**
 * Strip "## <Conditional Section> / None identified..." stub blocks
 * from legacy articles (added 2026-04-23). The article-generation
 * prompt was updated the same day to OMIT empty conditional sections
 * rather than stub them, but every article generated before that —
 * most of the existing corpus — still has these stubs baked into its
 * MDX. Removing them at render time gives readers an immediate visual
 * lift without needing to backfill / rewrite published content.
 *
 * Match shape (greedy until next H2 or end):
 *   ## Indicators of Compromise
 *
 *   None identified [in source material|at this time].
 *
 *   ## Tactics, Techniques & Procedures
 *
 * Also covers ZH equivalents because Kimi K2 translated the stub
 * literally during the EN→ZH pass.
 *
 * The IOCTable + MitreMatrix components on the article detail page
 * already conditionally render based on `frontmatter.iocs.length > 0`
 * and `frontmatter.ttp_matrix.length > 0`, so dropping these body
 * stubs removes the only remaining source of empty-section noise.
 */
const EMPTY_CONDITIONAL_SECTION_RE =
  /\n##\s+(Indicators of Compromise|Tactics,?\s+Techniques\s+(?:&|and|＆)\s+Procedures|Threat Actor Context|入侵指标|战术、技术与程序|威胁行为者背景)[ \t]*\r?\n+(None identified[^\n]*|未发现[^\n]*|暂未识别[^\n]*|没有发现[^\n]*)[^\n]*\r?\n*(?=\n##\s|\s*$)/gi;

export function stripEmptyConditionalSections(source: string): string {
  return source.replace(EMPTY_CONDITIONAL_SECTION_RE, "\n");
}
