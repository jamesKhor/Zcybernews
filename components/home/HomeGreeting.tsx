"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";

/**
 * Greeting strip (Phase 2, 2026-04-18; trimmed 2026-04-22).
 *
 * Originally shipped with a hero search button that opened the shared
 * SearchDialog modal. Removed per B-005 — the header already exposes
 * the same dialog via Ctrl/⌘+K and the header's search affordance. Two
 * entry points to the same modal on one viewport was redundant, and
 * the Phase 2 design intent (hero discoverability) is already carried
 * by the 3-column hero immediately below this strip.
 *
 * Mobile: vertical stack collapses to a single line.
 * Desktop (≥sm): date + prompt inline, left-aligned.
 *
 * Date is formatted client-side so it shows the visitor's local date
 * (not the server's UTC). ISR caches the HTML for 1h, so the initial
 * SSR'd date may be stale by a few minutes — not user-facing relevant
 * at day-precision granularity.
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
  // day-precision granularity (APR 18, 2026 display).
  const dateStr = useMemo(() => formatDate(new Date(), locale), [locale]);

  return (
    <section
      aria-label={t("greetingAriaLabel")}
      className="max-w-7xl mx-auto px-4 py-4 sm:py-5 border-b border-border"
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
    </section>
  );
}
