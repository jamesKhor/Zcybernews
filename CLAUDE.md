@AGENTS.md

# AleCyberNews — Project Guide for Claude

This file gives Claude full context to continue working on this project from any session (Claude Code CLI, Claude Desktop, or claude.ai).

---

## What This Project Is

A professional cybersecurity and tech news site that:
- Serves **English and Simplified Chinese** articles with bilingual routing
- Uses **Git + MDX files** as the CMS (no database, no GUI CMS)
- Runs an **AI-powered pipeline** that ingests RSS feeds, generates articles with DeepSeek-V3, translates to Chinese with Kimi K2, and commits them automatically via GitHub Actions
- Deploys to **Cloudflare Pages** on every push to `main`
- Includes **threat intelligence sections** with IOC tables, MITRE ATT&CK matrix, and threat actor cards

**GitHub repo:** https://github.com/jamesKhor/Alecybernews  
**Local path:** `C:\Users\jmskh\projects\alecybernews`

---

## Tech Stack

| Layer | Package |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript) |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Content | gray-matter + next-mdx-remote |
| MDX plugins | remark-gfm, rehype-highlight, rehype-slug |
| i18n | next-intl v4 (EN/ZH routing) |
| AI text — articles | DeepSeek-V3 via `@ai-sdk/openai-compatible` |
| AI text — Chinese translation | Kimi K2 (Moonshot AI) via `@ai-sdk/openai-compatible` |
| AI images (Phase 2) | fal.ai FLUX.1-schnell (~$0.003/image) |
| Web search | Brave Search API or Tavily |
| Schema validation | Zod v4 |
| Script runner | tsx |
| Locale middleware | `proxy.ts` (Next.js 16 renamed middleware → proxy) |
| Deploy | Cloudflare Pages via `cloudflare/wrangler-action` |

---

## Important Conventions

- **`proxy.ts`** is the locale + WeChat middleware file. Next.js 16 renamed `middleware.ts` → `proxy.ts`. Do NOT create a `middleware.ts` — it will show a deprecation warning.
- **WeChat default:** WeChat browser UA (`MicroMessenger`) is detected in `proxy.ts` and redirected to `/zh`. Other browsers use `Accept-Language` header for locale detection.
- **Content in Git:** Articles live in `content/en/posts/`, `content/zh/posts/`, `content/en/threat-intel/`, `content/zh/threat-intel/` as `.mdx` files.
- **Frontmatter validated by Zod** in `lib/types.ts` — `ArticleFrontmatterSchema`. Any AI-generated article MUST conform to this schema or it is skipped.
- **Default images** are SVGs in `public/images/defaults/{category}.svg`. Real AI-generated images go in `public/images/articles/` and override via the `featured_image` frontmatter field.
- **Category values** (exact enum): `threat-intel | vulnerabilities | malware | industry | tools | ai`
- **Language values**: `en | zh`

---

## Directory Structure

