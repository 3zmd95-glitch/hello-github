// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DiscoverAnswer } from "@/lib/discover";
import { useExpansionDiagnostics } from "./useExpansionDiagnostics";

let host: HTMLDivElement;
let root: Root;
let latest: ReturnType<typeof useExpansionDiagnostics>;
function Harness({ scope }: { scope: string }) {
  const result = useExpansionDiagnostics(scope);
  useEffect(() => {
    latest = result;
  }, [result]);
  return createElement("output", null, JSON.stringify(result.diagnostics));
}
async function render(scope: string) {
  await act(async () => root.render(createElement(Harness, { scope })));
}
function answer(platforms: DiscoverAnswer["platforms"]): DiscoverAnswer {
  return {
    topicKey: "query",
    understood: { label: { ar: "", en: "" }, exact: true },
    alternatives: [],
    creators: [],
    items: [],
    platforms,
    cost: { tavily: 0, youtubeSearch: 0 },
    cached: false,
    complete: false,
  };
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("scoped expansion diagnostics", () => {
  it("updates only attempted platforms without losing the last actual failure on another source", async () => {
    await render("anime");
    await act(async () =>
      latest.record(
        answer({ ig: { ok: false, error: "quota" }, tt: { ok: true }, yt: { ok: true } }),
      ),
    );
    const record = latest.record;
    await act(async () => latest.record(answer({ yt: { ok: false, error: "daily_cap" } }), ["yt"]));
    expect(
      latest.diagnostics.map(({ platform, state, error }) => ({ platform, state, error })),
    ).toEqual([
      { platform: "ig", state: "error", error: "quota" },
      { platform: "tt", state: "empty", error: undefined },
      { platform: "yt", state: "error", error: "daily_cap" },
    ]);
    expect(latest.record).toBe(record);
    await act(async () => latest.record(answer({ ig: { ok: true } }), ["ig"]));
    expect(latest.diagnostics.find((row) => row.platform === "ig")).toMatchObject({
      state: "empty",
    });
    expect(latest.diagnostics.find((row) => row.platform === "ig")).not.toHaveProperty("error");
  });
  it("isolates category changes and late old callbacks, and clears stale diagnostics after transport failure", async () => {
    await render("anime");
    const oldRecord = latest.record;
    await render("cars");
    await act(async () => latest.record(answer({ ig: { ok: true } }), ["ig"]));
    await act(async () => oldRecord(answer({ ig: { ok: false, error: "auth" } }), ["ig"]));
    expect(latest.diagnostics).toEqual([
      { platform: "ig", state: "empty", returned: 0, cached: false },
    ]);
    await render("anime");
    expect(latest.diagnostics[0]).toMatchObject({ state: "error", error: "auth" });
    await act(async () => latest.clear());
    expect(latest.diagnostics).toEqual([]);
    await render("cars");
    expect(latest.diagnostics).toHaveLength(1);
  });
  it("bounds retained diagnostic scopes and does not carry old statuses into a never-requested category", async () => {
    for (let i = 0; i < 25; i++) {
      await render(`category${i}`);
      await act(async () => latest.record(answer({ ig: { ok: true } }), ["ig"]));
    }
    await render("category0");
    expect(latest.diagnostics).toEqual([]);
    await render("category24");
    expect(latest.diagnostics).toHaveLength(1);
    await render("new");
    expect(latest.diagnostics).toEqual([]);
  });
  it("keeps quota authoritative across cached successes and transport failures until a live success", async () => {
    await render("anime");
    await act(async () => latest.record(answer({ ig: { ok: false, error: "quota" } }), ["ig"]));
    expect(latest.quotaPlatforms).toEqual(["ig"]);
    await act(async () => latest.record({ ...answer({ ig: { ok: true } }), cached: true }, ["ig"]));
    expect(latest.diagnostics[0]).toMatchObject({ state: "empty", cached: true });
    expect(latest.quotaPlatforms).toEqual(["ig"]);
    await act(async () => latest.clear());
    expect(latest.diagnostics).toEqual([]);
    expect(latest.quotaPlatforms).toEqual(["ig"]);
    await act(async () => latest.record(answer({ ig: { ok: true, partial: "upstream" } }), ["ig"]));
    expect(latest.quotaPlatforms).toEqual(["ig"]);
    await render("cars");
    expect(latest.quotaPlatforms).toEqual([]);
    await render("anime");
    expect(latest.quotaPlatforms).toEqual(["ig"]);
    await act(async () => latest.record(answer({ ig: { ok: true } }), ["ig"]));
    expect(latest.quotaPlatforms).toEqual([]);
  });
  it("retains a partial quota response while another requested platform succeeds", async () => {
    await render("anime");
    await act(async () =>
      latest.record(answer({ ig: { ok: true, partial: "quota" }, yt: { ok: true } }), ["ig", "yt"]),
    );
    expect(latest.quotaPlatforms).toEqual(["ig"]);
    await act(async () => latest.record(answer({ yt: { ok: true } }), ["yt"]));
    expect(latest.quotaPlatforms).toEqual(["ig"]);
  });
});
