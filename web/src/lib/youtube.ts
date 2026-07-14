import { neutralize } from "./sanitize";

/**
 * YouTube Data API v3 integration.
 *
 * Reference: https://developers.google.com/youtube/v3/docs/search/list and
 * .../videos/list. We use search.list to find candidates, then videos.list to
 * fetch contentDetails (duration, caption flag) and statistics for ranking.
 *
 * Design rules from the spec:
 *  - NEVER fabricate videos, titles, channels, durations, or stats. Every field
 *    below comes straight from the API. If there is no key/quota, we return a
 *    typed "not configured / quota" state and the UI shows the AI queries only.
 *  - Ranking considers relevance to the exact topic, discipline, difficulty,
 *    duration bucket, captions, and recency — NOT view count alone.
 *  - Titles/descriptions are untrusted; we neutralize them before display.
 */

export interface VideoResult {
  id: string;
  title: string;
  channel: string;
  publishedAt: string;
  durationSeconds: number | null;
  description: string;
  thumbnail: string;
  url: string;
  embeddable: boolean;
  hasCaptions: boolean;
  viewCount: number | null;
  score: number;
  matchedQuery: string;
}

export type VideoSearchOutcome =
  | { status: "ok"; videos: VideoResult[]; queries: string[] }
  | { status: "not_configured"; queries: string[]; message: string }
  | { status: "quota_exceeded"; queries: string[]; message: string }
  | { status: "empty"; queries: string[]; message: string }
  | { status: "error"; queries: string[]; message: string };

export interface VideoFilters {
  duration?: "short" | "medium" | "long"; // <10m | 10-30m | >30m
  level?: "beginner" | "intermediate" | "advanced";
  intent?: "worked-example" | "conceptual" | "lecture" | "lab" | "software";
  captionsOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested; no network)
// ---------------------------------------------------------------------------

/** Parse ISO-8601 duration (e.g. "PT1H2M10S") to seconds. */
export function parseISODuration(iso: string): number | null {
  const m = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  const [, d, h, min, s] = m;
  return (
    (parseInt(d || "0") * 86400) +
    (parseInt(h || "0") * 3600) +
    (parseInt(min || "0") * 60) +
    parseInt(s || "0")
  );
}

const INTENT_TERMS: Record<NonNullable<VideoFilters["intent"]>, string> = {
  "worked-example": "worked example solved problem",
  conceptual: "explained intuition concept",
  lecture: "lecture full",
  lab: "lab demonstration experiment",
  software: "tutorial software",
};

/** Fold filters into a search query string to bias the API results. */
export function augmentQuery(query: string, filters: VideoFilters): string {
  const parts = [query];
  if (filters.level) parts.push(filters.level);
  if (filters.intent) parts.push(INTENT_TERMS[filters.intent]);
  return parts.join(" ").trim();
}

/** Map a duration bucket to the API's videoDuration parameter. */
export function durationParam(d?: VideoFilters["duration"]): string | undefined {
  if (d === "short") return "short"; // < 4 min per API; we still post-filter
  if (d === "long") return "long"; // > 20 min
  if (d === "medium") return "medium"; // 4-20 min
  return undefined;
}

const DURATION_RANGES: Record<string, [number, number]> = {
  short: [0, 600], // < 10 min (spec bucket)
  medium: [600, 1800], // 10-30 min
  long: [1800, Infinity], // > 30 min
};

/** Post-filter by the spec's duration buckets (<10 / 10-30 / >30). */
export function passesDuration(seconds: number | null, d?: VideoFilters["duration"]): boolean {
  if (!d) return true;
  if (seconds == null) return true; // unknown duration: don't exclude
  const [lo, hi] = DURATION_RANGES[d];
  return seconds >= lo && seconds < hi;
}

const STOP = new Set(["the", "a", "an", "of", "for", "and", "to", "in", "on", "with", "example"]);

/** Relevance score: text overlap + captions + duration fit + mild recency. */
export function relevanceScore(v: {
  title: string;
  description: string;
  durationSeconds: number | null;
  hasCaptions: boolean;
  publishedAt: string;
}, query: string, filters: VideoFilters, nowMs: number): number {
  const qTokens = query
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
  const hay = (v.title + " " + v.description).toLowerCase();
  let overlap = 0;
  for (const t of qTokens) if (hay.includes(t)) overlap++;
  const textScore = qTokens.length ? overlap / qTokens.length : 0;

  // Title matches weigh more than description matches.
  const titleHay = v.title.toLowerCase();
  const titleHits = qTokens.filter((t) => titleHay.includes(t)).length;
  const titleScore = qTokens.length ? titleHits / qTokens.length : 0;

  let score = textScore * 0.5 + titleScore * 0.3;

  if (filters.captionsOnly && v.hasCaptions) score += 0.05;
  if (v.hasCaptions) score += 0.03;

  // Duration fit bonus for the requested bucket.
  if (filters.duration && passesDuration(v.durationSeconds, filters.duration)) score += 0.08;

  // Mild recency: up to +0.06 for videos < 5 years old.
  const ageYears = (nowMs - Date.parse(v.publishedAt)) / (365.25 * 864e5);
  if (Number.isFinite(ageYears)) score += Math.max(0, 0.06 * (1 - Math.min(ageYears, 5) / 5));

  return score;
}

