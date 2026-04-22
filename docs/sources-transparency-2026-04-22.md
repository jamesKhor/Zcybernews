# /sources transparency page — design spec

**Status:** Shipped 2026-04-22. Part of the curation-layer positioning
anchored in `docs/pipeline-contracts-2026-04-22.md` §Positioning.

**Author:** Operator + Claude (Maya-led content decisions, Ken-led layout,
Vincent-sanity-checked schema).

## 1. Thesis

Security professionals already subscribe to 10+ feeds in Feedly. Our
product is NOT faster publishing — it is **curation + editorial
judgment**. The `/sources` page turns our upstream list into a
transparency artifact: the reader can verify exactly what we read, what
we rejected, and why. This is the moat.

Operator directive (verbatim, 2026-04-22): _"i like honest business
model, clear and if you want u can look at all e.g. 30 source we are
following etc everything CLEAR"_.

## 2. URL + routing

- `GET /en/sources` and `GET /zh/sources` — both locales prerendered,
  ISR `revalidate = 86400`.
- Sitemap entry added with `changeFrequency: monthly`, `priority: 0.7`.
- Canonical + hreflang emitted via `generateMetadata`.
- Footer link ("Our sources" / "信息来源") added to the Quick Links block.
- Homepage strip (muted one-liner) between `<Hero3Col>` and
  `<MoreFromToday>` routes curious visitors in.

## 3. Data contract

Single source of truth: `data/rss-sources.json`. Additive, non-breaking
schema extension applied 2026-04-22:

```jsonc
{
  "id": "...",
  "name": "...",
  "homepage": "https://publisher.com/", // NEW — external link target
  "url": "https://.../feed", // existing — RSS feed target
  "category": "cybersecurity",
  "type": "rss",
  "enabled": true, // existing — pipeline gate
  "tier": "trusted|standard|under-review|excluded", // NEW
  "description": "one-line editorial rationale", // existing, re-voiced
  "whyDrop": "one-line public reason (tier=excluded only)", // NEW
  "lastReviewed": "YYYY-MM-DD", // NEW — manual editorial stamp
}
```

### Tier labels (not scores)

Operator rejected numeric quality scores for this surface. Tiers are
editorial judgments and should read as such:

| tier           | EN label            | ZH label     | Meaning                                                          |
| -------------- | ------------------- | ------------ | ---------------------------------------------------------------- |
| `trusted`      | Trusted independent | 权威独立媒体 | Primary-source authorities (Krebs, Schneier, CISA, Project Zero) |
| `standard`     | Standard            | 常规来源     | Read daily for breadth + cross-confirmation                      |
| `under-review` | Under review        | 审查中       | Probation — monitoring signal quality before promote/drop        |
| `excluded`     | Excluded            | 已排除       | Deliberately not carried; `whyDrop` shown publicly               |

A numeric `qualityScore` still lives inside the pipeline for ranking +
dedup decisions. It is NOT rendered on `/sources`. Operator: "scores
internal".

### `lastReviewed` — manual, not mtime-derived

`data/rss-sources.json` gets touched for reasons unrelated to editorial
re-review (typo fixes, field additions). Using file mtime would inflate
confidence. `lastReviewed` is a manually-edited date field per source
that the operator updates during a deliberate review pass. Default
cadence: quarterly.

## 4. UI rules

- **External links only:** `target="_blank" rel="noopener noreferrer"`.
  No `nofollow` — we are happy for crawlers to see our upstream graph.
- **Two link targets per source:** name → homepage (publisher brand),
  RSS icon → feed URL (for readers who want to subscribe directly).
- **Tier badge** next to name — one colored pill per tier.
- **`whyDrop` reason** appears in bold-labeled paragraph under the
  excluded source's name, using professional language ("signal-to-noise
  threshold", "marketing content outweighed standalone research value").
  No snark.
- **Quarterly-review stated policy** in the hero, followed by
  `Last reviewed: YYYY-MM-DD` string.
- **No search / filter UI** — page is meant to be scanned top-to-bottom,
  not queried. If the list grows past ~60 entries we revisit.

## 5. Feed suggestions — email only, no web form

Operator directive (verbatim): _"i dont want to do it thru like a
feature on our site. i dont want another security issues like an input
box... submit thru email"_.

- CTA is a `mailto:contact@zcybernews.com` link with pre-filled subject
  and body template.
- NO web form. No submission queue. No public suggestion box to game.
- Reply expectation stated: "typically within a few business days. No
  auto-responders."
- Email alias: `contact@zcybernews.com` (existing Cloudflare Email
  Routing → Gmail, already configured 2026-04-16).

## 6. SEO + schema

- `WebPageJsonLd` + `BreadcrumbJsonLd` emitted.
- `inLanguage` set per locale (`en` vs `zh-Hans`).
- Meta description front-loads "cybersecurity feeds, vendor research
  blogs, national CERT advisories" to match "how reader would query".
- Sitemap priority 0.7 — same as category pages, below articles (0.8)
  but above most listing pages.

## 7. Positioning copy — locked phrases

The following sentences are editorial anchors. Changing them
meaningfully requires Maya + operator approval:

- **Hero subtitle (EN):** "Security pros already subscribe to ten feeds
  in Feedly. Our job is not to publish faster than them — it is to read
  all of it, throw out the noise, and surface what matters. This page
  shows exactly what we read, so you can judge our curation for
  yourself."
- **Suggest-a-feed body (EN):** "We use email on purpose — no web
  forms, no submission queues, no public suggestion box to game."

Both lines are sales copy for the curation moat. Keep them.

## 8. Open follow-ups

- **Byline equity:** Deferred. Operator: _"hand on until we polish our
  content then i dare to use my real name"_ — target ~6–8 weeks out
  once pipeline quality stabilises.
- **Per-source coverage counts:** Nice-to-have ("we've published N
  articles citing this source"). Requires source-to-article join that
  doesn't exist yet. Deferred until a sponsor pitch requires it.
- **i18n `suggestBody` link to security policy:** If we ship a
  `/privacy` page for EU / PDPA compliance, add a link at the bottom of
  the suggest section. Not in scope today.

## 9. Related decisions (cross-refs)

- `docs/pipeline-contracts-2026-04-22.md` §Positioning — curation-layer
  thesis that this page instantiates.
- `~/.claude/projects/.../memory/monetization_baseline_2026_04_20.md` —
  kill criterion 2026-10-20; if page drives no measurable funnel lift
  (newsletter CTR or repeat visits), revisit.
- `memory/feedback_check_placement_not_existence.md` — we finally
  placed the "we curate" claim where a skeptical reader can verify it.
