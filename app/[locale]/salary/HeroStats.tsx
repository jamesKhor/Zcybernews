/**
 * HeroStats — server component, "zoom-in" big-number panel.
 *
 * Visual reference: the dribbble Customer Orders / New iOS Users
 * screenshots — one massive numeral as the data hero, small label
 * below, comparison delta to anchor the scale.
 *
 * Three slots:
 *   1. Highest top-of-market salary (the aspirational ceiling)
 *   2. Highest entry-level base   (the floor — what you start at)
 *   3. Senior-band cross-market spread (the geographic arbitrage)
 *
 * All numbers are derived from the dataset at render time so they
 * stay in sync as records are added.
 */
import {
  classifyMarket,
  parseSalaryRange,
  toUsd,
  formatUsdShort,
  currencySymbol,
  MARKETS,
  type SalaryRecord,
} from "@/lib/salary";

// ── Hero number formatter ──────────────────────────────────────────
// The operator's alignment rule: "nothing will be like 'hey why is that
// site say that but your site say this.'" XHS cards quote source
// currency (HKD 2M, SGD 120k). Our HeroStats must lead with source
// currency so readers see the same primary number on both surfaces.
// USD becomes a secondary conversion, not the headline.

/** Compact format for display: 2,500,000 → "2.5M", 85,000 → "85k". */
function formatCompactNumber(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    // 2.0M → 2M, but 2.5M stays 2.5M (drop trailing .0)
    return m % 1 === 0 ? `${m.toFixed(0)}M` : `${m.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${Math.round(n / 1_000)}k`;
  }
  return `${n}`;
}

/** "2,500,000" with commas stripped → "HK$2.5M" for the hero display. */
function formatSourceCompact(amount: number, currency: string): string {
  return `${currencySymbol(currency)}${formatCompactNumber(amount)}`;
}

interface Props {
  records: SalaryRecord[];
  locale: "en" | "zh";
  labels: {
    eyebrowCeiling: string;
    eyebrowEntry: string;
    eyebrowSpread: string;
    descCeiling: string;
    descEntry: string;
    descSpread: string;
    deltaCeiling: string;
    deltaEntry: string;
    deltaSpread: string;
  };
}

interface Peak {
  /** The headline number, pre-formatted with currency symbol */
  display: string;
  /** Sub-label — market name + role context */
  context: string;
  /** A small delta / comparison line */
  delta: string;
}

function findCeiling(records: SalaryRecord[], locale: "en" | "zh"): Peak {
  // Highest top_tier_salary high-end (parsed) wins.
  // Fall back to highest senior_salary high-end if no top_tier present.
  let best: {
    usd: number;
    high: number;
    raw: string;
    record: SalaryRecord;
  } | null = null;

  for (const r of records) {
    const tier = r.top_tier_salary;
    if (tier) {
      const range = parseSalaryRange(tier);
      if (range) {
        const usd = toUsd(range.high, r.currency);
        if (!best || usd > best.usd) {
          best = { usd, high: range.high, raw: tier, record: r };
        }
      }
    }
  }
  if (!best) {
    for (const r of records) {
      const range = parseSalaryRange(r.senior_salary);
      if (!range) continue;
      const usd = toUsd(range.high, r.currency);
      if (!best || usd > best.usd) {
        best = { usd, high: range.high, raw: r.senior_salary, record: r };
      }
    }
  }
  if (!best) {
    return { display: "—", context: "", delta: "" };
  }
  const meta = MARKETS.find(
    (m) => m.key === classifyMarket(best!.record.market),
  );
  return {
    // HERO: source currency (HK$2.5M) — matches XHS card copy exactly
    display: formatSourceCompact(best.high, best.record.currency),
    context: `${meta?.flag ?? ""} ${locale === "zh" ? meta?.zh : meta?.en} · ${best.record.role.split("（")[0].trim().slice(0, 38)}`,
    // DELTA: USD conversion + the raw source phrase with its qualifiers
    delta: `≈ ${formatUsdShort(best.usd)} · ${best.raw}`,
  };
}

function findFloor(records: SalaryRecord[], locale: "en" | "zh"): Peak {
  // Highest entry-level low-end across genuine ENTRY-TRACK roles
  // (SOC Analyst / Junior / generic Analyst / career ladder Junior).
  // Skip Architect / CISO / Cloud / Pentest specialist tracks — their
  // "entry" band is a mid-level IC salary, not a true graduate floor.
  const isJuniorTrack = (r: SalaryRecord): boolean => {
    const role = r.role.toLowerCase();
    const slug = r.slug.toLowerCase();
    // Reject explicit specialist / executive tracks
    if (
      slug.includes("ciso-salary") ||
      slug.includes("architect-salary") ||
      slug.includes("cloud-security-engineer-salary") ||
      role === "ciso" ||
      role.startsWith("security architect") ||
      role.startsWith("cloud security")
    ) {
      return false;
    }
    // Accept SOC/analyst/junior/career-ladder records
    return (
      role.includes("soc") ||
      role.includes("junior") ||
      role.includes("analyst") ||
      role.includes("career") ||
      role.includes("梯子") ||
      role.includes("分析师")
    );
  };
  let best: {
    usd: number;
    low: number;
    raw: string;
    record: SalaryRecord;
  } | null = null;
  for (const r of records) {
    if (classifyMarket(r.market) === "cross") continue;
    if (!isJuniorTrack(r)) continue;
    const range = parseSalaryRange(r.entry_salary);
    if (!range) continue;
    const usd = toUsd(range.low, r.currency);
    if (!best || usd > best.usd) {
      best = { usd, low: range.low, raw: r.entry_salary, record: r };
    }
  }
  if (!best) return { display: "—", context: "", delta: "" };
  const meta = MARKETS.find(
    (m) => m.key === classifyMarket(best!.record.market),
  );
  return {
    // HERO: source currency (HK$52k) — matches XHS card copy exactly
    display: formatSourceCompact(best.low, best.record.currency),
    context: `${meta?.flag ?? ""} ${locale === "zh" ? meta?.zh : meta?.en} · ${best.record.role.split("（")[0].trim().slice(0, 38)}`,
    // DELTA: USD conversion + the raw source phrase with its qualifiers
    delta: `≈ ${formatUsdShort(best.usd)} · ${best.raw}`,
  };
}

