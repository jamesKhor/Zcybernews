export type FeedSource = {
  id: string;
  name: string;
  url: string;
  category: "cybersecurity" | "tech" | "vulnerabilities";
  type: "rss" | "cisa-kev";
  enabled: boolean;
};

export const FEED_SOURCES: FeedSource[] = [
  {
    id: "krebsonsecurity",
    name: "Krebs on Security",
    url: "https://krebsonsecurity.com/feed/",
    category: "cybersecurity",
    type: "rss",
    enabled: true,
  },
  {
    id: "bleepingcomputer",
    name: "BleepingComputer",
    url: "https://www.bleepingcomputer.com/feed/",
    category: "cybersecurity",
    type: "rss",
    enabled: true,
  },
  {
    id: "thehackernews",
    name: "The Hacker News",
    url: "https://feeds.feedburner.com/TheHackersNews",
    category: "cybersecurity",
    type: "rss",
    enabled: true,
  },
  {
    id: "darkreading",
    name: "Dark Reading",
    url: "https://www.darkreading.com/rss.xml",
    category: "cybersecurity",
    type: "rss",
    enabled: true,
  },
  {
    id: "cisa-alerts",
    name: "CISA Alerts",
    url: "https://www.cisa.gov/uscert/ncas/alerts.xml",
    category: "vulnerabilities",
    type: "rss",
    enabled: true,
  },
  {
    id: "sans-isc",
    name: "SANS Internet Storm Center",
    url: "https://isc.sans.edu/rssfeed_full.xml",
    category: "cybersecurity",
    type: "rss",
    enabled: true,
  },
  {
    id: "talos",
    name: "Cisco Talos Intelligence",
    url: "https://blog.talosintelligence.com/feeds/posts/default",
    category: "cybersecurity",
    type: "rss",
    enabled: true,
  },
  {
    id: "checkpoint-research",
    name: "Check Point Research",
    url: "https://research.checkpoint.com/feed/",
    category: "cybersecurity",
    type: "rss",
    enabled: true,
  },
  {
    id: "cisa-kev",
    name: "CISA Known Exploited Vulnerabilities",
    url: "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
    category: "vulnerabilities",
    type: "cisa-kev",
    enabled: true,
  },
];

export const ENABLED_SOURCES = FEED_SOURCES.filter((s) => s.enabled);
