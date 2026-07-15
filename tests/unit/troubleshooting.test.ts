import { describe, expect, it } from "vitest";
import { matchTroubleshooting } from "@/lib/troubleshooting";
import { PROJECT_BY_SLUG } from "@/lib/seed/projects";

const project = PROJECT_BY_SLUG["fix-a-running-toilet-flapper"]!;

describe("matchTroubleshooting", () => {
  it("returns ranked matches when keywords are present", () => {
    // Use a keyword that exists in this project's troubleshooting entries.
    const keyword = project.troubleshooting[0]!.keywords[0]!;
    const matches = matchTroubleshooting(project, `the ${keyword} keeps happening`);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]!.matchedKeywords).toContain(keyword);
  });

  it("returns no matches for unrelated text", () => {
    const matches = matchTroubleshooting(
      project,
      "zzz qqq unrelated gibberish text here",
    );
    expect(matches).toHaveLength(0);
  });

  it("sorts higher-scoring entries first", () => {
    const matches = matchTroubleshooting(
      project,
      project.troubleshooting.map((t) => t.keywords.join(" ")).join(" "),
    );
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i]!.score).toBeLessThanOrEqual(matches[i - 1]!.score);
    }
  });
});
