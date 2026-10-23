// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GENRE_GROUPS, GENRES } from "@/data/genres";
import { allGenres } from "@/lib/genres";
import { useStore } from "@/store";
import GenreGroups from "./GenreGroups";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useStore.getState().setSettings({ lang: "ar" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const $ = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);

const render = (genres: Parameters<typeof GenreGroups>[0]["genres"], layout: "grid" | "row") =>
  act(() => root.render(createElement(GenreGroups, { genres, layout, onPick: vi.fn() })));

for (const layout of ["grid", "row"] as const) {
  // Cars now shares Automotive with Bikes and Racing, so Mine holds the one-genre case.
  it(`shows a one-genre group named like its genre as the chip alone (${layout})`, () => {
    render(allGenres([{ id: "custom-mine", name: "حقّي", query: "my edit" }]), layout);
    expect($("genre-group-mine")).toBeNull();
    expect(host.textContent!.split("حقّي")).toHaveLength(2);
    // Other groups keep their heading, Mine too when its only genre has another name.
    expect($("genre-group-sport")?.textContent).toBe("🏟️رياضة");
    expect($("genre-group-automotive")?.textContent).toBe("🏎️سيارات ومحركات");
    expect($("genre-cars")?.textContent).toBe("🚗سيارات");
    render(allGenres([{ id: "custom-drift", name: "Drift", query: "drift edit" }]), layout);
    expect($("genre-group-mine")?.textContent).toBe("✨حقّي");
  });

  it(`renders all 35 built-in chips once each, in group order (${layout})`, () => {
    render(GENRES, layout);
    const chips = [...host.querySelectorAll<HTMLElement>('button[data-testid^="genre-"]')].map(
      (chip) => chip.dataset.testid,
    );
    const order = GENRE_GROUPS.flatMap((group) =>
      GENRES.filter((g) => g.group === group.id).map((g) => `genre-${g.id}`),
    );
    expect(chips).toHaveLength(35);
    expect(new Set(chips).size).toBe(35);
    expect(chips).toEqual(order);
    const headings = [...host.querySelectorAll<HTMLElement>('[data-testid^="genre-group-"]')];
    expect(headings.map((h) => h.dataset.testid)).toEqual(
      GENRE_GROUPS.map((group) => `genre-group-${group.id}`),
    );
  });
}
