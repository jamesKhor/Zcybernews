import { getSources } from "@/lib/rss/fetch";
import { Rss, CheckCircle, XCircle, ExternalLink } from "lucide-react";

const categoryColors: Record<string, string> = {
  cybersecurity: "bg-red-950 text-red-400 border-red-800/40",
  tech: "bg-orange-950 text-orange-400 border-orange-800/40",
  vulnerabilities: "bg-purple-950 text-purple-400 border-purple-800/40",
};

export default function SourcesPage() {
  const sources = getSources();

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">RSS Sources</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {sources.filter((s) => s.enabled).length} of {sources.length} sources active
          </p>
        </div>
      </div>

      {/* Info banner */}
      <div className="rounded-lg bg-blue-950/30 border border-blue-800/40 p-4 text-sm text-blue-300">
        <p className="font-medium mb-1">Adding new sources</p>
        <p className="text-blue-400/80">
          To add or remove sources, edit{" "}
          <code className="bg-blue-950 px-1 py-0.5 rounded text-xs">data/rss-sources.json</code>{" "}
          and redeploy. Dynamic source management via UI is planned for a future release.
        </p>
      </div>

      {/* Sources list */}
      <div className="space-y-3">
        {sources.map((source) => (
          <div
            key={source.id}
            className="rounded-lg bg-gray-900 border border-gray-800 p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <div className="mt-0.5 flex-shrink-0">
                  {source.enabled ? (
                    <CheckCircle className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <XCircle className="w-5 h-5 text-gray-600" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-white">{source.name}</p>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full border ${categoryColors[source.category] ?? "bg-gray-800 text-gray-400 border-gray-700"}`}
                    >
                      {source.category}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full border bg-gray-800 text-gray-500 border-gray-700 uppercase">
                      {source.type}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{source.description}</p>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-emerald-400 mt-1.5 transition-colors"
                  >
                    <Rss className="w-3 h-3" />
                    {source.url.length > 60 ? source.url.slice(0, 60) + "…" : source.url}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>

              <div className="flex-shrink-0">
                <span
                  className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                    source.enabled
                      ? "bg-emerald-950 text-emerald-400"
                      : "bg-gray-800 text-gray-500"
                  }`}
                >
                  {source.enabled ? "Active" : "Disabled"}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Planned sources hint */}
      <div className="rounded-lg border border-dashed border-gray-700 p-6 text-center">
        <p className="text-sm text-gray-500 mb-1">Want to add more sources?</p>
        <p className="text-xs text-gray-600">
          Suggested: TheHackerNews, KrebsOnSecurity, DarkReading, Threatpost, US-CERT
        </p>
      </div>
    </div>
  );
}
