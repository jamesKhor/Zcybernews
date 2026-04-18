"use client";

import { useTranslations } from "next-intl";
import { useState, useMemo } from "react";
import { Search } from "lucide-react";
import { SearchDialog } from "@/components/search/SearchDialog";

/**
 * Greeting strip + search bar (Phase 2, 2026-04-18).
 *
 * Mobile: vertical stack — greeting line, then full-width search pill.
 * Desktop (≥sm): side-by-side row.
 *
 * Date is formatted client-side so it shows the visitor's local date (not
 * the server's UTC). ISR caches the HTML for 1h, so the initial SSR'd date
 * may be stale by a few minutes — not user-facing relevant.
 *
 * Search bar is a display-only button that opens the existing SearchDialog
 * modal. Zero new API work. We reuse the same modal the header search icon
 * opens.
 */

interface Props {
  locale: "en" | "zh";
}

function formatDate(date: Date, locale: "en" | "zh"): string {
  if (locale === "zh") {
    // YYYY年M月D日 (Chinese calendar-style)
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  }
  // "APR 18, 2026" — uppercase month abbrev
  return date
    .toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
    .toUpperCase();
}

export function HomeGreeting({ locale }: Props) {
  const t = useTranslations("home");
  // Compute the date once per render. ISR caches the HTML for 1h, so
  // the date can be slightly stale on edge-cached pages — acceptable at
  // day-precision granularity (APR 18, 2026 display). Avoids a useState+
  // useEffect dance that would just flicker on mount.
  const dateStr = useMemo(() => formatDate(new Date(), locale), [locale]);
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <section
      aria-label={t("greetingAriaLabel")}
      className="max-w-7xl mx-auto px-4 py-4 sm:py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-6 border-b border-border"
    >
      <div className="flex items-baseline gap-2 flex-wrap text-sm">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] font-semibold text-foreground/80">
          {dateStr}
        </span>
        <span className="text-border" aria-hidden>
          ·
        </span>
        <span className="text-foreground/90">{t("greetingPrompt")}</span>
      </div>

      {/* Search bar — button styled like an input. Opens SearchDialog modal. */}
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="flex items-center gap-2 w-full sm:w-auto sm:min-w-[280px] px-4 py-2.5 rounded-md border border-border bg-card hover:bg-secondary hover:border-foreground/20 transition-colors text-sm text-muted-foreground text-left min-h-11"
        aria-label={t("searchAriaLabel")}
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 truncate">{t("searchPlaceholder")}</span>
        <kbd className="hidden sm:inline-flex text-[10px] font-mono px-1.5 py-0.5 rounded border border-border bg-background/50 text-muted-foreground">
          ⌘K
        </kbd>
      </button>

      {/* The actual dialog — rendered inline so it's always available.
          SearchDialog handles its own visibility via the open prop. */}
      <SearchDialog
        locale={locale}
        open={searchOpen}
        onOpenChange={setSearchOpen}
      />
    </section>
  );
}
