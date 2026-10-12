// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { formatIdentity, FollowedFormatsSchema, type EditFormat } from "@/lib/editFormats";
import { REVIEWED_FORMAT_SEEDS } from "@/lib/formatSeeds";
import { useStore } from "./index";

const format: EditFormat = REVIEWED_FORMAT_SEEDS[0];
const now = new Date("2026-10-07T20:00:00Z");
const state = () => useStore.getState();
beforeEach(() => {
  localStorage.clear();
  state().reset();
});

describe("followed edit formats", () => {
  it("keeps separate formats using the same audio and removes only the selected format", () => {
    state().followFormat(format, now);
    state().followFormat(format, now);
    const other = {
      ...format,
      key: `${format.key}-zoom`,
      visualPattern: { en: "Beat synced crash zooms" },
    };
    state().followFormat(other, now);
    expect(state().followedFormats).toHaveLength(2);
    state().unfollowFormat(formatIdentity(format));
    expect(state().followedFormats.map((entry) => entry.format.key)).toEqual([other.key]);
  });

  it("persists the whole card through browser rehydration and export/import", async () => {
    state().followFormat(format, now);
    const saved = state().exportState(now);
    state().reset();
    state().importState(saved);
    await useStore.persist.rehydrate();
    expect(state().followedFormats).toEqual([{ format, followedAt: now.toISOString() }]);
  });

  it("retains the latest checked evidence after a server stops returning that format", async () => {
    state().followFormat(format, now);
    const fresh = {
      ...format,
      lastChecked: "2026-10-08T10:00:00Z",
      name: { en: "Updated observation" },
    };
    state().refreshFollowedFormats([fresh]);
    state().refreshFollowedFormats([]);
    state().refreshFollowedFormats([format]);
    await useStore.persist.rehydrate();
    expect(state().followedFormats).toEqual([{ format: fresh, followedAt: now.toISOString() }]);
  });

  it("supports old backups and skips malformed saved entries without rejecting other dashboard data", () => {
    const legacy = JSON.parse(state().exportState(now));
    delete legacy.state.followedFormats;
    state().followFormat(format, now);
    state().importState(JSON.stringify(legacy));
    expect(state().followedFormats).toEqual([]);
    const valid = { format, followedAt: now.toISOString() };
    expect(FollowedFormatsSchema.parse([{}, valid, valid])).toEqual([valid]);
  });
});
