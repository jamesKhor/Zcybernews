/**
 * rehype-cve
 *
 * Finds plain-text CVE IDs (CVE-YYYY-NNNNN) in HTML text nodes that are NOT
 * already inside a <code> element (those are handled by the MDXCode component)
 * and wraps them with <span data-cve="CVE-…">CVE-…</span> so the client-side
 * CVE hydration script can upgrade them to interactive badges.
 *
 * This covers CVEs written without backticks in the markdown source.
 */

import { visit } from "unist-util-visit";
import type { Root, Text, Element, Parent } from "hast";

const CVE_REGEX = /\b(CVE-\d{4}-\d{4,})\b/gi;

// Tags whose children we leave alone (already handled or not appropriate)
const SKIP_PARENTS = new Set(["code", "pre", "a", "script", "style"]);

export function rehypeCVE() {
  return (tree: Root) => {
    visit(
      tree,
      "text",
      (node: Text, index: number | undefined, parent: Parent | undefined) => {
        if (!parent || index === undefined) return;

        // Skip if parent is a code/pre/a/script/style element
        const parentEl = parent as Element;
        if (parentEl.tagName && SKIP_PARENTS.has(parentEl.tagName)) return;

        const text = node.value;
        if (!CVE_REGEX.test(text)) return;
        CVE_REGEX.lastIndex = 0; // reset after test()

        // Split text around CVE matches and rebuild as mixed text+element nodes
        const parts: (Text | Element)[] = [];
        let lastIndex = 0;
        let match: RegExpExecArray | null;

        CVE_REGEX.lastIndex = 0;
        while ((match = CVE_REGEX.exec(text)) !== null) {
          const cveId = match[1].toUpperCase();

          // Text before the match
          if (match.index > lastIndex) {
            parts.push({
              type: "text",
              value: text.slice(lastIndex, match.index),
            });
          }

          // The CVE wrapped in a span with data attribute
          parts.push({
            type: "element",
            tagName: "span",
            properties: { "data-cve": cveId },
            children: [{ type: "text", value: cveId }],
          } as Element);

          lastIndex = match.index + match[0].length;
        }

        // Remaining text after last match
        if (lastIndex < text.length) {
          parts.push({ type: "text", value: text.slice(lastIndex) });
        }

        if (
          parts.length > 1 ||
          (parts.length === 1 && parts[0].type === "element")
        ) {
          // Replace this single text node with multiple nodes
          (parent as Parent).children.splice(index, 1, ...parts);
          // Return the index shift so unist-util-visit skips the inserted nodes
          return index + parts.length;
        }
      },
    );
  };
}
