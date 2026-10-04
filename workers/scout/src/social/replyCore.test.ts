import { describe, expect, it } from "vitest";
import type { MetaError } from "./meta";
import {
  DM_TEXT_BYTES,
  dmFits,
  FOLLOW_TITLE,
  graph,
  messageButtons,
  messagePayload,
  pickPublicReply,
  profileUrl,
  textBody,
  toReplyCode,
  utf8Bytes,
} from "./replyCore";

const ORIGIN = "https://3z-scout.example.workers.dev";
const LUT = "https://3zprod.com/lut";
const rule = {
  id: "lut",
  dmText: "حمل اللت من الزر تحت",
  buttons: [{ title: "تحميل اللت", url: LUT }],
};

describe("message building", () => {
  it("routes links through /go when the origin is known, and puts «تابعني» last", () => {
    expect(messageButtons({ ...rule, followButton: true }, ORIGIN, "3z.prod")).toEqual([
      { title: "تحميل اللت", url: `${ORIGIN}/go/lut/0` },
      { title: FOLLOW_TITLE, url: "https://www.instagram.com/3z.prod/" },
    ]);
    expect(messageButtons(rule, undefined, "3z.prod")).toEqual([{ title: "تحميل اللت", url: LUT }]);
    // No username yet (before the first poll read /me): no follow button rather than a broken link.
    expect(messageButtons({ ...rule, followButton: true }, ORIGIN, undefined)).toHaveLength(1);
  });

  it("writes the plain-text form with one 'title: link' line per button", () => {
    expect(
      textBody(" هلا ", [
        { title: "أ", url: LUT },
        { title: "ب", url: ORIGIN },
      ]),
    ).toBe(`هلا\n\nأ: ${LUT}\nب: ${ORIGIN}`);
    expect(textBody("هلا", [])).toBe("هلا");
  });

  it("sends text without buttons and a generic link card with them", () => {
    expect(messagePayload(" هلا ", [])).toEqual({ text: "هلا" });
    expect(messagePayload("هلا", [{ title: "أ", url: LUT }])).toEqual({
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [
            {
              title: "هلا",
              default_action: { type: "web_url", url: LUT },
              buttons: [{ type: "web_url", url: LUT, title: "أ" }],
            },
          ],
        },
      },
    });
  });

  it("keeps tracked links in the card action and every button", () => {
    const buttons = messageButtons({ ...rule, followButton: true }, ORIGIN, "3z.prod");
    expect(messagePayload(rule.dmText, buttons)).toMatchObject({
      attachment: {
        payload: {
          elements: [
            {
              default_action: { type: "web_url", url: `${ORIGIN}/go/lut/0` },
              buttons: [
                { type: "web_url", title: "تحميل اللت", url: `${ORIGIN}/go/lut/0` },
                { type: "web_url", title: "تابعني", url: "https://www.instagram.com/3z.prod/" },
              ],
            },
          ],
        },
      },
    });
  });

  it("uses a card through 80 UTF-16 units, then preserves the whole text and all links", () => {
    const buttons = [{ title: "تحميل اللت", url: `${ORIGIN}/go/lut/0` }];
    const eighty = "ل".repeat(80);
    expect(messagePayload(` ${eighty} `, buttons)).toMatchObject({
      attachment: { payload: { elements: [{ title: eighty }] } },
    });
    for (const text of ["ل".repeat(81), "x".repeat(640), "🎬".repeat(41)]) {
      expect(messagePayload(text, buttons)).toEqual({
        text: `${text}\n\nتحميل اللت: ${ORIGIN}/go/lut/0`,
      });
    }
    expect(messagePayload("🎬".repeat(40), buttons)).toHaveProperty("attachment");
    const text = "first line\n" + "second line ".repeat(8);
    expect(messagePayload(text, [...buttons, { title: "تابعني", url: LUT }])).toEqual({
      text: `${text.trim()}\n\nتحميل اللت: ${ORIGIN}/go/lut/0\nتابعني: ${LUT}`,
    });
  });

  it("keeps links as text instead of constructing a card with a blank title", () => {
    expect(messagePayload(" \n ", [{ title: "تحميل اللت", url: LUT }])).toEqual({
      text: `تحميل اللت: ${LUT}`,
    });
  });

  it("counts UTF-8 bytes (an Arabic letter is two) and builds the profile link", () => {
    expect(utf8Bytes("abc")).toBe(3);
    expect(utf8Bytes("لت")).toBe(4);
    expect(profileUrl("3z.prod")).toBe("https://www.instagram.com/3z.prod/");
  });
});

