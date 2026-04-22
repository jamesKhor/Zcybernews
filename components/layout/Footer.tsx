import { useTranslations } from "next-intl";
import Link from "next/link";
import { Shield, Rss } from "lucide-react";
import { SubscribeForm } from "@/components/newsletter/SubscribeForm";
import { CommunityCTA } from "@/components/community/CommunityCTA";

interface Props {
  locale: string;
}

export function Footer({ locale }: Props) {
  const t = useTranslations("footer");

  return (
    <footer className="border-t border-border bg-card mt-auto">
      <div className="max-w-7xl mx-auto px-4 py-10">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2 font-bold mb-3">
              <Shield className="h-5 w-5 text-primary" />
              <span className="text-primary">Z</span>
              <span>CyberNews</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t("description")}
            </p>
          </div>

          {/* Quick links — moved from top nav to footer as part of the
              2026-04-19 nav slim (top nav now just Home + Categories).
              /articles and /threat-intel remain in the footer as
              escape-hatch routes for users who want the flat feed;
              /salary is the evergreen career-data destination that
              was in the top nav and belongs here with the other
              "resources" links. */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 uppercase tracking-wide">
              {t("quickLinks")}
            </h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <Link
                  href={`/${locale}/salary`}
                  className="hover:text-primary transition-colors"
                >
                  {t("salaries")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${locale}/articles`}
                  className="hover:text-primary transition-colors"
                >
                  {t("articles")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${locale}/threat-intel`}
                  className="hover:text-primary transition-colors"
                >
                  {t("threatIntel")}
                </Link>
              </li>
              <li>
                {/* /sources — editorial transparency page (2026-04-22).
                    Anchors our curation-layer positioning: we publish
                    exactly which feeds we watch and which we reject. */}
                <Link
                  href={`/${locale}/sources`}
                  className="hover:text-primary transition-colors"
                >
                  {t("ourSources")}
                </Link>
              </li>
            </ul>
          </div>

          {/* Newsletter */}
          <SubscribeForm compact />

          {/* Community (Discord + WeChat) — renders null until env vars set */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 uppercase tracking-wide">
              Community
            </h3>
            <CommunityCTA variant="compact" locale={locale} />
          </div>

          {/* Feeds */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 uppercase tracking-wide">
              {t("feeds")}
            </h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a
                  href="/api/feed"
                  className="flex items-center gap-1.5 hover:text-primary transition-colors"
                >
                  <Rss className="h-3.5 w-3.5" />
                  {t("rss")}
                </a>
              </li>
              <li>
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a
                  href="/api/wechat?locale=zh"
                  className="hover:text-primary transition-colors"
                >
                  {t("wechat")}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-border text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} ZCyberNews. {t("rights")}
        </div>
      </div>
    </footer>
  );
}
