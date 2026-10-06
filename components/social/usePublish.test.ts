// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import type { AutoPostInput } from "@/lib/domain";
import type { WorkerJob } from "@/lib/publish";
import { postById, useStore } from "@/store";
import { applyJobs } from "./usePublish";

const S = () => useStore.getState();

beforeEach(() => {
  localStorage.clear();
  S().reset();
});

it("applies a whole job read in one save and still marks a finished post posted", () => {
  const sent = (jobId: string): AutoPostInput => ({
    platforms: ["instagram"],
    sentAt: "2026-10-06T00:00:00.000Z",
    jobId,
  });
  const done = S().addPost({ platform: "instagram", title: "Done" });
  const running = S().addPost({ platform: "instagram", title: "Running" });
  const draft = S().addPost({ platform: "instagram", title: "Never sent" });
  S().updatePost(done.id, { autoPost: sent(done.id) });
  S().updatePost(running.id, { autoPost: sent(running.id) });
  const link = "https://www.instagram.com/reel/A/";
  const jobs: WorkerJob[] = [
    {
      id: done.id,
      scheduledAt: "",
      results: { instagram: { state: "published", permalink: link } },
    },
    { id: running.id, scheduledAt: "", results: { instagram: { state: "processing" } } },
    { id: draft.id, scheduledAt: "", results: { instagram: { state: "published" } } },
  ];
  const saves = vi.spyOn(Storage.prototype, "setItem");
  const markPosted = vi.fn();
  const now = new Date("2026-10-06T01:00:00.000Z");

  applyJobs(jobs, markPosted, now);

  // One save for the whole read: a burst of saves would let this tab undo another tab's typing.
  expect(saves).toHaveBeenCalledTimes(1);
  saves.mockRestore();
  expect(postById(S(), done.id)?.autoPost).toMatchObject({
    results: { instagram: { state: "published", permalink: link } },
    checkedAt: now.toISOString(),
  });
  expect(postById(S(), running.id)?.autoPost?.results.instagram?.state).toBe("processing");
  expect(postById(S(), draft.id)?.autoPost).toBeUndefined();
  expect(markPosted).toHaveBeenCalledTimes(1);
  expect(markPosted).toHaveBeenCalledWith(done.id, link);
});
