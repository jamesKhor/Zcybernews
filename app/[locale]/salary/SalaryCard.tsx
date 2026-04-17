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
    shockingFact: string;
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
    <article className="border border-border/60 bg-card rounded-lg p-5 sm:p-6 hover:border-border transition-colors">
      {/* Header — role + market + currency */}
      <header className="mb-5 pb-4 border-b border-border/50">
        <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">
          <span>{marketMeta?.flag ?? "🌐"}</span>
          <span>{locale === "zh" ? marketMeta?.zh : marketMeta?.en}</span>
          <span className="text-border">·</span>
          <span>{record.currency}</span>
        </div>
        <h3 className="text-lg sm:text-xl font-semibold text-foreground leading-tight">
          {record.role}
        </h3>
      </header>

      {/* Three salary bands as horizontal bars */}
      <dl className="space-y-4 mb-5">
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
            <div key={b.key}>
              <div className="flex items-baseline justify-between gap-2 mb-1.5 text-sm">
                <dt className="flex items-baseline gap-2">
                  <span className="font-medium text-foreground">{b.label}</span>
                  <span className="text-xs font-mono text-muted-foreground">
                    {b.yoe} {labels.yearsExperience}
                  </span>
                </dt>
                <dd className="font-mono text-foreground tabular-nums">
                  {symbol} {b.raw}
                  <span className="ml-2 text-xs text-muted-foreground">
                    ≈ {formatUsdShort(usdMid)}
                  </span>
                </dd>
              </div>
              {/* The bar — pure CSS, no JS dep */}
              <div className="relative h-2.5 rounded-full bg-muted/50 overflow-hidden">
                {b.range && (
                  <div
                    className={`absolute top-0 bottom-0 ${b.accent} border-r-2 rounded-r-full`}
                    style={{
                      left: `${lowPct}%`,
                      width: `${widthPct - lowPct}%`,
                    }}
                    aria-label={`${b.label}: ${b.raw} ${record.currency}`}
                  />
                )}
              </div>
              {b.monthly && (
                <p className="mt-1 text-[11px] font-mono text-muted-foreground/70">
                  {labels.monthly}: {b.monthly}
                </p>
              )}
            </div>
          );
        })}
      </dl>

      {/* Top-of-market callout — outliers, principals, regional CISOs.
          Editorially separate from senior-band median data.
          Sized small but visually distinct so it doesn't displace the
          primary three-band chart, but still catches a scrolling reader's
          eye on mobile (the XHS-tap audience). */}
      {record.top_tier_salary && (
        <div className="mb-5 -mt-1 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <p className="text-[10px] uppercase tracking-wider font-mono text-amber-400/90">
              {labels.topEarners}
            </p>
            <p className="text-[10px] font-mono text-amber-400/60 italic">
              {labels.topEarnersNote}
            </p>
          </div>
          <p className="text-sm font-mono font-semibold text-foreground/95 leading-snug">
            {record.top_tier_salary}
          </p>
          {record.top_tier_note && (
            <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
              {record.top_tier_note}
            </p>
          )}
        </div>
      )}

      {/* Top hiring chips */}
      {record.top_hiring.length > 0 && (
        <div className="mb-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
            {labels.topHiring}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {record.top_hiring.slice(0, 6).map((co) => (
              <span
                key={co}
                className="inline-block text-xs px-2 py-0.5 rounded border border-border/60 bg-background/40 text-foreground/80"
              >
                {co}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Required certs chips */}
      {record.required_certs.length > 0 && (
        <div className="mb-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
            {labels.requiredCerts}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {record.required_certs.map((c) => (
              <a
                key={c}
                href="#cert-roi"
                className="inline-block text-xs px-2 py-0.5 rounded border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 transition-colors font-mono"
              >
                {c}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Shocking fact pull-quote — FT/NYT style sidebar */}
      {record.shocking_fact && (
        <blockquote
          lang="zh"
          className="my-4 pl-3 border-l-2 border-primary/60 text-sm italic text-foreground/85 leading-relaxed"
        >
          <p className="text-[10px] not-italic uppercase tracking-wider text-primary/80 mb-1 font-sans">
            {labels.shockingFact}
          </p>
          {record.shocking_fact}
        </blockquote>
      )}

      {/* Source attribution */}
      {sourceHost && sourceUrl && (
        <footer className="pt-3 border-t border-border/40">
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            <ExternalLink className="size-3" />
            {labels.source}: {sourceHost}
          </a>
        </footer>
      )}
    </article>
  );
}
