import { describe, it, expect } from "vitest";
import {
  parseISODuration,
  augmentQuery,
  passesDuration,
  relevanceScore,
  dedupe,
  rankVideos,
  type VideoResult,
} from "@/lib/youtube";

const NOW = Date.parse("2026-01-01T00:00:00Z");

function mk(partial: Partial<VideoResult>): VideoResult {
  return {
    id: "x",
    title: "",
    channel: "",
    publishedAt: "2024-01-01T00:00:00Z",
    durationSeconds: 600,
    description: "",
    thumbnail: "",
    url: "",
    embeddable: true,
    hasCaptions: false,
    viewCount: null,
    score: 0,
    matchedQuery: "",
    ...partial,
  };
}

describe("parseISODuration", () => {
  it("parses hours/minutes/seconds", () => {
    expect(parseISODuration("PT1H2M10S")).toBe(3730);
    expect(parseISODuration("PT15M")).toBe(900);
    expect(parseISODuration("PT45S")).toBe(45);
  });
  it("returns null for malformed", () => {
    expect(parseISODuration("nonsense")).toBeNull();
  });
});

describe("augmentQuery", () => {
  it("adds level and intent terms", () => {
    const q = augmentQuery("entropy generation", { level: "advanced", intent: "worked-example" });
    expect(q).toContain("entropy generation");
    expect(q).toContain("advanced");
    expect(q).toContain("worked example");
  });
});

describe("duration buckets (spec: <10 / 10-30 / >30)", () => {
  it("filters by bucket", () => {
    expect(passesDuration(300, "short")).toBe(true); // 5 min < 10
    expect(passesDuration(1200, "short")).toBe(false);
    expect(passesDuration(1200, "medium")).toBe(true); // 20 min
    expect(passesDuration(2400, "long")).toBe(true); // 40 min
  });
  it("does not exclude unknown durations", () => {
    expect(passesDuration(null, "short")).toBe(true);
  });
});

describe("relevanceScore", () => {
  it("scores exact topic matches higher than unrelated", () => {
    const good = relevanceScore(
      mk({ title: "Entropy generation control volume worked example", description: "" }),
      "entropy generation control volume",
      {},
      NOW,
    );
    const bad = relevanceScore(
      mk({ title: "Cooking pasta at home", description: "" }),
      "entropy generation control volume",
      {},
      NOW,
    );
    expect(good).toBeGreaterThan(bad);
  });

  it("does not rank purely by views (views are not an input)", () => {
    const a = relevanceScore(mk({ title: "Bode plot tutorial", viewCount: 10 }), "bode plot", {}, NOW);
    const b = relevanceScore(mk({ title: "unrelated", viewCount: 1_000_000 }), "bode plot", {}, NOW);
    expect(a).toBeGreaterThan(b);
  });
});

describe("dedupe & rank", () => {
  it("removes duplicate ids keeping highest score", () => {
    const out = dedupe([mk({ id: "a", score: 0.2 }), mk({ id: "a", score: 0.9 }), mk({ id: "b", score: 0.5 })]);
    expect(out).toHaveLength(2);
    expect(out.find((v) => v.id === "a")!.score).toBe(0.9);
  });

  it("filters captionsOnly and sorts by score", () => {
    const ranked = rankVideos(
      [
        mk({ id: "a", score: 0.3, hasCaptions: true }),
        mk({ id: "b", score: 0.9, hasCaptions: false }),
        mk({ id: "c", score: 0.5, hasCaptions: true }),
      ],
      { captionsOnly: true },
    );
    expect(ranked.map((v) => v.id)).toEqual(["c", "a"]);
  });
});
