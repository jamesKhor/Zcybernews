# Pipeline Hardening Notes — 2026-05-05

## Scope

This note covers the source-to-generation guardrails added after the May 5
pipeline audit. The goal is to keep weak source records useful for private
triage without letting them silently become public, translated, or
hallucination-prone articles.

## Source Identity

Structured feeds must provide a stable `identityKey` when multiple records share
one landing URL.

- CISA KEV: `cisa-kev-${CVE}`
- NVD recent CVEs: `nvd-${CVE}`
- RSS/default: falls back to the article URL

Deduplication and processed-cache checks use `storyIdentityKey(story)`, not raw
URL equality. Human-facing source URLs stay unchanged for citations.

## Routing Contract

Enabled sources carry `sourceLanguage` and `seoIntent`.

- `rank-both` + `en` may generate EN and translate to ZH.
- `ingest-only` is skipped before generation.
- ZH-native public generation remains blocked until a ZH writer exists.

FreeBuf is intentionally `zh` + `ingest-only`.

## Source Enrichment

RSS stories are enriched best-effort with fetched article text before generation.
Structured sources such as CISA KEV and NVD are not HTML-fetched because their
record text is already structured. Fetch failures, short extracts, and parser
errors fall back to the RSS excerpt so source enrichment cannot take down an
article task.

Generation prompts, source-richness scoring, fact-checking, and post-process IOC
verification all read through `source-corpus.ts`.

## Processed Cache

Processed marks are batched in memory and flushed explicitly. Flush now:

1. Acquires `.pipeline-cache/processed-urls.json.lock`.
2. Reloads the current on-disk JSON.
3. Merges the in-memory marks with the on-disk marks.
4. Writes a temp file and atomically renames it into place.

This protects both in-process `p-limit` concurrency and overlapping pipeline
processes from dropping processed records.

## IOC Trust Boundary

The live generation pipeline rebuilds IOCs from article body plus source corpus.
LLM-only domains, URLs, emails, file paths, and registry keys are stripped unless
they can be rediscovered by the extractor and cross-checked against source text.
Manual/backfill callers can still preserve unsupported existing IOC types by
leaving `preserveUnverifiedExisting` at its default `true`.

## Verification

Run these before changing routing, source enrichment, cache behavior, or IOC
post-processing:

```bash
npm run typecheck
npx vitest run scripts/pipeline/__tests__/cisa-kev.test.ts scripts/pipeline/__tests__/nvd.test.ts scripts/pipeline/__tests__/routing.test.ts
npx vitest run scripts/pipeline/__tests__/source-corpus.test.ts scripts/pipeline/__tests__/source-enrichment.test.ts scripts/pipeline/__tests__/post-process-iocs.test.ts scripts/pipeline/__tests__/extract-iocs.test.ts scripts/utils/cache.test.ts
npm run test
npm run lint
```