```
alecybernews/
├── app/
│   ├── [locale]/                  # en | zh
│   │   ├── layout.tsx             # Header + Footer wrapper, NextIntlClientProvider
│   │   ├── page.tsx               # Homepage
│   │   ├── articles/
│   │   │   ├── page.tsx           # Paginated listing (12/page)
│   │   │   └── [slug]/page.tsx    # Single article with IOCTable + MitreMatrix
│   │   └── threat-intel/
│   │       ├── page.tsx
│   │       └── [slug]/page.tsx
│   ├── api/
│   │   ├── feed/route.ts          # RSS/Atom feed
│   │   └── wechat/route.ts        # WeChat JSON feed (?locale=zh)
│   ├── layout.tsx                 # Root layout (fonts, metadata)
│   └── globals.css                # Dark cyber theme + prose styles
├── components/
│   ├── articles/
│   │   ├── ArticleCard.tsx        # Card used in listing pages
│   │   └── ArticleMeta.tsx        # Date, reading time, severity, CVE badges
│   ├── threat-intel/
│   │   ├── IOCTable.tsx           # "use client" — sortable, filterable, CSV export
│   │   └── MitreMatrix.tsx        # ATT&CK tactic columns, links to attack.mitre.org
│   ├── layout/
│   │   ├── Header.tsx             # "use client" — nav, locale switcher, mobile menu
│   │   └── Footer.tsx
│   └── ui/                        # shadcn/ui components (card, badge, button, etc.)
├── content/
│   ├── en/posts/                  # English articles (.mdx)
│   ├── en/threat-intel/           # English TI reports (.mdx)
│   ├── zh/posts/                  # Chinese articles (.mdx)
│   └── zh/threat-intel/           # Chinese TI reports (.mdx)
├── i18n/
│   ├── routing.ts                 # defineRouting — locales: [en, zh], default: en
│   ├── request.ts                 # getRequestConfig for next-intl
│   └── navigation.ts              # createNavigation helpers (Link, redirect, etc.)
├── lib/
│   ├── types.ts                   # ArticleFrontmatterSchema (Zod), IOCEntry, TTPEntry
│   ├── content.ts                 # getAllPosts, getPostBySlug, getRelatedPosts
│   ├── mdx.ts                     # compileMDX with remark/rehype plugins
│   └── utils.ts                   # cn() helper for shadcn
├── messages/
│   ├── en.json                    # English UI strings
│   └── zh.json                    # Chinese UI strings
├── public/images/defaults/        # SVG placeholder images per category
├── scripts/                       # AI pipeline (NOT YET BUILT — Phase 4)
├── .env.example                   # All required env vars documented
├── proxy.ts                       # next-intl locale + WeChat middleware
└── next.config.ts                 # withNextIntl wrapper
```

---

## Article Frontmatter Schema

Every `.mdx` article must have this frontmatter (validated by `lib/types.ts`):

```yaml
---
title: "Article Title"
slug: "url-slug"
date: "2026-04-09"           # ISO 8601
updated: "2026-04-10"        # optional
excerpt: "1-2 sentence summary for cards and meta tags"
category: "threat-intel"     # threat-intel|vulnerabilities|malware|industry|tools|ai
tags: ["ransomware", "apt"]
language: "en"               # en|zh
locale_pair: "slug-of-other-language-version"  # optional
source_urls: ["https://..."]
author: "AI-generated"       # or human name
featured_image: "/images/articles/slug.webp"   # optional, overrides default
draft: false
scheduled_publish: "2026-04-10T09:00:00Z"      # optional, hides until this time

# Threat intel fields (optional on regular posts)
threat_actor: "LockBit 4.0"
threat_actor_origin: "Russia"
campaign: "HL-SECTOR-2026-Q1"
severity: "critical"         # critical|high|medium|low|informational
cvss_score: 9.8
cve_ids: ["CVE-2026-1234"]
affected_sectors: ["healthcare"]
affected_regions: ["North America"]
iocs:
  - type: "ip"               # ip|domain|hash_md5|hash_sha1|hash_sha256|url|email|registry_key|file_path
    value: "1.2.3.4"
    description: "C2 server"
    confidence: "high"       # high|medium|low
    first_seen: "2026-04-01"
ttp_matrix:
  - tactic: "Initial Access"
    technique_id: "T1190"
    technique_name: "Exploit Public-Facing Application"
    description: "optional detail"
---
```

---

## Article MDX Body Structure

Every article uses these exact H2 sections (AI prompt enforces this):

```
## Executive Summary
## Technical Analysis
## Indicators of Compromise
## Tactics, Techniques & Procedures
## Threat Actor Context
## Detection & Hunting Queries
## Mitigations & Recommendations
## References
```

---

## Environment Variables

Copy `.env.example` to `.env.local` and fill in:

```bash
NEXT_PUBLIC_SITE_URL=https://alecybernews.com

# AI — primary article generation (cheap: ~$0.27/1M tokens)
DEEPSEEK_API_KEY=              # https://platform.deepseek.com
# AI — Chinese translation (better ZH quality)
KIMI_API_KEY=                  # https://platform.moonshot.cn

AI_PROVIDER=deepseek           # deepseek | kimi

# Web search for pipeline enrichment
BRAVE_SEARCH_API_KEY=          # https://api.search.brave.com

# Image generation (Phase 2, optional for now)
FAL_KEY=                       # https://fal.ai

# WeChat Official Account (optional)
WECHAT_APP_ID=
WECHAT_APP_SECRET=

# Cloudflare Pages deploy (for GitHub Actions)
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=
```

