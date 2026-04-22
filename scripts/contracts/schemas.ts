/**
 * Pipeline contract schemas — Single Source of Truth (SSoT).
 *
 * Phase B.2 of the migration sequence described in
 * `docs/pipeline-contracts-2026-04-22.md` §9. Owns the Zod definitions
 * that every pipeline stage must validate against, so producer and
 * consumer can never silently disagree on shape.
 *
 * This module is PURE: no fs, network, console, or state mutation. It
 * exists to be imported — by `translate-direction.ts` today (B.1), and
 * by `ingest-rss.ts`, `generate-article.ts`, `post-process.ts`,
 * `fact-check.ts`, `write-mdx.ts`, and `send-digest.ts` in subsequent
 * phases as each consumer is refactored to read from here instead of
 * declaring its own local shape.
 *
 * Design rules:
 *   1. **Additive.** New optional fields are allowed; removing or
 *      narrowing existing fields is a BREAKING CHANGE that requires a
 *      migration note in the contract doc §9 and a bump to the
 *      consumer audit.
 *   2. **Zod-first, TS-second.** Every exported type is derived via
 *      `z.infer`, so the runtime parser and the static type can never
 *      drift apart.
 *   3. **Defaults belong here.** If the contract doc says a default,
 *      the default lives on the Zod schema — not on a consumer's
 *      `?? "rank-en"`. Keeps defaults reviewable in one grep.
 *   4. **No enrichment.** Schemas describe the contract shape, not the
 *      pipeline behavior. A schema never "computes" anything — no
 *      `.transform()` that mutates values beyond coercion.
 *
 * First-party consumers today:
 *   - `scripts/pipeline/translate-direction.ts` (B.1)
 *
 * Next in line (B.4+):
 *   - `scripts/pipeline/write-mdx.ts` (write boundary)
 *   - `scripts/pipeline/ingest-rss.ts` (Stage 1→2 source-identity row)
 *   - `scripts/pipeline/send-digest.ts` (Stage 7→8 digest locale gate)
 */
import { z } from "zod";

// ─── Primitive enums ──────────────────────────────────────────────────
//
// Kept as named z.enum exports so downstream modules can reference the
// enum object itself (for iteration, exhaustive-check maps, etc.) and
// also get the inferred TS union.

/**
 * Language a source natively publishes in. Affects translation-direction
 * routing (§3.A matrix) and digest locale gate (§3 Stage 7→8).
 *
 * Cycle 1 supports EN and ZH only. Adding a new locale is a governance
 * decision — update the matrix and re-audit all routing call-sites.
 */
export const SourceLanguageSchema = z.enum(["en", "zh"]);
export type SourceLanguage = z.infer<typeof SourceLanguageSchema>;

/**
 * Editorial intent for a source's content. Drives the 8-cell routing
 * matrix in §3.A via `getTranslationDirection()`.
 *
 * Defaults to `rank-en` because the historical pipeline published
 * EN-only; preserving that default keeps the silent behavior of every
 * existing source unchanged when the config file is re-parsed.
 */
export const SeoIntentSchema = z.enum([
  "rank-en",
  "rank-zh",
  "rank-both",
  "ingest-only",
]);
export type SeoIntent = z.infer<typeof SeoIntentSchema>;

// ─── SourceMetadata ───────────────────────────────────────────────────
//
// Describes a configured upstream (an entry in `data/rss-sources.json`
// enriched with editorial fields). This schema is a PROJECTION — the
// on-disk JSON has more fields (category, type, enabled, homepage,
// etc.) that the routing logic doesn't need. Keeping the schema narrow
// here means a new on-disk field doesn't require a schema bump unless
// a routing consumer actually needs it.

/**
 * Minimum source-config shape routing logic reads. Consumers that need
 * more fields (e.g. `enabled` for ingest filtering) should extend this
 * schema with `.extend({ enabled: z.boolean() })` at the import site
 * rather than bloat the SSoT.
 */
export const SourceMetadataSchema = z.object({
  id: z.string().min(1),
  seoIntent: SeoIntentSchema.default("rank-en"),
});

/**
 * **Input** shape — what a producer WRITES (defaulted fields are
 * optional). This is the type call-sites should use when building a
 * SourceMetadata literal: `seoIntent` can be omitted and will be
 * filled in at parse time.
 *
 * The contract rule is "producer may omit defaulted fields; consumer
 * reads the defaulted value." That's exactly the Zod input/output
 * split, so we expose the input shape under the canonical type name
 * and reserve `SourceMetadataParsed` for post-parse code (the rarer
 * case — most of the pipeline reads the field with `??` fallback
 * today).
 */
export type SourceMetadata = z.input<typeof SourceMetadataSchema>;
export type SourceMetadataParsed = z.output<typeof SourceMetadataSchema>;

// ─── ArticleDraft ─────────────────────────────────────────────────────
//
// A post-generation pre-write snapshot of an article. Holds only the
// fields that cross stage boundaries (sourceLanguage is read by the
// write-mdx stage AND by translate-direction). Body prose, structured
// fields (cve_ids, iocs, etc.), and frontmatter all live in stage-local
// types today; they will migrate here piecewise as consumers refactor.

/**
 * Minimum article-draft shape routing logic reads. See SourceMetadata
 * note above — extend at import site rather than bloat the SSoT.
 */
export const ArticleDraftSchema = z.object({
  sourceLanguage: SourceLanguageSchema.default("en"),
});
/** Input shape — see SourceMetadata note above for the input/output split. */
export type ArticleDraft = z.input<typeof ArticleDraftSchema>;
export type ArticleDraftParsed = z.output<typeof ArticleDraftSchema>;

// ─── Future additions ─────────────────────────────────────────────────
//
// Tracked here as a grep-target so the next consumer PR has a pointer
// back to the contract doc for the authoritative shape:
//
//   - StorySchema (Stage 1→2) — currently `scripts/utils/dedup.ts :21`.
//     Move here once ingest-rss.ts is refactored.
//   - PipelineContextSchema — orchestrator-level record threaded across
//     stages. Currently implicit.
//   - ArticleFrontmatterSchema — already lives in `lib/types.ts`. Kept
//     there because the render layer imports it; moving risks cycles.
//     Will be re-exported from this module once dependency graph is
//     verified.
