import { describe, expect, it } from "vitest";
import {
  DM_TEXT_BYTES,
  dmFits,
  FOLLOW_TITLE,
  messageButtons,
  messagePayload,
  pickPublicReply,
  profileUrl,
  textBody,
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

  it("sends text without buttons and a button template with them", () => {
    expect(messagePayload(" هلا ", [])).toEqual({ text: "هلا" });
    expect(messagePayload("هلا", [{ title: "أ", url: LUT }])).toEqual({
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "هلا",
          buttons: [{ type: "web_url", url: LUT, title: "أ" }],
        },
      },
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

  it("counts the link lines and «تابعني» with the longest username, and caps a template's text at 640", () => {
    const withButton = { ...rule, dmText: "x".repeat(640) };
    expect(dmFits(withButton, ORIGIN)).toBe(true);
    expect(dmFits({ ...withButton, dmText: "x".repeat(641) }, ORIGIN)).toBe(false);
    // 470 Arabic letters (940 bytes) fit alone, but not with a link line and the follow line.
    const long = { id: "lut", dmText: ar(470), buttons: [] };
    expect(dmFits(long, ORIGIN)).toBe(true);
    expect(dmFits({ ...long, buttons: rule.buttons, followButton: true }, ORIGIN)).toBe(false);
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
