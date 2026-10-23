import { describe, expect, it } from "vitest";
import {
  OTHER_EDITORS,
  dropHiddenEditors,
  editorLabel,
  editorSearches,
  hiddenEditorsFor,
  mentionsHiddenEditor,
  namesOtherEditor,
} from "./editorFilter";

const AE = ["after effects"];

describe("editor scope (owner: DaVinci Resolve and CapCut only)", () => {
  it("hides every other editing app under 'mine' and nothing under 'all'", () => {
    expect(hiddenEditorsFor("mine")).toBe(OTHER_EDITORS);
    expect(OTHER_EDITORS).toEqual(
      expect.arrayContaining(["after effects", "premiere pro", "alight motion", "vn editor"]),
    );
    expect(hiddenEditorsFor("all")).toEqual([]);
  });

  it.each([
    ["After Effects clone tutorial", "after effects"],
    ["Premiere Pro speed ramp", "premiere pro"],
    ["Alight Motion shake", "alight motion"],
    ["#vnvideoeditor smooth edit", "vn editor"],
    ["edited in the VN app", "vn editor"],
    ["Final Cut Pro glitch", "final cut pro"],
    ["Filmora text tracking", "filmora"],
    ["InShot transition", "inshot"],
    ["KineMaster tutorial", "kinemaster"],
    ["Vegas Pro shake", "vegas pro"],
    ["PowerDirector zoom", "powerdirector"],
    ["LumaFusion color", "lumafusion"],
    ["Splice app edit", "splice"],
    ["AE preset pack", "after effects"],
  ])("hides %s", (title, editor) => {
    expect(namesOtherEditor({ title })).toBe(editor);
  });

  it.each([
    ["CapCut clone effect"],
    ["DaVinci Resolve glow"],
    ["clone effect edit"],
    ["CapCut vs After Effects"],
    ["world premiere of my edit"],
    ["splice two clips"],
    [""],
  ])("keeps %j", (title) => {
    expect(namesOtherEditor({ title })).toBeNull();
  });

  it("keeps a card that names DaVinci or CapCut anywhere, even beside another app", () => {
    expect(
      namesOtherEditor({ title: "Clone effect", snippet: "#capcut #aftereffects" }),
    ).toBeNull();
    expect(
      dropHiddenEditors([{ title: "DaVinci Resolve vs Premiere Pro" }], OTHER_EDITORS).count,
    ).toBe(0);
  });

  it("searches CapCut then DaVinci Resolve under 'mine', once when the text names one", () => {
    expect(editorSearches("clone effect", "mine")).toEqual([
      { scope: "search-capcut", query: "clone effect capcut", heading: "CapCut" },
      {
        scope: "search-davinci",
        query: "clone effect davinci resolve",
        igQuery: "clone effect davinci",
        heading: "DaVinci Resolve",
      },
    ]);
    expect(editorSearches("clone effect CapCut", "mine")).toEqual([
      { scope: "search-capcut", query: "clone effect CapCut", heading: "CapCut" },
    ]);
    expect(editorSearches("glow davinci", "mine")).toEqual([
      { scope: "search-davinci", query: "glow davinci", heading: "DaVinci Resolve" },
    ]);
    // Instagram's keyword search finds nothing for "... davinci resolve" but posts for "... davinci".
    expect(editorSearches("speed ramp  DaVinci   Resolve", "mine")).toEqual([
      {
        scope: "search-davinci",
        query: "speed ramp  DaVinci   Resolve",
        igQuery: "speed ramp DaVinci",
        heading: "DaVinci Resolve",
      },
    ]);
    expect(editorSearches("glow resolve", "mine")).toEqual([
      { scope: "search-davinci", query: "glow resolve", heading: "DaVinci Resolve" },
    ]);
    expect(editorSearches(" clone effect ", "all")).toEqual([
      { scope: "search", query: "clone effect" },
    ]);
  });
});

describe("mentionsHiddenEditor", () => {
  it.each([
    ["title", { title: "After Effects tutorial" }],
    ["lower case", { title: "learn after effects fast" }],
    ["one word", { title: "AfterEffects" }],
    ["hashtags field", { title: "car edit", hashtags: ["#aftereffects", "#edit"] }],
    ["hashtag text", { snippet: "#aftereffects #edit" }],
    ["bare hashtag word", { hashtags: ["aftereffects"] }],
    ["AE template", { title: "AE template pack" }],
    ["AE preset", { snippet: "free AE Preset for you" }],
    ["handle", { handle: "@aftereffects_daily" }],
    ["Arabic caption", { title: "شرح بسيط في after effects للمبتدئين" }],
  ])("hides %s", (_name, item) => {
    expect(mentionsHiddenEditor(item, AE)).toBe("after effects");
  });

  it.each([
    ["aesthetic", { title: "aesthetic car edit" }],
    ["ae alone", { title: "ae" }],
    ["ae in a sentence", { title: "the ae of this edit" }],
    ["DaVinci glow", { title: "DaVinci glow effect" }],
    ["effects and transitions", { title: "effects and transitions" }],
    ["CapCut", { title: "CapCut template" }],
    ["empty", {}],
  ])("keeps %s", (_name, item) => {
    expect(mentionsHiddenEditor(item, AE)).toBeNull();
  });

  it("never matches with an empty hidden list", () => {
    expect(mentionsHiddenEditor({ title: "After Effects tutorial" }, [])).toBeNull();
  });

  it("matches other names as a whole phrase", () => {
    expect(mentionsHiddenEditor({ title: "Premiere Pro tips" }, ["premiere pro"])).toBe(
      "premiere pro",
    );
    expect(mentionsHiddenEditor({ title: "premiere professional" }, ["premiere pro"])).toBeNull();
    expect(mentionsHiddenEditor({ title: "After Effects" }, ["premiere pro"])).toBeNull();
  });
});

describe("dropHiddenEditors", () => {
  const items = [
    { id: 1, title: "Car edit" },
    { id: 2, title: "After Effects tutorial" },
    { id: 3, title: "Premiere Pro tips" },
    { id: 4, title: "Speed ramp" },
  ];

  it("keeps the order of what stays and reports the count and editors", () => {
    const r = dropHiddenEditors(items, ["after effects", "premiere pro"]);
    expect(r.items.map((i) => i.id)).toEqual([1, 4]);
    expect(r.count).toBe(2);
    expect(r.editors).toEqual(["after effects", "premiere pro"]);
  });

  it("returns the same array when nothing is hidden", () => {
    expect(dropHiddenEditors(items, []).items).toBe(items);
    const none = dropHiddenEditors([items[0], items[3]], AE);
    expect(none).toMatchObject({ count: 0, editors: [] });
  });

  it("labels editors for display", () => {
    expect(editorLabel("after effects")).toBe("After Effects");
    expect(editorLabel("premiere pro")).toBe("Premiere Pro");
  });
});
