/**
 * SalaryCard — server component, renders one role × market record.
 *
 * Editorial restraint: dense data, restrained typography, no chart
 * library. Three horizontal CSS bars (entry/mid/senior) scaled
 * relative to the senior-band high. Numbers stay in source currency
 * — universal across locales.
 *
 * Mobile-first: stacks vertically on narrow viewports; on tablet+
 * the bar viz takes full width and metadata sits below.
 */
import type { SalaryRecord } from "@/lib/salary";
import {
  parseSalaryRange,
  currencySymbol,
  toUsd,
  formatUsdShort,
  classifyMarket,
  MARKETS,
} from "@/lib/salary";
import { ExternalLink } from "lucide-react";

interface Props {
  record: SalaryRecord;
  locale: "en" | "zh";
  labels: {
    entryLevel: string;
    midLevel: string;
    seniorLevel: string;
    yearsExperience: string;
    topHiring: string;
    requiredCerts: string;
    source: string;
    monthly: string;
    topEarners: string;
    topEarnersNote: string;
  };
}

export function SalaryCard({ record, locale, labels }: Props) {
  const marketKey = classifyMarket(record.market);
  const marketMeta = MARKETS.find((m) => m.key === marketKey);

  // Parse the three salary ranges. Senior high becomes our scale anchor
  // for the bar viz so all bars fit within the card.
  const entry = parseSalaryRange(record.entry_salary);
  const mid = parseSalaryRange(record.mid_salary);
  const senior = parseSalaryRange(record.senior_salary);
  const scaleMax = senior?.high ?? mid?.high ?? entry?.high ?? 100;
  const symbol = currencySymbol(record.currency);

  const bands: Array<{
    key: string;
    label: string;
    yoe: string;
    raw: string;
    monthly?: string;
    range: { low: number; high: number } | null;
    accent: string;
  }> = [
    {
      key: "entry",
      label: labels.entryLevel,
      yoe: record.yoe_entry,
      raw: record.entry_salary,
      monthly: record.monthly_entry,
      range: entry,
      accent: "bg-emerald-500/30 border-emerald-400",
    },
    {
      key: "mid",
      label: labels.midLevel,
      yoe: record.yoe_mid,
      raw: record.mid_salary,
      monthly: record.monthly_mid,
      range: mid,
      accent: "bg-cyan-500/40 border-cyan-400",
    },
    {
      key: "senior",
      label: labels.seniorLevel,
      yoe: record.yoe_senior,
      raw: record.senior_salary,
      monthly: record.monthly_senior,
      range: senior,
      accent: "bg-amber-500/50 border-amber-400",
    },
  ];

  // Try to render source URL as a clickable link only if it parses as one.
  let sourceHost: string | null = null;
  let sourceUrl: string | null = null;
  if (record.source_url) {
    try {
      const u = new URL(record.source_url);
      sourceHost = u.hostname.replace(/^www\./, "");
      sourceUrl = record.source_url;
    } catch {
      // Not a parseable URL — display nothing rather than broken link
    }
  }

  return (
    <article className="border border-border/60 bg-card/40 rounded-md p-5 sm:p-6 hover:border-border hover:bg-card/60 transition-colors">
      {/* Header — role + market + currency.
          NYT data-sheet discipline: no decorative divider, just whitespace.
          Eyebrow strip carries market + currency + flag in tabular voice. */}
      <header className="mb-5">
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground/90 mb-2">
          <span aria-hidden>{marketMeta?.flag ?? "🌐"}</span>
          <span>{locale === "zh" ? marketMeta?.zh : marketMeta?.en}</span>
          <span className="text-border" aria-hidden>
            ·
          </span>
          <span className="tabular-nums">{record.currency}</span>
        </div>
        <h3 className="text-base sm:text-lg font-semibold text-foreground leading-snug tracking-tight">
          {record.role}
        </h3>
      </header>

      {/* Three salary bands as horizontal bars.
          NYT data-table treatment: label + YoE on left line, big tabular
          numerals on right. Bar sits below with low/high tick anchors so
          the visual range is read as data, not decoration. */}
      <dl className="space-y-5 mb-5">
        {bands.map((b) => {
          const widthPct = b.range
            ? Math.max(8, Math.min(100, (b.range.high / scaleMax) * 100))
            : 0;
          const lowPct = b.range
            ? Math.max(0, (b.range.low / scaleMax) * 100)
            : 0;
          const usdMid = b.range
            ? toUsd(
                Math.round((b.range.low + b.range.high) / 2),
                record.currency,
              )
            : 0;

          return (
            <div key={b.key} className="grid grid-cols-1 gap-1.5">
              {/* Top line: label + YoE chip */}
              <div className="flex items-baseline justify-between gap-2">
                <dt className="flex items-baseline gap-2 min-w-0">
                  <span className="text-[11px] uppercase tracking-[0.12em] font-medium text-foreground/85">
                    {b.label}
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground/80 tabular-nums shrink-0">
                    {b.yoe}{" "}
                    <span className="opacity-60">{labels.yearsExperience}</span>
                  </span>
                </dt>
                <dd className="text-[11px] font-mono text-muted-foreground/70 tabular-nums shrink-0">
                  ≈ {formatUsdShort(usdMid)}
                </dd>
              </div>
              {/* Big number — the data hero */}
              <p className="text-[15px] sm:text-base font-semibold font-mono text-foreground tabular-nums leading-tight">
                <span className="text-muted-foreground/70 mr-1 font-normal">
                  {symbol}
                </span>
                {b.raw}
              </p>
              {/* Bar — pure CSS, no JS dep, with subtle tick anchors */}
              <div className="relative h-1.5 rounded-full bg-muted/40 overflow-hidden">
                {b.range && (
                  <div
                    className={`absolute top-0 bottom-0 ${b.accent} rounded-full`}
                    style={{
                      left: `${lowPct}%`,
                      width: `${Math.max(2, widthPct - lowPct)}%`,
                    }}
                    aria-label={`${b.label}: ${b.raw} ${record.currency}`}
                  />
                )}
              </div>
              {b.monthly && (
                <p className="text-[10px] font-mono text-muted-foreground/60 tabular-nums">
                  {labels.monthly}:{" "}
                  <span className="text-muted-foreground/85">{b.monthly}</span>
                </p>
              )}
            </div>
          );
        })}
      </dl>

      {/* Top-of-market row — outliers, principals, regional CISOs.
          NYT discipline: rendered as just another data row, not a coloured
          panel. The "non-median" caveat is in the eyebrow so editorial
          integrity is preserved without visual marketing. */}
      {record.top_tier_salary && (
        <div className="mb-5 grid grid-cols-1 gap-1.5 pt-3 border-t border-border/40">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[11px] uppercase tracking-[0.12em] font-medium text-amber-400/90">
              {labels.topEarners}
            </p>
            <p className="text-[10px] font-mono text-muted-foreground/60 italic shrink-0">
              {labels.topEarnersNote}
            </p>
          </div>
          <p className="text-[15px] sm:text-base font-semibold font-mono text-foreground/95 tabular-nums leading-tight">
            {record.top_tier_salary}
          </p>
          {record.top_tier_note && (
            <p className="text-xs text-muted-foreground/80 leading-relaxed">
              {record.top_tier_note}
            </p>
          )}
        </div>
      )}

      {/* Top hiring chips — labelled data row */}
      {record.top_hiring.length > 0 && (
        <div className="mb-4 grid grid-cols-1 gap-1.5">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/80 font-medium">
            {labels.topHiring}
          </p>
          <div className="flex flex-wrap gap-x-1.5 gap-y-1">
            {record.top_hiring.slice(0, 6).map((co) => (
              <span
                key={co}
                className="inline-block text-[11px] leading-snug px-2 py-0.5 rounded-sm border border-border/50 bg-background/30 text-foreground/80"
              >
                {co}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Required certs chips — anchored to cert ROI table */}
      {record.required_certs.length > 0 && (
        <div className="mb-4 grid grid-cols-1 gap-1.5">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/80 font-medium">
            {labels.requiredCerts}
          </p>
          <div className="flex flex-wrap gap-x-1.5 gap-y-1">
            {record.required_certs.map((c) => (
              <a
                key={c}
                href="#cert-roi"
                className="inline-block text-[11px] leading-snug px-2 py-0.5 rounded-sm border border-primary/30 bg-primary/[0.04] text-primary hover:bg-primary/10 transition-colors font-mono"
              >
                {c}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Source attribution — footnote-style */}
      {sourceHost && sourceUrl && (
        <footer className="pt-3 border-t border-border/40">
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] text-muted-foreground/80 hover:text-primary transition-colors font-mono"
          >
            <ExternalLink className="size-2.5" />
            {labels.source}: {sourceHost}
          </a>
        </footer>
      )}
    </article>
  );
}
