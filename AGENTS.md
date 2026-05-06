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
