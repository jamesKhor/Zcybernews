import { getSources } from "@/lib/rss/fetch";
import { getAllPosts } from "@/lib/content";
import Link from "next/link";
import {
  Rss,
  Newspaper,
  PenLine,
  ExternalLink,
  Shield,
  Globe,
} from "lucide-react";

export default async function AdminDashboard() {
  const sources = getSources();
  const enabledSources = sources.filter((s) => s.enabled);
  const enPosts = getAllPosts("en", "posts");
  const zhPosts = getAllPosts("zh", "posts");
  const enTi = getAllPosts("en", "threat-intel");
  const recentPosts = [...enPosts, ...enTi]
    .sort((a, b) => new Date(b.frontmatter.date).getTime() - new Date(a.frontmatter.date).getTime())
    .slice(0, 6);

  const stats = [
    { label: "EN Articles", value: enPosts.length, icon: Newspaper, href: "/en/articles", color: "text-blue-400", bg: "bg-blue-950/30 border-blue-800/40" },
    { label: "ZH Articles", value: zhPosts.length, icon: Globe, href: "/zh/articles", color: "text-purple-400", bg: "bg-purple-950/30 border-purple-800/40" },
    { label: "Threat Intel", value: enTi.length, icon: Shield, href: "/en/threat-intel", color: "text-red-400", bg: "bg-red-950/30 border-red-800/40" },
    { label: "Active Sources", value: enabledSources.length, icon: Rss, href: "/admin/sources", color: "text-emerald-400", bg: "bg-emerald-950/30 border-emerald-800/40" },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-white">Dashboard</h1>
        <p className="text-sm text-gray-400 mt-0.5">Your daily publishing workflow</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {stats.map(({ label, value, icon: Icon, href, color, bg }) => (
          <Link key={label} href={href} className={`rounded-lg border p-4 ${bg} hover:brightness-110 transition-all`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400">{label}</span>
              <Icon className={`w-4 h-4 ${color}`} />
            </div>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
          </Link>
        ))}
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-sm font-medium text-gray-400 mb-3 uppercase tracking-wider">Quick Actions</h2>
        <div className="grid grid-cols-2 gap-3">
          <Link href="/admin/feed" className="flex items-center gap-3 p-4 rounded-lg bg-gray-900 border border-gray-800 hover:border-emerald-700 hover:bg-gray-800 transition-all group">
            <div className="w-9 h-9 rounded-md bg-emerald-950 flex items-center justify-center">
              <Newspaper className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-white group-hover:text-emerald-400 transition-colors">Browse Feed</p>
              <p className="text-xs text-gray-500">Read latest from all sources</p>
            </div>
          </Link>
          <Link href="/admin/compose" className="flex items-center gap-3 p-4 rounded-lg bg-gray-900 border border-gray-800 hover:border-blue-700 hover:bg-gray-800 transition-all group">
            <div className="w-9 h-9 rounded-md bg-blue-950 flex items-center justify-center">
              <PenLine className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-white group-hover:text-blue-400 transition-colors">Compose Article</p>
              <p className="text-xs text-gray-500">AI synthesis + EN/ZH publish</p>
            </div>
          </Link>
        </div>
      </div>

      {/* Recently Published */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Recently Published</h2>
          <Link href="/en/articles" target="_blank" className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300">
            View site <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
        <div className="space-y-2">
          {recentPosts.length === 0 && (
            <p className="text-sm text-gray-500 py-4 text-center">
              No articles yet. Go to <Link href="/admin/feed" className="text-emerald-400 hover:underline">Feed Reader</Link> to get started.
            </p>
          )}
          {recentPosts.map((post) => {
            const isTi = enTi.some((t) => t.frontmatter.slug === post.frontmatter.slug);
            const zhExists = zhPosts.some((z) => z.frontmatter.slug === post.frontmatter.slug);
            return (
              <div key={post.frontmatter.slug} className="flex items-center justify-between p-3 rounded-lg bg-gray-900 border border-gray-800">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white truncate">{post.frontmatter.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-xs text-gray-500">{post.frontmatter.category} · {new Date(post.frontmatter.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-950 text-blue-400 font-mono">EN</span>
                    {zhExists && <span className="text-xs px-1.5 py-0.5 rounded bg-purple-950 text-purple-400 font-mono">ZH</span>}
                  </div>
                </div>
                <Link href={`/en/${isTi ? "threat-intel" : "articles"}/${post.frontmatter.slug}`} target="_blank" className="ml-3 text-gray-500 hover:text-emerald-400 transition-colors flex-shrink-0">
                  <ExternalLink className="w-4 h-4" />
                </Link>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sources */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Feed Sources</h2>
          <Link href="/admin/sources" className="text-xs text-emerald-400 hover:text-emerald-300">Manage</Link>
        </div>
        <div className="space-y-2">
          {sources.map((source) => (
            <div key={source.id} className="flex items-center gap-3 p-3 rounded-lg bg-gray-900 border border-gray-800">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${source.enabled ? "bg-emerald-400" : "bg-gray-600"}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white truncate">{source.name}</p>
                <p className="text-xs text-gray-500">{source.category}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${source.enabled ? "bg-emerald-950 text-emerald-400" : "bg-gray-800 text-gray-500"}`}>
                {source.enabled ? "active" : "disabled"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
