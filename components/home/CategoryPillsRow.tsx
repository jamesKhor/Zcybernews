import Link from "next/link";
import { useTranslations } from "next-intl";

/**
 * Horizontal category pills row. Sticky once scrolled past its original
 * position (top: 56px = header height). Horizontal scroll on mobile.
 *
 * Pills: ALL · THREAT INTEL · VULNERABILITIES · MALWARE · INDUSTRY ·
 *        TOOLS · AI
 *
 * ALL pill is active on the homepage. Other pills route to
 * /[locale]/categories/[category]. No JS state needed for active
 * highlighting on /[locale] (server knows we're on the homepage).
 *
 * Server component — zero JS.
 */

interface Props {
  locale: "en" | "zh";
}

const CATEGORIES = [
  { key: "threat-intel", hue: "var(--cat-threat-intel)" },
  { key: "vulnerabilities", hue: "var(--cat-vulnerabilities)" },
  { key: "malware", hue: "var(--cat-malware)" },
  { key: "industry", hue: "var(--cat-industry)" },
  { key: "tools", hue: "var(--cat-tools)" },
  { key: "ai", hue: "var(--cat-ai)" },
] as const;

export function CategoryPillsRow({ locale }: Props) {
  const tCats = useTranslations("categories");
  const tHome = useTranslations("home");

  return (
    <nav
      aria-label={tHome("categoryNavAriaLabel")}
      className="sticky top-14 z-30 border-y border-border bg-background/95 backdrop-blur-sm"
    >
      <div className="max-w-7xl mx-auto">
        <ul className="flex items-center gap-2 px-4 py-2.5 overflow-x-auto scrollbar-none whitespace-nowrap">
          <li>
            <Link
              href={`/${locale}`}
              aria-current="page"
              className="inline-flex items-center min-h-8 px-3.5 py-1 rounded-full text-[11px] font-mono uppercase tracking-[0.12em] font-bold bg-foreground text-background hover:bg-foreground/90 transition-colors"
            >
              {tHome("categoryAll")}
            </Link>
          </li>
          {CATEGORIES.map((cat) => (
            <li key={cat.key}>
              <Link
                href={`/${locale}/categories/${cat.key}`}
                className="inline-flex items-center min-h-8 px-3.5 py-1 rounded-full text-[11px] font-mono uppercase tracking-[0.12em] font-semibold border border-border bg-card hover:bg-secondary hover:border-foreground/30 transition-colors text-muted-foreground"
                style={{
                  // Subtle colored left-border accent
                  borderLeftColor: `hsl(${cat.hue})`,
                  borderLeftWidth: "3px",
                }}
              >
                {tCats(cat.key)}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
