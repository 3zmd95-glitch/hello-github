// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GENRES } from "@/lib/genres";
import type { Genre } from "@/lib/domain";
import type { ResearchItem } from "@/lib/research";
import CategoryTrends, { categorySubject, useCategoryTrendsAvailable } from "./CategoryTrends";

type PageProps = {
  config: { url: string; token: string };
  genre: Genre;
  onPickStyle: (style: string) => void;
  onSearchAll: () => void;
  onOpenSkill: (id: string) => void;
  onUnavailable: () => void;
  searchBlocked?: boolean;
  renderAction?: (item: ResearchItem) => ReactNode;
};

const fixture = vi.hoisted(() => ({
  config: null as { url: string; token: string } | null,
  caps: null as { discover: boolean } | null,
  open: vi.fn(),
  pages: [] as unknown[],
}));
vi.mock("./useScout", () => ({ useScoutConfig: () => fixture.config }));
vi.mock("./useDiscover", () => ({ useScoutCaps: () => fixture.caps }));
vi.mock("@/components/skills/SkillSheetProvider", () => ({
  useSkillSheet: () => ({ open: fixture.open, close: vi.fn() }),
}));
vi.mock("./CategoryPage", () => ({
  default: (props: PageProps) => {
    fixture.pages.push(props);
    return createElement("div", {
      "data-testid": "category-page-fixture",
      "data-genre": props.genre.id,
    });
  },
}));
vi.mock("./SaveInspirationButton", () => ({
  default: ({ item, onOpen }: { item: ResearchItem; onOpen: (url: string) => void }) =>
    createElement("button", {
      "data-testid": "save-fixture",
      "data-url": item.url,
      onClick: () => onOpen(item.url),
    }),
}));

const cars = GENRES.find((g) => g.id === "cars")!;
const coffee = GENRES.find((g) => g.id === "coffee")!;
let host: HTMLDivElement;
let root: Root;
const pages = () => fixture.pages as PageProps[];
const lastPage = () => pages().at(-1)!;

function callbacks(tag: string) {
  return {
    onPickStyle: vi.fn((query: string) => `${tag}:${query}`),
    onSearchAll: vi.fn(),
    onUnavailable: vi.fn(),
    onOpenInspiration: vi.fn(),
  };
}
const render = (genre: Genre, cb = callbacks("a")) => {
  act(() => root.render(createElement(CategoryTrends, { genre, ...cb })));
  return cb;
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.config = { url: "https://scout.test", token: "tok" };
  fixture.caps = { discover: true };
  fixture.open.mockReset();
  fixture.pages = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("CategoryTrends", () => {
  it("renders nothing without a Worker config", () => {
    fixture.config = null;
    render(cars);
    expect(host.querySelector('[data-testid="category-page-fixture"]')).toBeNull();
    expect(pages()).toHaveLength(0);
  });

  it("mounts the existing CategoryPage with the Worker config, the genre and the skill sheet opener", () => {
    render(cars);
    expect(
      host.querySelector('[data-testid="category-page-fixture"]')!.getAttribute("data-genre"),
    ).toBe("cars");
    expect(lastPage().config).toBe(fixture.config);
    expect(lastPage().genre).toBe(cars);
    expect(lastPage().searchBlocked ?? false).toBe(false);
    lastPage().onOpenSkill("smart-bins-keywords");
    expect(fixture.open).toHaveBeenCalledExactlyOnceWith("smart-bins-keywords");
  });

  it("offers Save on each card and opens the library through the parent callback", () => {
    const cb = render(cars);
    const action = createElement(
      "div",
      null,
      lastPage().renderAction!({ url: "https://x.test/1" } as ResearchItem),
    );
    act(() => root.render(action));
    const save = host.querySelector<HTMLButtonElement>('[data-testid="save-fixture"]')!;
    expect(save.getAttribute("data-url")).toBe("https://x.test/1");
    act(() => save.click());
    expect(cb.onOpenInspiration).toHaveBeenCalledExactlyOnceWith("https://x.test/1");
  });

  it("searches a tapped style with the category's subject, unless the style already has it", () => {
    expect(categorySubject(cars)).toBe("car");
    const cb = render(cars);
    lastPage().onPickStyle("rolling shot");
    expect(cb.onPickStyle).toHaveBeenLastCalledWith("rolling shot car");
    lastPage().onPickStyle("Car wash transition");
    expect(cb.onPickStyle).toHaveBeenLastCalledWith("Car wash transition");
    render(coffee, cb);
    lastPage().onPickStyle("slow pour");
    expect(cb.onPickStyle).toHaveBeenLastCalledWith(`slow pour ${categorySubject(coffee)}`);
  });

  it("hands Search all and unavailable back to the parent", () => {
    const cb = render(cars);
    lastPage().onSearchAll();
    lastPage().onUnavailable();
    expect(cb.onSearchAll).toHaveBeenCalledTimes(1);
    expect(cb.onUnavailable).toHaveBeenCalledTimes(1);
  });

  it("gives CategoryPage the same callbacks on every render (it lists them in its fetch effect), yet calls the newest", () => {
    render(cars, callbacks("a"));
    const first = lastPage();
    const second = callbacks("b");
    render(cars, second);
    const next = lastPage();
    expect(next.onPickStyle).toBe(first.onPickStyle);
    expect(next.onSearchAll).toBe(first.onSearchAll);
    expect(next.onUnavailable).toBe(first.onUnavailable);
    expect(next.renderAction).toBe(first.renderAction);
    expect(next.onOpenSkill).toBe(first.onOpenSkill);
    next.onUnavailable();
    next.onPickStyle("x");
    expect(second.onUnavailable).toHaveBeenCalledTimes(1);
    expect(second.onPickStyle).toHaveBeenCalledTimes(1);
  });
});

describe("useCategoryTrendsAvailable", () => {
  const probe = (genre: Genre) => {
    let value: boolean | undefined;
    const Probe = () => {
      value = useCategoryTrendsAvailable(genre);
      return null;
    };
    act(() => root.render(createElement(Probe)));
    return value;
  };

  it("needs a Worker config, a Discover v2 answer and a built-in category", () => {
    expect(probe(cars)).toBe(true);
    fixture.caps = { discover: false };
    expect(probe(cars)).toBe(false);
    fixture.caps = null;
    expect(probe(cars)).toBe(false);
    fixture.caps = { discover: true };
    fixture.config = null;
    expect(probe(cars)).toBe(false);
    fixture.config = { url: "https://scout.test", token: "tok" };
    expect(probe({ ...cars, id: "custom-drift" })).toBe(false);
  });
});
