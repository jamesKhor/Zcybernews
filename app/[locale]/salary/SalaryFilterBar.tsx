"use client";

/**
 * SalaryFilterBar — client island for the market + role chip filters.
 *
 * URL search params are the source of truth. Clicking a chip updates
 * the URL via router.replace; the server component re-renders with the
 * filtered dataset. This pattern keeps the FIRST render fully static
 * for SEO crawlers — they see all data; only interactive filtering
 * needs JS.
 *
 * The bar sticks to the top on scroll so the operator-pivot visitor
 * never loses the filter context as they scroll through dense data.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { MARKETS, ROLES, type MarketKey, type RoleKey } from "@/lib/salary";
import { cn } from "@/lib/utils";

interface Props {
  locale: "en" | "zh";
  totalCount: number;
  filteredCount: number;
  labels: {
    filterMarket: string;
    filterRole: string;
    filterAll: string;
    showingResults: string;
  };
}

export function SalaryFilterBar({
  locale,
  totalCount,
  filteredCount,
  labels,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const currentMarket = (searchParams.get("market") ?? "all") as
    | MarketKey
    | "all";
  const currentRole = (searchParams.get("role") ?? "all") as RoleKey | "all";

  const setParam = (key: "market" | "role", value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    });
  };

  const showingMessage = labels.showingResults
    .replace("{count}", String(filteredCount))
    .replace("{total}", String(totalCount));

  return (
    <div
      className={cn(
        "sticky top-0 z-30 -mx-4 px-4 sm:mx-0 sm:px-0 py-3 mb-6",
        "bg-background/85 backdrop-blur-md border-b border-border/60",
        "transition-opacity",
        isPending && "opacity-70",
      )}
    >
      <div className="flex flex-col gap-2.5">
        {/* Market chips */}
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin -mx-1 px-1">
          <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground shrink-0 mr-1">
            {labels.filterMarket}
          </span>
          <FilterChip
            label={labels.filterAll}
            active={currentMarket === "all"}
            onClick={() => setParam("market", "all")}
          />
          {MARKETS.map((m) => (
            <FilterChip
              key={m.key}
              label={`${m.flag} ${locale === "zh" ? m.zh : m.en}`}
              active={currentMarket === m.key}
              onClick={() => setParam("market", m.key)}
            />
          ))}
        </div>

        {/* Role chips */}
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin -mx-1 px-1">
          <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground shrink-0 mr-1">
            {labels.filterRole}
          </span>
          <FilterChip
            label={labels.filterAll}
            active={currentRole === "all"}
            onClick={() => setParam("role", "all")}
          />
          {ROLES.map((r) => (
            <FilterChip
              key={r.key}
              label={locale === "zh" ? r.zh : r.en}
              active={currentRole === r.key}
              onClick={() => setParam("role", r.key)}
            />
          ))}
        </div>

        {/* Result count — small, restrained, not a sales pitch */}
        <p className="text-[11px] text-muted-foreground font-mono">
          {showingMessage}
        </p>
      </div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 inline-flex items-center px-3 py-1 rounded-full text-xs font-medium transition-colors",
        "border whitespace-nowrap",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background/60 text-foreground/70 border-border hover:border-primary/50 hover:text-foreground",
      )}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}
