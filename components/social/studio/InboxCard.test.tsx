// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetInbox } from "@/components/social/inbox/useInbox";
import { useStore } from "@/store";
import InboxCard from "./InboxCard";

// 📥 The Studio's attention list gets one "new messages and comments" row from the Worker's inbox: unread
// conversations plus posts newer than their seen mark, only with a Worker, and nothing at all when the read fails.

const T0 = "2026-10-22T10:00:00.000Z";
const T1 = "2026-10-22T11:00:00.000Z";
const side = {
  connected: true,
  canReply: true,
  tokenExpired: false,
  lastReadAt: T1,
  newestAt: T1,
};
const conv = (id: string, updatedAt: string) => ({
  platform: "instagram",
  id,
  peerId: `p-${id}`,
  peerName: id,
  updatedAt,
  lastText: "هلا",
  lastFrom: "peer",
  windowClosesAt: null,
  answeredBy: null,
});
const post = (id: string, postedAt: string) => ({
  platform: "instagram",
  id,
  permalink: "https://www.instagram.com/p/x/",
  thumbUrl: null,
  caption: "",
  postedAt,
  commentCount: 1,
});

let fetchMock: ReturnType<typeof vi.fn>;
function serve(status = 200) {
  const bodies: Record<string, unknown> = {
    "/social/inbox": {
      platforms: { instagram: side, tiktok: side },
      counts: { conversations: 2, posts: 2, comments: 2 },
    },
    "/social/inbox/conversations": {
      conversations: [conv("c1", T1), conv("c2", T0)],
      more: false,
      next: null,
    },
    "/social/inbox/posts": { posts: [post("m1", T1), post("m2", T0)], more: false, next: null },
  };
  fetchMock = vi.fn(async (url: string) => {
    const body = status === 200 ? bodies[new URL(url).pathname] : { error: "not_available" };
    return { ok: status === 200, status, json: async () => body } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
}

function configure(on: boolean) {
  const s = useStore.getState();
  s.setSettings({
    apiKeys: {
      ...s.settings.apiKeys,
      scoutUrl: on ? "https://scout.test" : "",
      scoutToken: on ? "t" : "",
    },
  });
}

let host: HTMLDivElement;
let root: Root;

async function mount() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<InboxCard today="2026-10-22" now={Date.parse(T1)} />));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const messagesRow = () =>
  host.querySelector<HTMLAnchorElement>('[data-testid="inbox-row"][data-kind="messages"]');

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  resetInbox();
  useStore.setState({ inboxSeen: {} });
  useStore.getState().setSettings({ lang: "ar" });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("InboxCard's messages row", () => {
  it("counts unread conversations and new posts, and links the Inbox", async () => {
    configure(true);
    serve();
    // c2 was opened after its last message; m2 after it was posted: c1 and m1 are new.
    useStore.setState({
      inboxSeen: { "instagram:conversation:c2": T1, "instagram:post:m2": T0 },
    });
    await mount();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const row = messagesRow()!;
    expect(row.textContent).toBe("2 رسالة وتعليق جديد");
    expect(row.getAttribute("href")).toMatch(/^\/social\/inbox\/?$/);
    expect(host.querySelector('[data-testid="studio-inbox-empty"]')).toBeNull();
  });

  it("shows no row once everything is seen", async () => {
    configure(true);
    serve();
    useStore.setState({
      inboxSeen: {
        "instagram:conversation:c1": T1,
        "instagram:conversation:c2": T0,
        "instagram:post:m1": T1,
        "instagram:post:m2": T0,
      },
    });
    await mount();
    expect(messagesRow()).toBeNull();
  });

  it("stays silent when the Worker has no inbox (an older Worker)", async () => {
    configure(true);
    serve(503);
    await mount();
    expect(fetchMock).toHaveBeenCalled();
    expect(messagesRow()).toBeNull();
    expect(host.textContent).not.toContain("الوركر");
  });

  it("reads nothing without a Worker", async () => {
    configure(false);
    serve();
    await mount();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(messagesRow()).toBeNull();
  });
});
