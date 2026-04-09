import { getSources } from "@/lib/rss/fetch";
import { getAllPosts } from "@/lib/content";
import Link from "next/link";
import { Rss, Newspaper, PenLine, ExternalLink, TrendingUp } from "lucide-react";

export default async function AdminDashboard() {
  const sources = getSources();
  const enabledSources = sources.filter((s) => s.enabled);
  const posts = await getAllPosts("en", "posts");
  const recentPosts = posts.slice(0, 5);

  const stats = [
    {
      label: "Published Articles",
      value: posts.length,
      icon: Newspaper,
      href: "/en/articles",
      color: "text-blue-400",
      bg: "bg-blue-950/30 border-blue-800/40",
    },
    {
      label: "Active RSS Sources",
      value: enabledSources.length,
      icon: Rss,
      href: "/admin/sources",
      color: "text-emerald-400",
      bg: "bg-emerald-950/30 border-emerald-800/40",
    },
    {
      label: "Total Sources",
      value: sources.length,
      icon: TrendingUp,
      href: "/admin/sources",
      color: "text-amber-400",
      bg: "bg-amber-950/30 border-amber-800/40",
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-white">Dashboard</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Your daily publishing workflow
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {stats.map(({ label, value, icon: Icon, href, color, bg }) => (
          <Link
            key={label}
            href={href}
            className={`rounded-lg border p-4 ${bg} hover:brightness-110 transition-all`}
          >
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
        <h2 className="text-sm font-medium text-gray-400 mb-3 uppercase tracking-wider">
          Quick Actions
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/admin/feed"
            className="flex items-center gap-3 p-4 rounded-lg bg-gray-900 border border-gray-800 hover:border-emerald-700 hover:bg-gray-800 transition-all group"
          >
            <div className="w-9 h-9 rounded-md bg-emerald-950 flex items-center justify-center">
              <Newspaper className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-white group-hover:text-emerald-400 transition-colors">
                Browse Feed
              </p>
              <p className="text-xs text-gray-500">Read latest from all sources</p>
            </div>
          </Link>
          <Link
            href="/admin/compose"
            className="flex items-center gap-3 p-4 rounded-lg bg-gray-900 border border-gray-800 hover:border-blue-700 hover:bg-gray-800 transition-all group"
          >
            <div className="w-9 h-9 rounded-md bg-blue-950 flex items-center justify-center">
              <PenLine className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-white group-hover:text-blue-400 transition-colors">
                Compose Article
              </p>
              <p className="text-xs text-gray-500">AI synthesis from sources</p>
            </div>
          </Link>
        </div>
      </div>

      {/* Recent Articles */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
            Recently Published
          </h2>
          <Link
            href="/en/articles"
            target="_blank"
            className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300"
          >
            View site <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
        <div className="space-y-2">
          {recentPosts.length === 0 && (
            <p className="text-sm text-gray-500 py-4 text-center">
              No articles published yet. Go to{" "}
              <Link href="/admin/feed" className="text-emerald-400 hover:underline">
                Feed Reader
              </Link>{" "}
              to get started.
            </p>
          )}
          {recentPosts.map((post) => (
            <div
              key={post.frontmatter.slug}
              className="flex items-center justify-between p-3 rounded-lg bg-gray-900 border border-gray-800"
            >
              <div className="min-w-0">
                <p className="text-sm text-white truncate">{post.frontmatter.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {post.frontmatter.category} ·{" "}
                  {new Date(post.frontmatter.date).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </div>
              <Link
                href={`/en/articles/${post.frontmatter.slug}`}
                target="_blank"
                className="ml-3 text-gray-500 hover:text-emerald-400 transition-colors flex-shrink-0"
              >
                <ExternalLink className="w-4 h-4" />
              </Link>
            </div>
          ))}
        </div>
      </div>

      {/* Sources overview */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
            Feed Sources
          </h2>
          <Link
            href="/admin/sources"
            className="text-xs text-emerald-400 hover:text-emerald-300"
          >
            Manage
          </Link>
        </div>
        <div className="space-y-2">
          {sources.map((source) => (
            <div
              key={source.id}
              className="flex items-center gap-3 p-3 rounded-lg bg-gray-900 border border-gray-800"
            >
              <div
                className={`w-2 h-2 rounded-full flex-shrink-0 ${source.enabled ? "bg-emerald-400" : "bg-gray-600"}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white truncate">{source.name}</p>
                <p className="text-xs text-gray-500">{source.category}</p>
              </div>
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  source.enabled
                    ? "bg-emerald-950 text-emerald-400"
                    : "bg-gray-800 text-gray-500"
                }`}
              >
                {source.enabled ? "active" : "disabled"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
