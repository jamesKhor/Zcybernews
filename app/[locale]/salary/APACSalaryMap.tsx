/**
 * APACSalaryMap — server component, pure inline SVG.
 *
 * A minimal "city-dot" map of the APAC region (no landmass polygons) —
 * the visual reference is the Bureau Oberhaeuser city-statistics map:
 * sparse dots at geographic positions, sized + colored by data, no
 * cartographic chrome.
 *
 * Why no landmass outline:
 * - Adds 30-50kb of SVG path data we don't need
 * - The 6 markets we cover read clearly from city positions alone
 * - Editorial restraint — the data is the visual, not the basemap
 * - Zero JS map dep (vs leaflet / mapbox / d3-geo)
 *
 * Each market dot:
 * - Position: linear lat/lon projection within an APAC bounding box
 * - Radius: scaled to the median USD-equivalent senior salary
 * - Click: drills into ?market={key} via the existing URL-state filter
 *
 * Server-rendered → crawlers see all market labels + values in HTML.
 */
import Link from "next/link";
import {
  classifyMarket,
  parseSalaryRange,
  toUsd,
  formatUsdShort,
  MARKETS,
  type SalaryRecord,
  type MarketKey,
} from "@/lib/salary";

interface Props {
  records: SalaryRecord[];
  locale: "en" | "zh";
  currentMarket: MarketKey | "all";
  labels: {
    title: string;
    standfirst: string;
    legendLow: string;
    legendHigh: string;
    clickHint: string;
  };
}

// APAC bounding box for the linear projection.
//   lon 95°E (left edge)  → 155°E (right edge)  = 60° wide
//   lat 45°N (top edge)   → -45°S (bottom edge) = 90° tall
const VIEW_W = 800;
const VIEW_H = 600;
const LON_MIN = 95;
const LON_MAX = 155;
const LAT_MAX = 45;
const LAT_MIN = -45;

function project(lat: number, lon: number): { x: number; y: number } {
  const x = ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * VIEW_W;
  const y = ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * VIEW_H;
  return { x, y };
}

// Each market plotted at its primary financial-hub city.
// Multi-city markets (CN-T1, CN-T2, AU) collapse to one representative point.
const CITY_POINTS: Array<{
  market: MarketKey;
  city: string;
  cityZh: string;
  lat: number;
  lon: number;
  // Visual nudge for label position (anchor + dx/dy)
  labelAnchor: "start" | "middle" | "end";
  labelDx: number;
  labelDy: number;
}> = [
  {
    market: "cn-t1",
    city: "Shanghai",
    cityZh: "上海",
    lat: 31.2,
    lon: 121.5,
    labelAnchor: "start",
    labelDx: 12,
    labelDy: 4,
  },
  {
    market: "cn-t2",
    city: "Chengdu",
    cityZh: "成都",
    lat: 30.7,
    lon: 104.1,
    labelAnchor: "end",
    labelDx: -12,
    labelDy: 4,
  },
  {
    market: "hk",
    city: "Hong Kong",
    cityZh: "香港",
    lat: 22.3,
    lon: 114.2,
    labelAnchor: "end",
    labelDx: -12,
    labelDy: 4,
  },
  {
    market: "my",
    city: "Kuala Lumpur",
    cityZh: "吉隆坡",
    lat: 3.14,
    lon: 101.7,
    labelAnchor: "end",
    labelDx: -12,
    labelDy: 4,
  },
  {
    market: "sg",
    city: "Singapore",
    cityZh: "新加坡",
    lat: 1.35,
    lon: 103.8,
    labelAnchor: "start",
    labelDx: 12,
    labelDy: 14,
  },
  {
    market: "au",
    city: "Sydney",
    cityZh: "悉尼",
    lat: -33.9,
    lon: 151.2,
    labelAnchor: "end",
    labelDx: -12,
    labelDy: 4,
  },
];

/**
 * Compute median USD-equivalent senior-band midpoint per market.
 * Cross-market records are excluded so the heat scale isn't muddied
 * by comparison entries.
 */
