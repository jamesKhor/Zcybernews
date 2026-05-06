import type { Metadata, Viewport } from "next";
import {
  Inter,
  Source_Serif_4,
  Geist_Mono,
  Noto_Sans_SC,
} from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/ThemeProvider";
import { getSiteUrl } from "@/lib/site-url";
import Script from "next/script";
import "./globals.css";

// Inter — body + UI font (Phase 1 redesign, replaces Geist Sans).
// Rationale per docs/redesign-phase-1-spec.md:
//   - Designed by Rasmus Andersson specifically for screen UI
//   - Used by Linear, Stripe docs, Vercel docs, The Verge
//   - Best-in-class small-size readability (critical for our mobile
//     audience — XHS funnel pushes 60%+ mobile traffic)
//   - adjustFontFallback: "Arial" matches Inter's metrics closely,
//     eliminating CLS during font swap
//   - preload: true because Inter renders on first paint
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  preload: true,
  // adjustFontFallback in Next 15+ is boolean (true = auto-compute metric
  // overrides to match a system fallback; false = disable). Auto-computed
  // overrides eliminate CLS during the font-swap window.
  adjustFontFallback: true,
});

// Source Serif 4 — display headlines only (h1, h2).
// Why: adds editorial publication-feel to headlines without commercial
// licensing cost (Tiempos-style at $0). Free via Google Fonts. Not
// preloaded because it's below-the-fold on most page types — fallback
// serif (Georgia) displays briefly during swap, negligible CLS.
const sourceSerif = Source_Serif_4({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["600", "700"],
  display: "swap",
  preload: false,
});

// Geist Mono — kept as-is for tabular data, currency, code blocks.
// Font family is uniquely well-tuned for tabular numerals + currency
// symbols, so we keep it here even though we dropped Geist Sans.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Noto Sans SC — consistent Heiti rendering across ALL platforms.
// Without this, Windows users see Microsoft YaHei (acceptable) or
// worse, SimSun fallback (Songti serif, which 小鹿Lawrence specifically
// flagged as bad for small-screen readability in the Pixel Street
// episode). iOS users see PingFang SC. The result: brand inconsistency
// between XHS readers and direct visitors.
//
// With this webfont loaded:
//   - All platforms render CJK in Noto Sans SC first
//   - Fallback chain only triggers if the webfont fails to load
//   - Google Fonts auto-subsets based on characters actually used
//     (via unicode-range) so the bundle cost stays bounded
//
// Weights chosen to match our design system (400 body, 600 semibold
// labels, 700 headlines, 900 display hero). display:swap avoids FOIT.
const notoSansSC = Noto_Sans_SC({
  variable: "--font-noto-sc",
  subsets: ["latin"], // actual CJK glyphs come via unicode-range subsetting
  weight: ["400", "500", "600", "700", "900"],
  display: "swap",
  preload: true,
});

// Explicit viewport config (Next.js 16 convention — separate from metadata).
// `width=device-width, initial-scale=1` is the Next default, but declaring
// it explicitly documents intent and adds viewportFit for iOS safe-area
// support. No `maximumScale` — users must be allowed to pinch-zoom for
// accessibility (WCAG 1.4.4).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: {
    default: "ZCyberNews",
    template: "%s | ZCyberNews",
  },
  description:
    "Professional cybersecurity and tech intelligence — threat analysis, vulnerability research, and security news for defenders.",
  metadataBase: new URL(getSiteUrl()),
  keywords: [
    "cybersecurity",
    "threat intelligence",
    "malware analysis",
    "vulnerability research",
    "security news",
    "CVE",
    "ransomware",
    "APT",
  ],
  authors: [{ name: "ZCyberNews" }],
  creator: "ZCyberNews",
  openGraph: {
    type: "website",
    siteName: "ZCyberNews",
    title: "ZCyberNews",
    description:
      "Professional cybersecurity and tech intelligence — threat analysis, vulnerability research, and security news for defenders.",
    images: [
      {
        url: "/og-default.png",
        width: 1200,
        height: 630,
        alt: "ZCyberNews — Cybersecurity & Tech Intelligence",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ZCyberNews",
    description:
      "Professional cybersecurity and tech intelligence — threat analysis, vulnerability research, and security news for defenders.",
    images: ["/og-default.png"],
  },
  alternates: {
    types: {
      "application/rss+xml": "/api/feed",
    },
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
};

export default async function RootLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale?: string }>;
}>) {
  const { locale } = await params;
  const lang = locale === "zh" ? "zh-Hans" : "en";

  return (
    <html
      lang={lang}
      suppressHydrationWarning
      className={`${inter.variable} ${sourceSerif.variable} ${geistMono.variable} ${notoSansSC.variable} h-full antialiased`}
    >
      <head>
        {/* Google AdSense — must be in <head> for site verification */}
        <script
          async
          crossOrigin="anonymous"
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6168266894987797"
        />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider>
          {children}
          <Toaster
            richColors
            position="top-right"
            closeButton
            duration={5000}
          />
          {/* Plausible Analytics — privacy-friendly, no cookies */}
          {process.env.NEXT_PUBLIC_PLAUSIBLE_SRC && (
            <>
              <Script
                async
                src={process.env.NEXT_PUBLIC_PLAUSIBLE_SRC}
                strategy="afterInteractive"
              />
              <Script id="plausible-init" strategy="afterInteractive">
                {`window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};plausible.init()`}
              </Script>
            </>
          )}
        </ThemeProvider>
      </body>
    </html>
  );
}
