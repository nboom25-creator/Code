"use client";

import { useState } from "react";
import type { VideoFilters, VideoResult, VideoSearchOutcome } from "@/lib/youtube";

function fmtDuration(s: number | null): string {
  if (s == null) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

function VideoCard({ v, onBookmark }: { v: VideoResult; onBookmark?: (v: VideoResult) => void }) {
  const [embed, setEmbed] = useState(false);
  return (
    <div className="card flex flex-col gap-2">
      {embed && v.embeddable ? (
        <div className="aspect-video w-full overflow-hidden rounded-lg">
          <iframe
            className="h-full w-full"
            src={`https://www.youtube.com/embed/${v.id}`}
            title={v.title}
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : (
        <button
          className="relative block overflow-hidden rounded-lg"
          onClick={() => (v.embeddable ? setEmbed(true) : window.open(v.url, "_blank"))}
          aria-label={`Play ${v.title}`}
        >
          {v.thumbnail && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v.thumbnail} alt="" className="w-full" loading="lazy" />
          )}
          {v.durationSeconds != null && (
            <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 text-xs text-white">
              {fmtDuration(v.durationSeconds)}
            </span>
          )}
        </button>
      )}
      <div>
        <a
          href={v.url}
          target="_blank"
          rel="noreferrer"
          className="line-clamp-2 text-sm font-medium text-slate-800 hover:text-brand-600 dark:text-slate-100"
        >
          {v.title}
        </a>
        <div className="mt-0.5 text-xs text-slate-500">
          {v.channel} · {new Date(v.publishedAt).toLocaleDateString()}
          {v.hasCaptions && <span className="ml-1 chip">CC</span>}
        </div>
      </div>
      {/* AI-generated relevance note is clearly separated from API data. */}
      <p className="rounded bg-brand-50 px-2 py-1 text-xs text-brand-800 dark:bg-brand-900/30 dark:text-brand-200">
        <span className="font-semibold">Why suggested (AI):</span> matches “{v.matchedQuery}”.
      </p>
      <div className="flex gap-2">
        {!v.embeddable && <span className="chip">Embedding disabled — opens on YouTube</span>}
        {onBookmark && (
          <button className="chip" onClick={() => onBookmark(v)}>
            ☆ Bookmark
          </button>
        )}
      </div>
    </div>
  );
}

export function VideoPanel({
  queries,
  onBookmark,
}: {
  queries: string[];
  onBookmark?: (v: VideoResult) => void;
}) {
  const [outcome, setOutcome] = useState<VideoSearchOutcome | null>(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<VideoFilters>({});

  async function search() {
    setLoading(true);
    try {
      const res = await fetch("/api/videos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ queries, filters }),
      });
      setOutcome(await res.json());
    } catch {
      setOutcome({ status: "error", queries, message: "Network error searching videos." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <select
          className="input !w-auto !py-1.5"
          value={filters.duration ?? ""}
          onChange={(e) =>
            setFilters((f) => ({ ...f, duration: (e.target.value || undefined) as VideoFilters["duration"] }))
          }
        >
          <option value="">Any length</option>
          <option value="short">&lt; 10 min</option>
          <option value="medium">10–30 min</option>
          <option value="long">&gt; 30 min</option>
        </select>
        <select
          className="input !w-auto !py-1.5"
          value={filters.intent ?? ""}
          onChange={(e) =>
            setFilters((f) => ({ ...f, intent: (e.target.value || undefined) as VideoFilters["intent"] }))
          }
        >
          <option value="">Any type</option>
          <option value="worked-example">Worked examples</option>
          <option value="conceptual">Conceptual</option>
          <option value="lecture">Lectures</option>
          <option value="lab">Lab demos</option>
          <option value="software">Software tutorials</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={!!filters.captionsOnly}
            onChange={(e) => setFilters((f) => ({ ...f, captionsOnly: e.target.checked }))}
          />
          Captions only
        </label>
        <button className="btn-primary !py-1.5" onClick={search} disabled={loading}>
          {loading ? "Searching…" : "Find videos"}
        </button>
      </div>

      {outcome?.status === "ok" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {outcome.videos.slice(0, 8).map((v) => (
            <VideoCard key={v.id} v={v} onBookmark={onBookmark} />
          ))}
        </div>
      )}

      {outcome && outcome.status !== "ok" && (
        <div className="card border-amber-300 bg-amber-50 text-sm dark:border-amber-800 dark:bg-amber-950/40">
          <p className="font-medium text-amber-800 dark:text-amber-200">{outcome.message}</p>
          {outcome.queries.length > 0 && (
            <div className="mt-2">
              <div className="section-title">Search queries generated by the tutor</div>
              <ul className="mt-1 list-disc pl-5 text-slate-600 dark:text-slate-300">
                {outcome.queries.map((q, i) => (
                  <li key={i}>
                    <a
                      className="hover:text-brand-600"
                      href={`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {q}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
