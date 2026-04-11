"use client";

/**
 * CVEHydrate
 *
 * After SSR, this component scans the article DOM for [data-cve] spans
 * created by the rehype-cve plugin (plain-text CVE mentions without backticks)
 * and replaces them with interactive CVEBadge portals.
 *
 * CVEs already in backticks are handled by the MDXCode override — this covers
 * the remaining unformatted mentions.
 */

import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { CVEBadge } from "./CVEBadge";

export function CVEHydrate({
  articleRef,
}: {
  articleRef: React.RefObject<HTMLDivElement | null>;
}) {
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current || !articleRef.current) return;
    hydratedRef.current = true;

    const spans =
      articleRef.current.querySelectorAll<HTMLSpanElement>("span[data-cve]");
    spans.forEach((span) => {
      const cveId = span.getAttribute("data-cve");
      if (!cveId) return;

      // Replace the span with a React root so CVEBadge renders interactively
      const container = document.createElement("span");
      span.replaceWith(container);
      const root = createRoot(container);
      root.render(<CVEBadge id={cveId} />);
    });
  }, [articleRef]);

  return null;
}