function findSpread(records: SalaryRecord[]): Peak {
  // Cross-market spread of senior medians, in USD.
  let lowUsd = Infinity;
  let highUsd = 0;
  let lowMarket = "";
  let highMarket = "";
  for (const r of records) {
    const key = classifyMarket(r.market);
    if (key === "cross") continue;
    const range = parseSalaryRange(r.senior_salary);
    if (!range) continue;
    const usd = toUsd(Math.round((range.low + range.high) / 2), r.currency);
    if (usd > 0 && usd < lowUsd) {
      lowUsd = usd;
      lowMarket = key;
    }
    if (usd > highUsd) {
      highUsd = usd;
      highMarket = key;
    }
  }
  if (highUsd === 0 || lowUsd === Infinity) {
    return { display: "—", context: "", delta: "" };
  }
  const ratio = highUsd / lowUsd;
  const lowMeta = MARKETS.find((m) => m.key === lowMarket);
  const highMeta = MARKETS.find((m) => m.key === highMarket);
  return {
    display: `${ratio.toFixed(1)}×`,
    context: `${lowMeta?.flag ?? ""} ${lowMarket.toUpperCase()} → ${highMeta?.flag ?? ""} ${highMarket.toUpperCase()}`,
    delta: `${formatUsdShort(lowUsd)} → ${formatUsdShort(highUsd)}`,
  };
}

export function HeroStats({ records, locale, labels }: Props) {
  const ceiling = findCeiling(records, locale);
  const floor = findFloor(records, locale);
  const spread = findSpread(records);

  return (
    <section
      aria-label="Headline data points"
      // layout-isolate — 3-column stat grid with tabular-nums doesn't
      // affect outer layout; contain lets the browser skip recalc on
      // resize events that don't cross a breakpoint.
      className="my-6 sm:my-8 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 layout-isolate"
    >
      {[
        {
          peak: ceiling,
          eyebrow: labels.eyebrowCeiling,
          desc: labels.descCeiling,
          deltaLabel: labels.deltaCeiling,
          accent: "text-amber-400",
        },
        {
          peak: floor,
          eyebrow: labels.eyebrowEntry,
          desc: labels.descEntry,
          deltaLabel: labels.deltaEntry,
          accent: "text-emerald-400",
        },
        {
          peak: spread,
          eyebrow: labels.eyebrowSpread,
          desc: labels.descSpread,
          deltaLabel: labels.deltaSpread,
          accent: "text-cyan-400",
        },
      ].map((slot, i) => (
        <article
          key={i}
          className="border border-border/60 rounded-md bg-card/40 p-5 sm:p-6 flex flex-col"
        >
          {/* Eyebrow — "graphic element / stylized caption" per the Pixel
              Street framework. Bumped to font-semibold so the short label
              doesn't feel light. tracking-[0.2em] gives it confident
              spacing without overrunning the narrow card. */}
          <p
            className={`text-[11px] uppercase tracking-[0.2em] font-semibold ${slot.accent} mb-3`}
          >
            {slot.eyebrow}
          </p>
          {/* THE big number — "title / bandit" role: this is the page's
              logotype moment. Bumped from font-bold (700) → font-black
              (900) + tracking-tighter so it reads as a crafted trademark,
              not a system numeral. Leading stays at 1 so stacked digits
              don't orphan. */}
          <p className="text-4xl sm:text-5xl md:text-[3.25rem] font-black font-mono tabular-nums leading-none tracking-tighter text-foreground mb-3 break-words [overflow-wrap:anywhere]">
            {slot.peak.display}
          </p>
          {/* Context line — "body / nanny" role: feed info readably.
              Bumped from text-xs → text-sm so it remains legible on
              phone without needing to pinch-zoom. Added break-words so
              long CJK role names (e.g. "中国一线 · Senior Engineer / 首席
              ...") wrap within the narrow card. */}
          <p className="text-sm text-muted-foreground leading-snug mb-3 break-words [overflow-wrap:anywhere]">
            {slot.peak.context}
          </p>
          <div className="mt-auto pt-3 border-t border-border/40 min-w-0">
            <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/80 font-semibold mb-1">
              {slot.deltaLabel}
            </p>
            {/* Delta line carries the long reference: "≈ $325k · HKD
                1,800,000–2,500,000+ (regional CISO / Bank Security Head
                / Big 4 ex-partner)" — this MUST wrap cleanly on 375px
                phones where the card is only ~330px wide minus padding. */}
            <p className="text-xs font-mono tabular-nums text-foreground/85 leading-snug break-words [overflow-wrap:anywhere]">
              {slot.peak.delta}
            </p>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground/60 leading-snug">
            {slot.desc}
          </p>
        </article>
      ))}
    </section>
  );
}
