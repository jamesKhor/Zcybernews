"use client";

import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import Link from "next/link";
import { useState } from "react";
import { Menu, X, Shield } from "lucide-react";
import { SearchDialog } from "@/components/search/SearchDialog";

interface Props {
  locale: string;
}

export function Header({ locale }: Props) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const otherLocale = locale === "en" ? "zh" : "en";
  // Build the same path in the other locale
  const switchHref = `/${otherLocale}${pathname}`;

  const links = [
    { href: `/${locale}`, label: t("home") },
    { href: `/${locale}/articles`, label: t("articles") },
    { href: `/${locale}/threat-intel`, label: t("threatIntel") },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href={`/${locale}`} className="flex items-center gap-2 font-bold text-foreground">
          <Shield className="h-5 w-5 text-primary" />
          <span className="text-primary">Ale</span>
          <span>CyberNews</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-6">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {/* Search */}
          <SearchDialog locale={locale} />

          {/* Locale switcher */}
          <Link
            href={switchHref}
            className="text-xs font-medium rounded-full border border-border px-3 py-1 hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
          >
            {t("switchToZh")}
          </Link>

          {/* Mobile hamburger */}
          <button
            className="md:hidden p-2 rounded hover:bg-secondary transition-colors"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-background px-4 py-4 flex flex-col gap-3">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-muted-foreground hover:text-foreground py-2"
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </header>
  );
}
