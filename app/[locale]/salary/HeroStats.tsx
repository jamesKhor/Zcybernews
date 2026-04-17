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
  MARKETS,
  type SalaryRecord,
} from "@/lib/salary";

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
  let best: { usd: number; raw: string; record: SalaryRecord } | null = null;

  for (const r of records) {
    const tier = r.top_tier_salary;
    if (tier) {
      const range = parseSalaryRange(tier);
      if (range) {
        const usd = toUsd(range.high, r.currency);
        if (!best || usd > best.usd) {
          best = { usd, raw: tier, record: r };
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
        best = { usd, raw: r.senior_salary, record: r };
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
    display: formatUsdShort(best.usd),
    context: `${meta?.flag ?? ""} ${locale === "zh" ? meta?.zh : meta?.en} · ${best.record.role.split("（")[0].trim().slice(0, 38)}`,
    delta: best.raw,
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
  let best: { usd: number; raw: string; record: SalaryRecord } | null = null;
  for (const r of records) {
    if (classifyMarket(r.market) === "cross") continue;
    if (!isJuniorTrack(r)) continue;
    const range = parseSalaryRange(r.entry_salary);
    if (!range) continue;
    const usd = toUsd(range.low, r.currency);
    if (!best || usd > best.usd) {
      best = { usd, raw: r.entry_salary, record: r };
    }
  }
  if (!best) return { display: "—", context: "", delta: "" };
  const meta = MARKETS.find(
    (m) => m.key === classifyMarket(best!.record.market),
  );
  return {
    display: formatUsdShort(best.usd),
    context: `${meta?.flag ?? ""} ${locale === "zh" ? meta?.zh : meta?.en} · ${best.record.role.split("（")[0].trim().slice(0, 38)}`,
    delta: best.raw,
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
      className="my-6 sm:my-8 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4"
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
          <p
            className={`text-[10px] uppercase tracking-[0.18em] font-mono ${slot.accent} mb-2`}
          >
            {slot.eyebrow}
          </p>
          {/* THE big number — 'zoom-in' treatment */}
          <p className="text-4xl sm:text-5xl md:text-[3.25rem] font-bold font-mono tabular-nums leading-none tracking-tight text-foreground mb-3">
            {slot.peak.display}
          </p>
          <p className="text-xs text-muted-foreground leading-snug mb-3">
            {slot.peak.context}
          </p>
          <div className="mt-auto pt-2 border-t border-border/40">
            <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/80 font-mono mb-0.5">
              {slot.deltaLabel}
            </p>
            <p className="text-[11px] font-mono tabular-nums text-foreground/85 leading-snug">
              {slot.peak.delta}
            </p>
          </div>
          <p className="mt-3 text-[10px] text-muted-foreground/60 leading-snug">
            {slot.desc}
          </p>
        </article>
      ))}
    </section>
  );
}
