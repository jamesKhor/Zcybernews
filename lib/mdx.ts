import { compileMDX as nextMdxCompile } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";
import type { ReactElement } from "react";
import { MDXCode } from "@/components/cve/CVEBadge";
import { rehypeCVE } from "./rehype-cve";

export async function compileMDX(source: string): Promise<{
  content: ReactElement;
  headings: { id: string; text: string; level: number }[];
}> {
  const { content } = await nextMdxCompile({
    source,
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

  // Extract headings for Table of Contents
  const headings = extractHeadings(source);

  return { content, headings };
}

function extractHeadings(
  source: string,
): { id: string; text: string; level: number }[] {
  const headingRegex = /^(#{2,3})\s+(.+)$/gm;
  const headings: { id: string; text: string; level: number }[] = [];
  let match;

  while ((match = headingRegex.exec(source)) !== null) {
    const level = match[1].length;
    const text = match[2].trim();
    // Generate slug matching rehype-slug behavior
    const id = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .trim();
    headings.push({ id, text, level });
  }

  return headings;
}