/** Remove duplicate videos by id, keeping the highest-scored. */
export function dedupe(videos: VideoResult[]): VideoResult[] {
  const byId = new Map<string, VideoResult>();
  for (const v of videos) {
    const existing = byId.get(v.id);
    if (!existing || v.score > existing.score) byId.set(v.id, v);
  }
  return [...byId.values()];
}

/** Full ranking: dedupe, filter by duration/captions, sort by score. */
export function rankVideos(videos: VideoResult[], filters: VideoFilters): VideoResult[] {
  return dedupe(videos)
    .filter((v) => passesDuration(v.durationSeconds, filters.duration))
    .filter((v) => (filters.captionsOnly ? v.hasCaptions : true))
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Network call
// ---------------------------------------------------------------------------

const API = "https://www.googleapis.com/youtube/v3";

interface RawSearchItem {
  id: { videoId: string };
  snippet: {
    title: string;
    channelTitle: string;
    publishedAt: string;
    description: string;
    thumbnails: { medium?: { url: string }; default?: { url: string } };
  };
}

interface RawVideoItem {
  id: string;
  contentDetails: { duration: string; caption: string };
  status: { embeddable: boolean };
  statistics: { viewCount?: string };
}

/**
 * Search real videos for a set of AI-generated queries. `nowMs` is injected so
 * ranking is deterministic and testable (no Date.now() inside pure logic).
 */
export async function searchVideos(
  queries: string[],
  filters: VideoFilters,
  opts: { perQuery?: number; nowMs: number },
): Promise<VideoSearchOutcome> {
  const key = process.env.YOUTUBE_API_KEY;
  const cleanQueries = queries.map((q) => q.trim()).filter(Boolean).slice(0, 5);
  if (!key) {
    return {
      status: "not_configured",
      queries: cleanQueries,
      message:
        "YOUTUBE_API_KEY is not set. Add it to web/.env.local to enable real video search. Below are the search queries the tutor generated for this topic.",
    };
  }
  if (cleanQueries.length === 0) {
    return { status: "empty", queries: [], message: "No search queries were generated." };
  }

  const perQuery = opts.perQuery ?? 6;
  const collected: VideoResult[] = [];

  try {
    for (const q of cleanQueries) {
      const params = new URLSearchParams({
        key,
        part: "snippet",
        type: "video",
        maxResults: String(perQuery),
        q: augmentQuery(q, filters),
        safeSearch: "moderate",
        relevanceLanguage: "en",
        videoEmbeddable: "true",
      });
      const dp = durationParam(filters.duration);
      if (dp) params.set("videoDuration", dp);
      if (filters.captionsOnly) params.set("videoCaption", "closedCaption");

      const searchRes = await fetch(`${API}/search?${params.toString()}`);
      if (searchRes.status === 403) {
        const body = await searchRes.json().catch(() => ({}));
        const reason = body?.error?.errors?.[0]?.reason || "";
        if (/quota/i.test(reason)) {
          return {
            status: "quota_exceeded",
            queries: cleanQueries,
            message: "The YouTube API daily quota is exhausted. Try again later or use another key.",
          };
        }
        return { status: "error", queries: cleanQueries, message: `YouTube API error: ${reason || "forbidden"}` };
      }
      if (!searchRes.ok) {
        return { status: "error", queries: cleanQueries, message: `YouTube API returned ${searchRes.status}.` };
      }
      const searchJson = (await searchRes.json()) as { items?: RawSearchItem[] };
      const items = searchJson.items ?? [];
      if (items.length === 0) continue;

      // Fetch contentDetails + statistics for durations, captions, views.
      const ids = items.map((it) => it.id.videoId).join(",");
      const vParams = new URLSearchParams({
        key,
        part: "contentDetails,status,statistics",
        id: ids,
      });
      const vRes = await fetch(`${API}/videos?${vParams.toString()}`);
      const details = new Map<string, RawVideoItem>();
      if (vRes.ok) {
        const vJson = (await vRes.json()) as { items?: RawVideoItem[] };
        for (const d of vJson.items ?? []) details.set(d.id, d);
      }

      for (const it of items) {
        const id = it.id.videoId;
        const d = details.get(id);
        const durationSeconds = d ? parseISODuration(d.contentDetails.duration) : null;
        const hasCaptions = d?.contentDetails.caption === "true";
        const embeddable = d?.status.embeddable ?? true;
        const viewCount = d?.statistics.viewCount ? parseInt(d.statistics.viewCount) : null;
        const base = {
          id,
          title: neutralize(it.snippet.title),
          channel: neutralize(it.snippet.channelTitle),
          publishedAt: it.snippet.publishedAt,
          durationSeconds,
          description: neutralize(it.snippet.description || ""),
          thumbnail: it.snippet.thumbnails.medium?.url || it.snippet.thumbnails.default?.url || "",
          url: `https://www.youtube.com/watch?v=${id}`,
          embeddable,
          hasCaptions,
          viewCount,
          matchedQuery: q,
        };
        const score = relevanceScore(base, q, filters, opts.nowMs);
        collected.push({ ...base, score });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "error", queries: cleanQueries, message: `Video search failed: ${msg}` };
  }

  const ranked = rankVideos(collected, filters);
  if (ranked.length === 0) {
    return { status: "empty", queries: cleanQueries, message: "No matching videos were found." };
  }
  return { status: "ok", videos: ranked, queries: cleanQueries };
}