---

## Build & Dev Commands

```bash
npm run dev        # local dev at http://localhost:3000
npm run build      # production build (must pass before pushing)
npx tsc --noEmit   # type-check only
```

---

## Phase Completion Status

### ✅ Phase 0 — Bootstrap (DONE)
Next.js 16, Tailwind v4, shadcn/ui, all dependencies, `proxy.ts` locale middleware.

### ✅ Phase 1 — Content Layer (DONE)
- `lib/types.ts` — Zod schemas for all frontmatter fields
- `lib/content.ts` — `getAllPosts`, `getPostBySlug`, `getRelatedPosts`, `getAllTags`
- `lib/mdx.ts` — `compileMDX` with remark-gfm, rehype-highlight, rehype-slug
- Article pages: `/[locale]/articles/[slug]` with `generateStaticParams`
- Threat intel pages: `/[locale]/threat-intel/[slug]`
- Pagination on listing pages

### ✅ Phase 2 — Core UI Components (DONE)
- `Header.tsx` — sticky nav, locale switcher (EN↔中文), mobile hamburger
- `Footer.tsx` — links, RSS/WeChat feed links
- `ArticleCard.tsx` — thumbnail, category badge, severity overlay, reading time
- `ArticleMeta.tsx` — date, reading time, severity badge, CVE IDs, threat actor
- `IOCTable.tsx` — client component: sort by type/value/confidence, type filter, copy-to-clipboard, CSV export
- `MitreMatrix.tsx` — tactic columns in ATT&CK order, technique badges linking to attack.mitre.org
- SVG placeholder images for all 6 categories in `public/images/defaults/`
- Dark cybersecurity theme in `globals.css`
- RSS feed API (`/api/feed`) and WeChat JSON API (`/api/wechat?locale=zh`)
- 2 sample articles: LockBit TI report (with real IOCs/TTPs), GPT-5 security analysis

### 🔲 Phase 3 — Search & Additional Pages (TODO)
- Install and configure `pagefind` for static full-text search
- Build `components/search/SearchDialog.tsx` (Cmd/Ctrl+K modal)
- Add search page `app/[locale]/search/page.tsx`
- Add category pages `app/[locale]/categories/[category]/page.tsx`
- Add tag pages `app/[locale]/tags/[tag]/page.tsx`
- `app/sitemap.ts` and `app/robots.ts`

### 🔲 Phase 4 — AI Content Pipeline (TODO)
This is the most important remaining phase. Build `scripts/` directory:

```
scripts/
├── pipeline/
│   ├── index.ts          # orchestrator: npx tsx scripts/pipeline/index.ts --max-articles=5
│   ├── ingest-rss.ts     # fetch 10 RSS feeds, normalize, deduplicate
│   ├── search-web.ts     # Brave/Tavily enrichment per story
│   ├── generate-article.ts  # DeepSeek-V3 generateObject with Zod schema validation
│   ├── translate-article.ts # Kimi K2 EN→ZH translation
│   └── write-mdx.ts      # serialize gray-matter + write to content/
├── ai/
│   ├── provider.ts       # factory: createOpenAICompatible for DeepSeek + Kimi
│   ├── prompts/
│   │   ├── article.ts    # full quality prompt (see below)
│   │   ├── threat-intel.ts
│   │   └── translation.ts
│   └── schemas/
│       ├── article-schema.ts     # Zod schema matching ArticleFrontmatterSchema
│       └── threat-intel-schema.ts
├── sources/
│   └── feeds.ts          # 10 RSS feed URLs
└── utils/
    ├── dedup.ts           # URL hash + fuzzy title dedup
    ├── rate-limit.ts      # p-limit(3) + retry with backoff
    └── cache.ts           # disk cache at .pipeline-cache/processed-urls.json
```

**AI Provider setup** (both use OpenAI-compatible API format):
```typescript
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const deepseek = createOpenAICompatible({
  baseURL: "https://api.deepseek.com/v1",
  apiKey: process.env.DEEPSEEK_API_KEY,
});
const kimi = createOpenAICompatible({
  baseURL: "https://api.moonshot.cn/v1",
  apiKey: process.env.KIMI_API_KEY,
});

export const articleModel = deepseek("deepseek-chat");
export const translationModel = kimi("moonshot-v1-32k");
```

