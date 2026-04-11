"use client";

import { useRef, type ReactElement } from "react";
import { CVEHydrate } from "./CVEHydrate";

/**
 * Wraps the MDX article body.
 * - Provides a ref so CVEHydrate can scan for [data-cve] spans
 *   injected by the rehype-cve plugin (plain-text CVE mentions)
 * - CVEs in backtick code are handled by MDXCode before we get here
 */
export function CVEArticleBody({ children }: { children: ReactElement }) {
  const ref = useRef<HTMLDivElement>(null);

  return (
    <>
      <div className="prose" ref={ref}>
        {children}
      </div>
      <CVEHydrate articleRef={ref} />
    </>
  );
}