function computeMarketSalaries(
  records: SalaryRecord[],
): Map<MarketKey, number> {
  const byMarket = new Map<MarketKey, number[]>();
  for (const r of records) {
    const key = classifyMarket(r.market);
    if (key === "cross") continue;
    const range = parseSalaryRange(r.senior_salary);
    if (!range) continue;
    const usd = toUsd(Math.round((range.low + range.high) / 2), r.currency);
    if (usd <= 0) continue;
    const arr = byMarket.get(key) ?? [];
    arr.push(usd);
    byMarket.set(key, arr);
  }
  // Return median per market (more robust than mean against outlier records)
  const out = new Map<MarketKey, number>();
  for (const [k, arr] of byMarket) {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
    out.set(k, Math.round(median));
  }
  return out;
}

export function APACSalaryMap({
  records,
  locale,
  currentMarket,
  labels,
}: Props) {
  const salariesUsd = computeMarketSalaries(records);
  const allValues = Array.from(salariesUsd.values());
  const minUsd = allValues.length ? Math.min(...allValues) : 0;
  const maxUsd = allValues.length ? Math.max(...allValues) : 1;
  const rangeUsd = Math.max(1, maxUsd - minUsd);

  // Radius scales 14px (lowest market) → 36px (highest)
  const radiusFor = (usd: number): number => {
    const t = (usd - minUsd) / rangeUsd;
    return 14 + t * 22;
  };

  // Color intensity follows the same scale — using the primary cyan
  // accent at varying opacity so the page palette stays coherent.
  const fillOpacityFor = (usd: number): number => {
    const t = (usd - minUsd) / rangeUsd;
    return 0.25 + t * 0.55;
  };

  return (
    <section
      aria-labelledby="apac-map-title"
      className="my-8 sm:my-12 border border-border/60 rounded-md bg-card/30 p-4 sm:p-6"
    >
      <header className="mb-4 sm:mb-6 flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] font-mono text-primary/80 mb-1">
            APAC · {labels.clickHint}
          </p>
          <h2
            id="apac-map-title"
            className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground"
          >
            {labels.title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground leading-relaxed max-w-xl">
            {labels.standfirst}
          </p>
        </div>
      </header>

      {/* Map — viewBox keeps it responsive; max-h keeps phones sane */}
      <div className="relative w-full overflow-hidden rounded-sm bg-background/40">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-auto max-h-[460px]"
          role="img"
          aria-label="APAC cybersecurity senior salary heat map"
        >
          {/* Subtle grid: equator + tropics — geographic anchors only */}
          {[
            { lat: 23.5, label: "Tropic of Cancer" },
            { lat: 0, label: "Equator" },
            { lat: -23.5, label: "Tropic of Capricorn" },
          ].map((g) => {
            const { y } = project(g.lat, LON_MIN);
            return (
              <g key={g.label}>
                <line
                  x1={0}
                  y1={y}
                  x2={VIEW_W}
                  y2={y}
                  stroke="currentColor"
                  strokeOpacity={0.08}
                  strokeDasharray="4 6"
                  strokeWidth={1}
                  className="text-foreground"
                />
                <text
                  x={8}
                  y={y - 4}
                  fontSize={9}
                  fontFamily="ui-monospace, monospace"
                  fill="currentColor"
                  fillOpacity={0.3}
                  className="text-foreground"
                >
                  {g.label.toUpperCase()}
                </text>
              </g>
            );
          })}

          {/* Region label hints at the corners */}
          <text
            x={VIEW_W / 2}
            y={28}
            textAnchor="middle"
            fontSize={11}
            fontFamily="ui-monospace, monospace"
            fill="currentColor"
            fillOpacity={0.35}
            letterSpacing={3}
            className="text-foreground"
          >
            EAST · ASIA
          </text>
          <text
            x={120}
            y={VIEW_H - 16}
            textAnchor="start"
            fontSize={11}
            fontFamily="ui-monospace, monospace"
            fill="currentColor"
            fillOpacity={0.35}
            letterSpacing={3}
            className="text-foreground"
          >
            SOUTHEAST · ASIA
          </text>
          <text
            x={VIEW_W - 16}
            y={VIEW_H - 16}
            textAnchor="end"
            fontSize={11}
            fontFamily="ui-monospace, monospace"
            fill="currentColor"
            fillOpacity={0.35}
            letterSpacing={3}
            className="text-foreground"
          >
            OCEANIA
          </text>

          {/* City dots — interactive, server-rendered as <a> links */}
          {CITY_POINTS.map((p) => {
            const usd = salariesUsd.get(p.market) ?? minUsd;
            const r = radiusFor(usd);
            const op = fillOpacityFor(usd);
            const { x, y } = project(p.lat, p.lon);
            const meta = MARKETS.find((m) => m.key === p.market);
            const isActive = currentMarket === p.market;
            const label = locale === "zh" ? p.cityZh : p.city;
            const marketName = locale === "zh" ? meta?.zh : meta?.en;
            const usdLabel = formatUsdShort(usd);

            // Anchor link — hash strips the existing path's query and
            // reuses the URL-state pattern the filter bar already drives
            const href = `/${locale}/salary?market=${p.market}`;

            return (
              <a
                key={p.market}
                href={href}
                aria-label={`Filter to ${marketName} · senior median ${usdLabel}`}
                className="group cursor-pointer"
              >
                {/* Outer pulse ring (active state) */}
                {isActive && (
                  <circle
                    cx={x}
                    cy={y}
                    r={r + 6}
                    fill="none"
                    stroke="currentColor"
                    strokeOpacity={0.4}
                    strokeWidth={1.5}
                    className="text-primary"
                  />
                )}
                {/* Halo */}
                <circle
                  cx={x}
                  cy={y}
                  r={r}
                  fill="currentColor"
                  fillOpacity={op}
                  className="text-primary group-hover:fill-amber-400/80 transition-colors"
                />
                {/* Inner dot */}
                <circle
                  cx={x}
                  cy={y}
                  r={Math.max(3, r * 0.18)}
                  fill="currentColor"
                  className="text-primary group-hover:fill-amber-300 transition-colors"
                />
                {/* City label */}
                <text
                  x={x + p.labelDx}
                  y={y + p.labelDy}
                  textAnchor={p.labelAnchor}
                  fontSize={13}
                  fontWeight={600}
                  fill="currentColor"
                  className="text-foreground group-hover:fill-amber-200 transition-colors"
                >
                  {label}
                </text>
                {/* Salary label below city name */}
                <text
                  x={x + p.labelDx}
                  y={y + p.labelDy + 14}
                  textAnchor={p.labelAnchor}
                  fontSize={11}
                  fontFamily="ui-monospace, monospace"
                  fill="currentColor"
                  fillOpacity={0.7}
                  className="text-foreground"
                >
                  {usdLabel}
                </text>
              </a>
            );
          })}
        </svg>
      </div>

      {/* Legend strip — explains the radius/intensity scale */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="uppercase tracking-[0.12em]">
            {labels.legendLow}
          </span>
          <span className="inline-block w-3 h-3 rounded-full bg-primary/30" />
          <span className="inline-block w-4 h-4 rounded-full bg-primary/50" />
          <span className="inline-block w-5 h-5 rounded-full bg-primary/70" />
          <span className="inline-block w-6 h-6 rounded-full bg-primary/85" />
          <span className="uppercase tracking-[0.12em]">
            {labels.legendHigh}
          </span>
        </div>
        <p className="tabular-nums">
          {formatUsdShort(minUsd)} → {formatUsdShort(maxUsd)} ·{" "}
          {labels.clickHint}
        </p>
      </div>
    </section>
  );
}

/** Re-export the link helper so callers don't need to wire next-intl Link. */
export { Link };
