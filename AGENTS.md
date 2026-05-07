<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# Official Docs — No Context7 requirement

Do not require Context7 for this project. Before writing code that uses a
library from the tech stack, check official documentation directly.

Preferred lookup order:

1. Use local installed docs when they exist, especially
   `node_modules/next/dist/docs/` for Next.js.
2. If local docs are missing or insufficient, browse the library's official
   documentation site or official repository.
3. Cite or summarize the relevant docs in the handoff when the behavior is
   version-sensitive.

**Tech stack libraries requiring official-doc lookup:**

- `next` — Next.js 16 (breaking changes from 15, always check docs)
- `next-auth` — Auth.js v5 beta (API differs significantly from v4)
- `next-intl` — v4.x (locale routing, middleware integration)
- `ai` / `@ai-sdk/openai-compatible` — Vercel AI SDK v6
- `zod` — v4.x schema validation
- `pagefind` — static search indexing
- `rss-parser` — feed parsing

**Rule:** Do not rely on training data for any of the above. Use installed
package docs or official vendor docs first, then write code.

# Pipeline validation rule

After changing the RSS/AI publishing pipeline, provider routing, parser/schema
handling, publish gates, Telegram/decision-matrix output, or related docs, run a
pipeline dry run before handoff:

```bash
npx tsx scripts/pipeline/index.ts --max-articles=3 --dry-run
```

Confirm the command exits successfully and inspect the selected story clusters
and summary output for obviously wrong routing, duplicate handling, broken
provider imports, noisy operator messages, or funny-looking decision text. If
the change can affect generated article shape, also run the smallest relevant
parser/schema/quality tests and mention both the dry-run result and any output
sanity findings in the handoff. Revert or exclude dry-run-only artifacts such as
`data/feed-health.json` unless the task explicitly asks to update them.
