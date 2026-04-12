# ZCyberNews

A professional cybersecurity and tech intelligence site built with Next.js 15, featuring AI-powered content generation, bilingual support (English/Chinese), and deep threat intelligence sections.

## Stack

- **Next.js 15** (App Router, TypeScript)
- **Tailwind CSS v4** + shadcn/ui
- **next-intl** — EN/ZH bilingual routing
- **gray-matter** + **next-mdx-remote** — Git-based MDX content
- **DeepSeek-V3** / **Kimi K2** — AI article generation
- **Cloudflare Pages** — deployment

## Getting Started

```bash
npm install
cp .env.example .env.local
# Fill in your API keys in .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — redirects to `/en`.

## Content Structure

- `content/en/posts/` — English articles (MDX)
- `content/zh/posts/` — Chinese articles (MDX)
- `content/en/threat-intel/` — English TI reports
- `content/zh/threat-intel/` — Chinese TI reports

## Environment Variables

See `.env.example` for all required variables.
