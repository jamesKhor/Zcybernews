import { compileMDX as nextMdxCompile } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";
import GithubSlugger from "github-slugger";
import type { ReactElement } from "react";
import { MDXCode } from "@/components/cve/CVEBadge";
import { rehypeCVE } from "./rehype-cve";
import {
  stripReferencesSection as _stripReferencesSection,
  stripEmptyConditionalSections as _stripEmptyConditionalSections,
} from "./mdx-strip";

// Re-export the pure helpers from their no-imports sibling (lib/mdx-strip.ts)
// so existing callers + tests that import from "@/lib/mdx" keep working
// without changing import paths.
export const stripReferencesSection = _stripReferencesSection;
export const stripEmptyConditionalSections = _stripEmptyConditionalSections;

export type CompileMDXOptions = {
  /**
   * When true, strip the `## References` section (and all content below it)
   * from the source before compiling. Use for public article pages — the
   * reference list is for internal admin review only, not for end-readers.
   *
   * Matches English ("References", "Sources") and Chinese common variants
   * ("参考文献", "参考资料", "来源"). Case-insensitive. Greedy from the
   * heading to end of file.
   */
  stripReferences?: boolean;
};

export async function compileMDX(
  source: string,
  options: CompileMDXOptions = {},
): Promise<{
  content: ReactElement;
  headings: { id: string; text: string; level: number }[];
}> {
  // Always strip empty conditional-section stubs — they provide zero
  // reader value regardless of whether refs are stripped. Pure string
  // op, ~one regex pass.
  const stubFreeSource = stripEmptyConditionalSections(source);
  const processedSource = options.stripReferences
    ? stripReferencesSection(stubFreeSource)
    : stubFreeSource;

  const { content } = await nextMdxCompile({
    source: processedSource,
    options: {
      mdxOptions: {
        remarkPlugins: [remarkGfm],
        rehypePlugins: [rehypeHighlight, rehypeSlug, rehypeCVE],
      },
    },
    components: {
      // Intercept inline code — upgrades CVE-XXXX-XXXXX to a hover badge
      code: MDXCode,
    },
  });

  // Extract headings for Table of Contents from the processed source
  // (so the TOC doesn't list a References heading that's been stripped)
  const headings = extractHeadings(processedSource);

  return { content, headings };
}

function extractHeadings(
  source: string,
): { id: string; text: string; level: number }[] {
  const headingRegex = /^(#{2,3})\s+(.+)$/gm;
  const headings: { id: string; text: string; level: number }[] = [];
  const slugger = new GithubSlugger();
  let match;

  while ((match = headingRegex.exec(source)) !== null) {
    const level = match[1].length;
    const text = match[2].trim();
    const id = slugger.slug(text);
    headings.push({ id, text, level });
  }

  return headings;
}
