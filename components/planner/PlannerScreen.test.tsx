// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, dayKey, weekKey } from "@/lib/streak";
import { useStore } from "@/store";
import PlannerScreen from "./PlannerScreen";

// 📅 Planner week deep link (packet DT-4 Amendment E): `#week=<Saturday>` shows that week with a way back; an invalid
// key falls back to the current week and is cleared. Without a hash the planner shows the current week.

let host: HTMLDivElement;
let root: Root;
const $ = (testId: string) => host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const thisWeek = () => weekKey(dayKey());

async function mount(hash = ""): Promise<void> {
  history.replaceState(null, "", `/planner/${hash}`);
  await act(async () => root.render(createElement(PlannerScreen)));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  localStorage.clear();
  useStore.getState().reset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("PlannerScreen week deep link", () => {
  it("shows the current week without a hash", async () => {
    await mount();
    expect($("plan-week-viewing")).toBeNull();
    expect($("planner-screen")!.dataset.week).toBe(thisWeek());
  });

  it("renders a prior week from #week= with the return bar, and returns to this week", async () => {
    const prior = addDays(thisWeek(), -7);
    useStore.getState().addPlanItem({
      id: `wf:r1:q1`,
      week: prior,
      day: 2,
      skillId: "smart-bins-keywords",
      quest: "produce",
      minutes: 30,
      by: "me",
    });
    await mount(`#week=${prior}`);
    expect($("planner-screen")!.dataset.week).toBe(prior);
    expect($("plan-week-viewing")).not.toBeNull();
    expect(host.querySelector('[data-testid="plan-item"][data-manual="true"]')).not.toBeNull();
    await act(async () => $("plan-week-return")!.click());
    expect($("planner-screen")!.dataset.week).toBe(thisWeek());
    expect($("plan-week-viewing")).toBeNull();
    expect(location.hash).toBe("");
  });

  it("falls back to this week and clears an invalid #week=", async () => {
    await mount(`#week=${addDays(thisWeek(), 1)}`); // a Sunday, not a week key
    expect($("planner-screen")!.dataset.week).toBe(thisWeek());
    expect($("plan-week-viewing")).toBeNull();
    expect(location.hash).toBe("");
  });
});
