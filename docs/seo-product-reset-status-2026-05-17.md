# SEO Product Reset Status - 2026-05-17

Status: Planned  
Owner: Alex  
Docs: Noah  
Engineering: Raymond  
Architecture: Vincent  
SEO: Maya  
Process: Sam

## Current Decision

ZCyberNews is entering an English-first SEO recovery phase. New public publishing should prioritize English articles with clear source evidence, query-first packaging, structured SEO briefs, and sitemap eligibility.

Existing Chinese URLs remain live. New Chinese generation is frozen unless reopened by a separate migration plan.

## Current Diagnosis

Technical indexability has mostly been repaired. The next root-cause lane is product and pipeline quality: source trust, candidate selection, evidence depth, search demand, topic balance, SEO briefs, and GSC feedback.

Cloudflare caching is not the active working theory unless a new live check proves stale `noindex`, stale sitemap, crawler-blocking headers, or mismatched cached HTML.

## Phase Gates

| Phase | Gate                                   | Owner             | Status      | Evidence                                                                 |
| ----- | -------------------------------------- | ----------------- | ----------- | ------------------------------------------------------------------------ |
| 0     | Design and implementation plan written | Alex + Noah       | In progress | `docs/superpowers/specs/2026-05-17-seo-product-pipeline-reset-design.md` |
| 1     | Source trust and evidence packet       | Vincent + Raymond | Planned     | Source trust tests and evidence packet tests                             |
| 2     | Search-first selector and SEO brief    | Raymond + Maya    | Planned     | Editorial selector tests and dry-run decision matrix                     |
| 3     | English-only recovery mode             | Alex + Raymond    | Planned     | Routing tests with `SEO_RECOVERY_EN_ONLY=true`                           |
| 4     | GSC demand loop                        | Maya + Noah       | Planned     | Imported GSC demand hints                                                |
| 5     | Topic hubs and internal links          | Ken + Maya        | Planned     | SEO audit and hub coverage                                               |
| 6     | Production rollout and monitoring      | Raymond + Sam     | Planned     | Pipeline dry run, SEO audit, production smoke                            |

## Alex Lane Tracker

| ID      | Lane                  | Owner             | Priority | Status  | Acceptance                                                                                    |
| ------- | --------------------- | ----------------- | -------- | ------- | --------------------------------------------------------------------------------------------- |
| SEO-R1  | Publish policy        | Alex              | P0       | Planned | Public, research-more, digest-only, and reject decisions are explicit                         |
| SEO-R2  | English-only recovery | Alex + Raymond    | P0       | Planned | New public content is English-only during recovery                                            |
| SEO-R3  | Source trust          | Vincent + Raymond | P0       | Planned | Every enabled source has trust metadata                                                       |
| SEO-R4  | Evidence packet       | Raymond           | P0       | Planned | Every cluster has structured facts and uncertainty                                            |
| SEO-R5  | Editorial selector    | Raymond + Maya    | P0       | Planned | Candidates are selected by evidence, trust, demand, freshness, differentiation, and portfolio |
| SEO-R6  | SEO brief             | Maya + Raymond    | P0       | Planned | Every generated public article has a query target and SEO promise                             |
| SEO-R7  | Decision matrix       | Noah + Raymond    | P1       | Planned | Operator can see why every candidate was published or not                                     |
| SEO-R8  | GSC feedback loop     | Maya + Noah       | P1       | Planned | Weekly GSC exports update demand hints and rewrite queue                                      |
| SEO-R9  | Topic hubs            | Ken + Maya        | P2       | Planned | Public articles connect to crawlable hubs                                                     |
| SEO-R10 | Production monitoring | Sam + Raymond     | P0       | Planned | Dry run, QA, SEO audit, deploy smoke are recorded                                             |

## Daily Review Template

Use this after each pipeline run:

| Metric                            | Result | Notes |
| --------------------------------- | ------ | ----- |
| Published public English articles |        |       |
| Held for research                 |        |       |
| Digest-only items                 |        |       |
| Rejected items                    |        |       |
| Top source failures               |        |       |
| Top search opportunities          |        |       |
| Topic lanes covered               |        |       |
| Pipeline dry run                  |        |       |
| SEO audit                         |        |       |
| Production smoke                  |        |       |

## Review Cadence

- Daily during first 3 days after deploy: production smoke, sitemap freshness, decision matrix sanity.
- Twice weekly during first 14 days: GSC discovery/indexing and query rows for new English URLs.
- Weekly after stabilization: source trust tuning, topic lane balance, title/meta rewrite queue, thin-page triage.

## Source Docs

- `docs/seo-indexability-root-cause-2026-05-14.md`
- `docs/seo-full-audit-2026-05-05.md`
- `docs/seo-ctr-audit-2026-04-18.md`
- `docs/pipeline-contracts-2026-04-22.md`
- `docs/pipeline-chain-audit-2026-04-21.md`
- `docs/pipeline-hardening-2026-05-05.md`
- `docs/sources-transparency-2026-04-22.md`
- `docs/adr/0001-cdn-caching-next-app-router.md`
