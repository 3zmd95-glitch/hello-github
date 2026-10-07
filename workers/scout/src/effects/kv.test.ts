import { describe, expect, it, vi } from "vitest";
import { EFFECTS_KEY, readEffects, writeEffects } from "./kv";
import type { EffectsDoc } from "./types";

const DOC = {
  ranOn: "2026-10-07",
  updatedAt: "2026-10-07T05:35:00.000Z",
  status: "ok",
  items: [],
  meta: {},
  history: {},
};
const env = (text: string | null) => {
  const get = vi.fn(async () => text);
  return { get, env: { SOCIAL_KV: { get } as unknown as KVNamespace } };
};

describe("readEffects", () => {
  it("reads the stored document", async () => {
    const { get, env: e } = env(JSON.stringify(DOC));
    expect(await readEffects(e)).toEqual(DOC);
    expect(get).toHaveBeenCalledWith(EFFECTS_KEY, "text");
  });

  it("gives null when there is none, it is corrupt or its shape is wrong", async () => {
    expect(await readEffects({})).toBeNull();
    expect(await readEffects(env(null).env)).toBeNull();
    expect(await readEffects(env("{not json").env)).toBeNull();
    for (const broken of [
      { ...DOC, ranOn: 20261007 },
      { ...DOC, items: {} },
      { ...DOC, history: [] },
      { ...DOC, meta: null },
      [DOC],
    ])
      expect(await readEffects(env(JSON.stringify(broken)).env)).toBeNull();
  });
});

describe("any key (a category's document)", () => {
  it("reads and writes the key it is given", async () => {
    const { get, env: e } = env(JSON.stringify(DOC));
    expect(await readEffects(e, "category:cars")).toEqual(DOC);
    expect(get).toHaveBeenCalledWith("category:cars", "text");
    const put = vi.fn(async () => {});
    const doc = DOC as unknown as EffectsDoc;
    await writeEffects({ SOCIAL_KV: { put } as unknown as KVNamespace }, doc, "category:cars");
    expect(put).toHaveBeenCalledWith("category:cars", JSON.stringify(DOC));
  });
});
