import { describe, expect, it } from "vitest";
import type { ConversationItem } from "@/lib/inbox";
import { SEARCH_MAX, boundQuery, matchConversations } from "./inboxConversationSearch";

// DT-WIO-1: the pure filter behind the Inbox conversation search. Literal, local, order-preserving.

const ME = "17841000000000001";
const conv = (id: string, ...people: { id?: string; username?: string }[]): ConversationItem => ({
  id,
  updatedAt: null,
  participants: people,
});
const ids = (xs: ConversationItem[]) => xs.map((c) => c.id);

const ROWS = [
  conv("c1", { id: ME, username: "3z.prod" }, { id: "p1", username: "Fan_One" }),
  conv("c2", { id: ME, username: "3z.prod" }, { id: "p2", username: "أحمد_العتيبي" }),
  conv("c3", { id: ME, username: "3z.prod" }, { id: "99887766" }),
  conv("c4", { id: ME, username: "3z.prod" }),
  conv("c5", { id: ME }, { id: "p5", username: "a.b" }, { username: "axb" }),
];

describe("boundQuery", () => {
  it("keeps at most 200 characters and never splits a surrogate pair", () => {
    expect(SEARCH_MAX).toBe(200);
    expect(boundQuery("x".repeat(300))).toHaveLength(200);
    const emoji = "😀".repeat(150); // 300 UTF-16 units, 150 code points
    expect(boundQuery(emoji)).toBe(emoji);
    expect([...boundQuery("😀".repeat(250))]).toHaveLength(200);
  });
});

describe("matchConversations", () => {
  it("returns every row, same order and same array, for blank or whitespace queries", () => {
    for (const q of ["", " ", "   \t\n", " "]) {
      const out = matchConversations(ROWS, ME, q);
      expect(out).toBe(ROWS);
      expect(ids(out)).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    }
  });

  it("matches case-insensitively as a substring of a returned username", () => {
    expect(ids(matchConversations(ROWS, ME, "FAN_o"))).toEqual(["c1"]);
    expect(ids(matchConversations(ROWS, ME, "an_on"))).toEqual(["c1"]);
  });

  it("matches Arabic names literally and does not fold Arabic letters", () => {
    expect(ids(matchConversations(ROWS, ME, "العتيبي"))).toEqual(["c2"]);
    expect(ids(matchConversations(ROWS, ME, "أحمد"))).toEqual(["c2"]);
    expect(matchConversations(ROWS, ME, "احمد")).toEqual([]); // alef vs alef-hamza: not folded
    expect(matchConversations(ROWS, ME, "العتيبى")).toEqual([]); // yeh vs alef maqsura: not folded
  });

  it("matches the participant id, including rows without a username", () => {
    expect(ids(matchConversations(ROWS, ME, "9988"))).toEqual(["c3"]);
    expect(ids(matchConversations(ROWS, ME, "p1"))).toEqual(["c1"]);
  });

  it("never matches the owner (by id) and never matches the conversation id", () => {
    expect(matchConversations(ROWS, ME, "3z.prod")).toEqual([]);
    expect(matchConversations(ROWS, ME, ME)).toEqual([]);
    expect(matchConversations(ROWS, ME, "c1")).toEqual([]);
  });

  it("treats a row with no readable participant as unmatched, not as an error", () => {
    expect(ids(matchConversations(ROWS, ME, "zzz"))).toEqual([]);
    expect(ids(matchConversations([conv("e", {}), conv("n")], ME, "a"))).toEqual([]);
  });

  it("compares after Unicode NFC, in both directions", () => {
    const composed = conv("n1", { id: "x", username: "café" });
    const decomposed = conv("n2", { id: "y", username: "café" });
    const rows = [composed, decomposed];
    expect(ids(matchConversations(rows, ME, "café"))).toEqual(["n1", "n2"]);
    expect(ids(matchConversations(rows, ME, "café"))).toEqual(["n1", "n2"]);
    expect(ids(matchConversations(rows, ME, "CAFÉ"))).toEqual(["n1", "n2"]);
  });

  it("is literal: punctuation and regex characters mean themselves", () => {
    expect(ids(matchConversations(ROWS, ME, "a.b"))).toEqual(["c5"]);
    expect(ids(matchConversations(ROWS, ME, "a.b"))).not.toContain("axb");
    for (const q of [".*", "(", "[", "\\", "a|b", "^fan", "fan$", "+", "?", "{1}"])
      expect(() => matchConversations(ROWS, ME, q)).not.toThrow();
    expect(matchConversations(ROWS, ME, ".*")).toEqual([]);
    expect(matchConversations(ROWS, ME, "^fan")).toEqual([]);
  });

  it("keeps the provider order and does not mutate the input", () => {
    const rows = [
      conv("z", { id: "1", username: "bob_z" }),
      conv("a", { id: "2", username: "bob_a" }),
      conv("m", { id: "3", username: "other" }),
      conv("b", { id: "4", username: "bob_b" }),
    ];
    const copy = structuredClone(rows);
    expect(ids(matchConversations(rows, ME, "bob"))).toEqual(["z", "a", "b"]);
    expect(rows).toEqual(copy);
  });

  it("excludes nobody when the account id is unknown, exactly like the displayed names", () => {
    expect(ids(matchConversations(ROWS, undefined, "3z.prod"))).toEqual(["c1", "c2", "c3", "c4"]);
  });

  it("trims the edges of the query and bounds it before matching", () => {
    expect(ids(matchConversations(ROWS, ME, "  fan_one \n"))).toEqual(["c1"]);
    const rows = [conv("L", { id: "1", username: "k".repeat(64) })];
    expect(matchConversations(rows, ME, "k".repeat(250))).toEqual([]);
    expect(matchConversations(rows, ME, "k".repeat(64))).toHaveLength(1);
  });
});