**RSS Feed Sources** to include in `scripts/sources/feeds.ts`:
- https://krebsonsecurity.com/feed/
- https://www.bleepingcomputer.com/feed/
- https://feeds.feedburner.com/TheHackersNews
- https://www.darkreading.com/rss.xml
- https://www.cisa.gov/uscert/ncas/alerts.xml
- https://isc.sans.edu/rssfeed_full.xml
- https://blog.talosintelligence.com/feeds/posts/default
- https://research.checkpoint.com/feed/

**Article generation prompt** (use in `scripts/ai/prompts/article.ts`):
```
You are a senior cybersecurity analyst and technical writer for AleCyberNews.
Write at the level of Krebs on Security — accurate, technically precise, no marketing language.
Use inverted pyramid structure. Attribute claims to sources. Flag uncertainty explicitly.

REQUIRED SECTIONS (exact H2 headers):
## Executive Summary
## Technical Analysis
## Indicators of Compromise
## Tactics, Techniques & Procedures
## Threat Actor Context
## Detection & Hunting Queries
## Mitigations & Recommendations
## References

OUTPUT: JSON with { frontmatter: <ArticleFrontmatter>, body: <MDX string> }
Extract all IOCs into frontmatter.iocs[] and TTPs into frontmatter.ttp_matrix[].
Map TTPs to MITRE ATT&CK technique IDs where possible.
```

### 🔲 Phase 5 — GitHub Actions (TODO)
Create `.github/workflows/`:

**`build-deploy.yml`** — triggers on push to main, deploys to Cloudflare Pages:
```yaml
on:
  push:
    branches: [main]
  workflow_dispatch:
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run build
        env:
          NEXT_PUBLIC_SITE_URL: ${{ vars.NEXT_PUBLIC_SITE_URL }}
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy .next --project-name=alecybernews
```

**`ai-content-pipeline.yml`** — runs daily, generates articles, commits, triggers build:
```yaml
on:
  schedule:
    - cron: '0 2 * * *'
    - cron: '0 14 * * *'
  workflow_dispatch:
    inputs:
      max_articles: { default: '5' }
jobs:
  generate:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npx tsx scripts/pipeline/index.ts --max-articles=${{ inputs.max_articles || '5' }}
        env:
          DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
          KIMI_API_KEY: ${{ secrets.KIMI_API_KEY }}
          BRAVE_SEARCH_API_KEY: ${{ secrets.BRAVE_SEARCH_API_KEY }}
      - name: Commit generated content
        run: |
          git config user.name "alecybernews-bot"
          git config user.email "bot@alecybernews.com"
          git add content/ public/images/articles/
          git diff --staged --quiet || git commit -m "chore: ai pipeline $(date -u +%Y-%m-%dT%H:%M:%SZ)"
          git push
```

### 🔲 Phase 6 — SEO & Performance (TODO)
- `generateMetadata` in every `page.tsx` with og:image, hreflang (`zh-Hans`)
- `app/sitemap.ts` — XML sitemap from all posts
- `app/robots.ts`
- JSON-LD `NewsArticle` structured data on article pages
- Baidu site verification meta tag in ZH locale layout

---

## Key Design Decisions (for context)

1. **`proxy.ts` not `middleware.ts`** — Next.js 16 breaking change, already handled
2. **DeepSeek-V3 for articles** — ~$0.27/1M tokens vs ~$15 for Claude Opus. Use `deepseek-chat` model ID
3. **Kimi K2 for Chinese** — better ZH quality than DeepSeek. Use `moonshot-v1-32k` model ID
4. **No `output: 'export'`** — Cloudflare Pages supports API routes natively, keeps `/api/feed` and `/api/wechat` live
5. **Images deferred to Phase 2** — fal.ai FLUX.1-schnell at ~$0.003/image when ready
6. **Antivirus note** — threat intel MDX files with IOC hashes may trigger AV false positives (harmless text files)

---

## How to Continue in a New Session

Tell Claude:
> "Read CLAUDE.md and continue from Phase [3/4/5/6]"

Claude will read this file and have full context to continue immediately.
