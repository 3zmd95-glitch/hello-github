// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { InspirationsSchema, INSPIRATION_NOTE_MAX } from "@/lib/inspiration";
import type { ResearchItem } from "@/lib/research";
import { useStore } from "./index";

const post: ResearchItem = {
  platform: "ig",
  handle: "@filmmaker",
  title: "Circle match cut",
  snippet: "A visual idea",
  url: "https://www.instagram.com/filmmaker/reel/ABC123/?igsh=tracking",
};
const now = new Date("2026-10-07T16:00:00Z");
const state = () => useStore.getState();

beforeEach(() => {
  localStorage.clear();
  state().reset();
});

describe("inspiration lifecycle", () => {
  it("saves independently of skills and deduplicates reel/post variants without losing personal notes", () => {
    state().addRef("existing-skill", { ...post });
    state().saveInspiration(post, now);
    state().updateInspiration(post.url, { note: "Match my cup with a wheel", stage: "trying" });
    state().saveInspiration({ ...post, url: "https://www.instagram.com/p/ABC123" });
    expect(state().inspirations).toHaveLength(1);
    expect(state().inspirations[0]).toMatchObject({
      ref: { url: "https://www.instagram.com/p/ABC123" },
      note: "Match my cup with a wheel",
      stage: "trying",
      savedAt: now.toISOString(),
    });
    expect(state().savedRefs["existing-skill"]).toHaveLength(1);
    state().removeInspiration(post.url);
    expect(state().inspirations).toEqual([]);
    expect(state().savedRefs["existing-skill"]).toHaveLength(1);
  });

  it("retains notes and practice status after export/import and browser rehydration", async () => {
    state().saveInspiration(post, now);
    state().updateInspiration(post.url, { note: "Tried a circular cut", stage: "tried" });
    const exported = state().exportState(now);
    state().reset();
    state().importState(exported);
    expect(state().inspirations[0]).toMatchObject({ note: "Tried a circular cut", stage: "tried" });
    // Rehydration reads the same persistence path used by the dashboard, not a second library store.
    await useStore.persist.rehydrate();
    expect(state().inspirations[0]).toMatchObject({ note: "Tried a circular cut", stage: "tried" });
  });

  it("loads old backups without changing their skill references and skips malformed new entries", () => {
    state().addRef("a-skill", { ...post });
    const legacy = JSON.parse(state().exportState(now));
    delete legacy.state.inspirations;
    state().reset();
    state().importState(JSON.stringify(legacy));
    expect(state().inspirations).toEqual([]);
    expect(state().savedRefs["a-skill"]).toHaveLength(1);
    state().saveInspiration(post, now);
    expect(
      InspirationsSchema.parse([{}, state().inspirations[0], state().inspirations[0]]),
    ).toHaveLength(1);
  });

  it("bounds notes and ignores updates to missing references", () => {
    state().saveInspiration(post, now);
    state().updateInspiration(post.url, { note: "x".repeat(INSPIRATION_NOTE_MAX + 50) });
    state().updateInspiration("https://www.instagram.com/p/missing", { stage: "tried" });
    expect(state().inspirations[0].note).toHaveLength(INSPIRATION_NOTE_MAX);
    expect(state().inspirations[0].stage).toBe("saved");
  });
});