describe("dmFits", () => {
  const ar = (n: number) => "ل".repeat(n);

  it("allows 1,000 bytes of plain text (500 Arabic letters) and no more", () => {
    expect(DM_TEXT_BYTES).toBe(1000);
    expect(dmFits({ id: "x", dmText: ar(500), buttons: [] }, ORIGIN)).toBe(true);
    expect(dmFits({ id: "x", dmText: ar(501), buttons: [] }, ORIGIN)).toBe(false);
  });

  it("counts the link lines and «تابعني» with the longest username, and retains the saved-rule limit of 640", () => {
    const withButton = { ...rule, dmText: "x".repeat(640) };
    expect(dmFits(withButton, ORIGIN)).toBe(true);
    expect(dmFits({ ...withButton, dmText: "x".repeat(641) }, ORIGIN)).toBe(false);
    // 470 Arabic letters (940 bytes) fit alone, but not with a link line and the follow line.
    const long = { id: "lut", dmText: ar(470), buttons: [] };
    expect(dmFits(long, ORIGIN)).toBe(true);
    expect(dmFits({ ...long, buttons: rule.buttons, followButton: true }, ORIGIN)).toBe(false);
  });
});

describe("graph", () => {
  /** What a refused call becomes: the code, and the words the log shows. */
  const refusal = (status: number, error?: MetaError["error"]) => {
    try {
      graph({ status, ok: false, body: error ? { error } : null }, "dm");
    } catch (e) {
      const { code, detail } = toReplyCode(e);
      return { code, detail };
    }
    throw new Error("graph accepted a refusal");
  };

  it("ends Meta's words with its code and subcode, so the log says exactly what Meta answered", () => {
    expect(
      refusal(400, { message: "Invalid for a private reply", code: 100, error_subcode: 2534025 }),
    ).toEqual({ code: "not_eligible", detail: "Invalid for a private reply [100/2534025]" });
    expect(refusal(400, { message: "outside window", code: 10, error_subcode: 2534022 })).toEqual({
      code: "not_eligible",
      detail: "outside window [10/2534022]",
    });
    expect(refusal(403, { message: "permission denied", code: 10 })).toEqual({
      code: "no_permission",
      detail: "permission denied [10]",
    });
    expect(refusal(400, { message: "can't receive", code: 10, error_subcode: 2018108 })).toEqual({
      code: "rejected",
      detail: "can't receive [10/2018108]",
    });
    expect(refusal(400, { message: "User cannot be messaged", code: 100 })).toEqual({
      code: "rejected",
      detail: "User cannot be messaged [100]",
    });
    expect(refusal(400, { message: "Invalid OAuth", code: 190 })).toEqual({
      code: "token_expired",
      detail: "Invalid OAuth [190]",
    });
    expect(refusal(400, { message: "slow down", code: 4 })).toEqual({
      code: "rate_limited",
      detail: "slow down [4]",
    });
    expect(refusal(500, { message: "boom", code: 1 })).toEqual({
      code: "upstream",
      detail: "boom [1]",
    });
    // Without a code from Meta there is nothing to add.
    expect(refusal(500)).toEqual({ code: "upstream", detail: "dm: 500" });
    expect(refusal(400, { message: "Bad request" })).toEqual({
      code: "rejected",
      detail: "Bad request",
    });
  });
});

describe("pickPublicReply", () => {
  it("picks one of the non-blank replies with the given random source", () => {
    expect(pickPublicReply(["أ", " ", "ب"], () => 0.9)).toBe("ب");
    expect(pickPublicReply(["أ", "ب"], () => 0)).toBe("أ");
    expect(pickPublicReply([" "], () => 0)).toBeUndefined();
    expect(pickPublicReply([])).toBeUndefined();
  });
});
