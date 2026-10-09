import { describe, expect, it } from "vitest";
import { CATEGORY_PROFILES } from "../discover/category-profiles";
import {
  categoryCreativeEvidence as evidence,
  hasTeachingEvidence,
  rankCategoryVideos,
} from "./quality";
import type { TopVideo } from "./types";
import { carxDraftCandidate } from "./carxDraft.fixture";

describe("category recommendations grounded in metadata", () => {
  it("distinguishes absent caption prose from hard exclusions without changing metadata admission", () => {
    const cases = [
      ["#anime #edit", "empty-prose"],
      ["Anime full movie with typography", "full-feature-upload"],
      ["Food processor video", "equipment"],
      ["Foreground: anime hero. Background: realistic selfie photograph", "image-prompt"],
      ["Anime edit, comment for my prompt pack", "prompt-bait"],
      ["Anime buy now discount code", "sales"],
      ["Anime full episode", "ordinary-content"],
    ] as const;
    for (const [caption, reason] of cases) {
      const result = evidence("anime", caption);
      expect(result.exclusions, caption).toContain(reason);
      expect(result.excluded, caption).toBe(true);
      expect(result.eligible, caption).toBe(false);
    }
    expect(evidence("anime", "Naruto confronts his rival in this scene").exclusions).toEqual([]);
    expect(evidence("anime", "Anime masking tutorial: trace the figure").exclusions).toEqual([]);
  });

  it("removes the real multiline CarX draft and its trailing keyword list without inventing craft", () => {
    const { title, snippet } = carxDraftCandidate.item;
    expect(evidence("cars", `${title}\n${snippet}`)).toMatchObject({
      category: true,
      eligible: false,
      creative: false,
      project: false,
      namedTechniques: [],
      teaching: false,
    });
    expect(evidence("cars", `BMW cinematic car film\n${snippet}`)).toMatchObject({
      eligible: true,
      project: true,
      namedTechniques: [],
    });
    const lesson = `Car masking tutorial: draw an outline and feather the edge. Prompt example:\n${snippet}`;
    expect(evidence("cars", lesson)).toMatchObject({
      eligible: true,
      teaching: true,
      namedTechniques: ["masking"],
    });
  });

  it("rejects full feature uploads matching a desert subject without rejecting short films or movie-editing lessons", () => {
    expect(
      evidence(
        "camping",
        "She’s Trapped in the Desert! | Thriller movie | Hangar | Full movies\nA cinematic story filmed in the desert with dramatic lighting.",
      ),
    ).toMatchObject({ category: true, excluded: true, eligible: false });
    expect(
      evidence("camping", "Desert thriller | Full-length movie\nA match cut in the opening scene")
        .eligible,
    ).toBe(false);
    expect(evidence("camping", "فيلم كامل في الصحراء\nتلوين سينمائي").eligible).toBe(false);
    for (const caption of [
      "Cinematic camping film: a weekend in the desert",
      "Desert short film — complete story",
      "Color grading a full movie tutorial\nDesert footage: match shadows between shots",
      "شرح مونتاج فيلم كامل في الصحراء خطوة بخطوة",
    ])
      expect(evidence("camping", caption).eligible, caption).toBe(true);
  });

  const draft = `Smooth cutout transition with clean subject masking, seamless edge blending, fast cinematic motion, dynamic zoom, motion blur, speed ramp, and a professional, high-quality edit with no flicker or rough edges." Or, if it's specifically for a car edit: KEYWORD BMW EDITS BMW CLIPS FOR EDITS`;

  it("does not treat the observed unfinished alternate-caption draft as proof of craft", () => {
    expect(
      evidence("cars", `BMW M4 COMPETITION CAR TROLL FACE EDITING SHORT 🔥☠️\n${draft}`),
    ).toMatchObject({
      category: true,
      creative: false,
      project: false,
      namedTechniques: [],
      teaching: false,
    });
    expect(evidence("cars", draft).namedTechniques).toEqual([]);
    expect(
      hasTeachingEvidence(
        `How to speed ramp a car video." Or, if it's specifically for a car edit: [Insert your caption]`,
      ),
    ).toBe(false);
  });

  it("preserves a separate genuine project title without borrowing techniques from its draft description", () => {
    expect(evidence("cars", `BMW cinematic car film\n${draft}`)).toMatchObject({
      category: true,
      eligible: true,
      project: true,
      namedTechniques: [],
    });
    expect(evidence("anime", `Yuta edit reworked #anime\n${draft}`)).toMatchObject({
      eligible: true,
      project: true,
      namedTechniques: [],
    });
  });

  it("preserves real instruction quoting a draft and ordinary conditional editing advice", () => {
    const lesson = `Car masking tutorial: draw the outline around the car and feather the edge. Prompt example: "${draft}`;
    expect(evidence("cars", lesson)).toMatchObject({ eligible: true, teaching: true });
    expect(evidence("cars", lesson).namedTechniques).toEqual(["masking"]);
    expect(hasTeachingEvidence(lesson)).toBe(true);
    expect(
      evidence(
        "cars",
        "Car masking tutorial. Or, if it's specifically for a car edit: track the mask along the door.",
      ),
    ).toMatchObject({ eligible: true, teaching: true });
    expect(
      evidence("cars", "AI car commercial breakdown: match cut between generated shots"),
    ).toMatchObject({ eligible: true, teaching: true });
  });

  it("separates named craft from generic AMV and ambient room lighting", () => {
    expect(evidence("anime", "Anime AMV edit")).toMatchObject({
      eligible: true,
      namedTechniques: [],
    });
    expect(evidence("coffee", "Cozy coffee room lighting ideas")).toMatchObject({
      eligible: false,
      namedTechniques: [],
    });
    expect(evidence("coffee", "Coffee photography rim light tutorial").namedTechniques).toContain(
      "lighting",
    );
  });
  it.each([
    "Speed ramp tutorial coming soon",
    "Comment tutorial for my masking guide",
    "Want a tutorial for this match cut?",
    "I followed a speed ramp tutorial",
    "My new video #tutorial",
    "اكتب شرح عشان ارسل الطريقة",
    "شرح الماسك قريب",
  ])("does not mistake requests or future lessons for teaching: %s", (text) => {
    expect(hasTeachingEvidence(text)).toBe(false);
  });
  it.each([
    "Masking tutorial: align the frames and draw a mask",
    "How to film coffee",
    "Match cut breakdown. Comment CAR for the prompt.",
    "شرح الماسك خطوة بخطوة",
  ])("preserves actual teaching even alongside an incidental request: %s", (text) => {
    expect(hasTeachingEvidence(text)).toBe(true);
  });
  it("keeps the observed Four Corner Beat Sync tutorial and Arabic craft teaching tags", () => {
    const caption =
      "Four Corner Beat Sync effect #CapCut #capcutpioneer #animeedit #demonslayer #tutorial";
    expect(hasTeachingEvidence(caption)).toBe(true);
    expect(evidence("anime", caption)).toMatchObject({
      eligible: true,
      teaching: true,
      namedTechniques: ["beat sync"],
    });
    expect(hasTeachingEvidence("تقسيم الشاشة للأنمي #شرح")).toBe(true);
  });
  it("recognizes the observed first-person filming process and explanatory cinematic shot list", () => {
    const carProcess =
      "How I Film Cinematic Car Videos (Rollers + B-Roll). Join the #1 Automotive Filmmakers Community";
    const shotList =
      "A Simple list to make your videos feel more cinematic. –Wide shot This sets the scene. –Low angle. –Close-up. –High angle. –Profile shot.";
    expect(hasTeachingEvidence(carProcess)).toBe(true);
    expect(evidence("cars", carProcess)).toMatchObject({ eligible: true, teaching: true });
    expect(hasTeachingEvidence(shotList)).toBe(true);
  });
  it("recognizes a single actual editing tip as learning instead of a finished inspiration edit", () => {
    const caption =
      "Quick and easy editing tip for your gaming clips! #cod #warzone #capcut #gaming #streaming";
    expect(evidence("gaming", caption)).toMatchObject({ eligible: true, teaching: true });
    expect(hasTeachingEvidence("Editing tip coming tomorrow for your gaming clips")).toBe(false);
    expect(hasTeachingEvidence("Comment TIP for my gaming editing tip")).toBe(false);
    expect(hasTeachingEvidence("Tip your barista for this coffee")).toBe(false);
  });
  it("does not mistake a commercial coffee machine's product specification demo for a filmed ad", () => {
    expect(
      evidence(
        "coffee",
        "CM3131B Product Demo: Compact Commercial Coffee Machine INS Video. Product specifications.",
      ),
    ).toMatchObject({
      creative: false,
      project: false,
      eligible: false,
    });
    expect(evidence("coffee", "Commercial espresso machine product demo").project).toBe(false);
    expect(evidence("coffee", "Coffee machine commercial filmed with match cuts")).toMatchObject({
      eligible: true,
      project: true,
    });
    expect(evidence("coffee", "Commercial coffee machine stop motion video ad")).toMatchObject({
      eligible: true,
      project: true,
    });
  });
  it.each([
    "How I Film Cinematic Car Videos: coming soon",
    "Comment CAR for how I film cinematic car videos",
    "Want to see how I shoot car rollers?",
    "How I will film my car video next week",
    "My cinematic film: wide shot, low angle, close-up, high angle, profile shot",
    "Comment SHOTS for a shot list: wide shot, low angle, close-up",
    "A Simple list to make your videos feel more cinematic. Wide shot this sets the scene. Low angle. Close-up. Coming soon.",
  ])(
    "does not promote first-person promises, requests or a bare shot list into teaching: %s",
    (text) => {
      expect(hasTeachingEvidence(text)).toBe(false);
    },
  );
  it.each([
    "Four Corner Beat Sync effect #tutorial coming soon",
    "Anime beat sync: comment #tutorial to get the guide",
    "Anime beat sync tutorial coming soon. #tutorial",
    "Anime beat sync edit. Coming soon. #tutorial",
    "Anime masking edit. Want a #tutorial?",
    "#beatsync #animeedit #tutorial",
    "Anime AMV #tutorial",
    "تقسيم الشاشة للأنمي #شرح قريب",
    "تقسيم الشاشة اكتب #شرح عشان ارسل الطريقة",
  ])("a teaching tag cannot turn a promise or unsupported post into a lesson: %s", (text) => {
    expect(hasTeachingEvidence(text)).toBe(false);
  });
  it("requires both subject and creative evidence across all12 category profiles", () => {
    for (const [id, profile] of Object.entries(CATEGORY_PROFILES)) {
      expect(evidence(id, profile.examples.en).eligible, id).toBe(true);
      expect(evidence(id, profile.examples.ar).eligible, `${id}:Arabic`).toBe(true);
    }
    expect(evidence("food", "Cinematic car edit with speed ramps").eligible).toBe(false);
    expect(evidence("cars", "carpet lighting review").category).toBe(false);
    expect(evidence("coffee", "coffeemaker price list").eligible).toBe(false);
  });
  it.each([
    "Epic Food Photography Lighting Setup! #FoodPhotography #LightingSetup #FilmmakingTips. Transform your food photos with this easy lighting setup! I'm sharing my secrets for creating mouthwatering images.",
    "PHOTOGRAPHER EXPLAINS: Easiest Food Photography Lighting Techniques. I am talking all about my go to lighting setups.",
  ])("recognizes observed explanatory food photography lessons: %s", (text) => {
    expect(hasTeachingEvidence(text)).toBe(true);
    expect(evidence("food", text)).toMatchObject({ eligible: true, teaching: true });
  });
  it.each([
    "Food photography lighting: I'm sharing my secrets tomorrow",
    "Food photography lighting: I'm sharing my secrets if you comment FOOD",
    "Food photography lighting setup for my finished commercial",
    "I'm sharing my photography portfolio with you",
  ])("requires actual explanatory intent beyond a finished photo project: %s", (text) => {
    expect(hasTeachingEvidence(text)).toBe(false);
  });
  it("distinguishes a described creative project from a plot clip with an edit hashtag", () => {
    expect(evidence("anime", "Yuta edit reworked #animeedit")).toMatchObject({
      eligible: true,
      project: true,
      namedTechniques: [],
    });
    expect(evidence("anime", "Naruto never gives up #animeedit")).toMatchObject({
      project: false,
      namedTechniques: [],
    });
    expect(evidence("camping", "Cinematic camping film")).toMatchObject({
      eligible: true,
      project: true,
      namedTechniques: [],
    });
  });
  it.each([
    "Nobody perfect🙄# #amv #anime #3danimation #funny #scene #edit #memes amv #anime #3danimation #funny #scene #edit #memes",
    "Nobody perfect #anime\namv #anime #scene #edit",
    "Naruto never gives up #anime edit #memes",
    "Nobody perfect #anime AMV/EDIT #scene",
  ])("does not join an isolated project label across a hashtag pile: %s", (caption) => {
    expect(evidence("anime", caption)).toMatchObject({ project: false, namedTechniques: [] });
  });
  it.each([
    "Anime AMV edit",
    "Yuta edit reworked #animeedit",
    "Deku and Dark Might You Are Next「Boku no Hero Academia Season 7 AMV/EDIT」ᴴᴰ #anime #scene",
    "DEKU is back HOME #anime\nDeku and Dark Might You Are Next「Boku no Hero Academia Season 7 AMV/EDIT」ᴴᴰ",
    "Naruto montage #anime",
    "مونتاج أنمي #انمي",
  ])("preserves a described AMV or edit project despite adjacent tags: %s", (caption) => {
    expect(evidence("anime", caption)).toMatchObject({ eligible: true, project: true });
  });
  it.each([
    "Stainless Steel Kitchen Prep: Perfect for Food Prep",
    "4 Food Processors for All Your Kitchen Prep in 2026",
    "Heavy Duty Stainless Steel Kitchen Prep Tables | Commercial Food Prep Work Tables",
    "maya.hayaa #trialreels .",
    "@nivyarodrigues2020 literally me around food.",
    "food POV viral aesthetic",
    "food prices and deals",
    "#foodedit #cinematic",
    "Food processor cinematic review with lighting tutorial",
    "New project: #foodedit",
    "sneaking food...🌚|| #shorts #viral #trending #bts #fyp #relatable #edit",
    "Speed Only Allows Rudy To Eat His Food ❤️‍🩹 #ishowspeed #edit",
    "Their first time trying spaghetti bolognese.#shorts #shortvideo #ytshorts #film #foryou #edit Food reaction",
  ])("rejects the observed Food filler: %s", (title) => {
    expect(evidence("food", title).eligible).toBe(false);
  });
  it.each([
    "5 shots every restaurant video needs",
    "Baba Restaurant Speed Ramp Edit | Food",
    "Food kitchen prep timelapse cinematic film",
    "Burger commercial",
    "Pizza stop motion ad",
    "إعلان مطعم سينمائي",
    "تصوير برجر تايم لابس",
    "New project: #foodedit #matchcut",
  ])("preserves useful examples: %s", (title) =>
    expect(evidence("food", title).eligible).toBe(true),
  );
  it("does not treat ordinary espresso shots or hashtag-only numeric captions as creative evidence", () => {
    expect(evidence("coffee", "Two espresso shots for my morning coffee").eligible).toBe(false);
    expect(evidence("food", "#foodedit #cinematic 2026").eligible).toBe(false);
  });
  it("rejects equipment for generic lesson tutorials too, with no false creative flag", () => {
    expect(evidence("food", "How to use food processors - editing tutorial").creative).toBe(false);
    expect(evidence("food", "speed ramp editing tutorial")).toMatchObject({
      category: false,
      creative: true,
      eligible: false,
    });
  });
  it.each([
    [
      "cars",
      "Car rotoscoping tutorial",
      "Comment CAR to get the AI prompt for this cinematic car commercial",
    ],
    ["food", "Food cutout animation tutorial", "Food grocery deals today #foodedit"],
    ["anime", "Anime split screen beat sync", "Anime full episode #animeedit"],
    ["travel", "Travel whip pan tutorial", "Travel photography preset pack - discount code"],
    ["football", "Football freeze frame tutorial", "Football coaching: how to shoot harder #edit"],
    ["coffee", "Coffee macro closeup tutorial", "Coffee commercial espresso machine - buy now"],
    ["perfume", "Perfume reflection shot tutorial", "Perfume commercial offer - shop now"],
    ["camping", "Camping drone reveal tutorial", "Desert tent lighting shop now"],
    [
      "fashion",
      "Fashion motion graphics breakdown",
      "Fashion lookbook: shop now with discount code",
    ],
    ["gaming", "Valorant motion tracking tutorial", "Gaming montage full uncut gameplay"],
    [
      "weddings",
      "Wedding film sound design breakdown",
      "Wedding photography packages - discount code",
    ],
    ["gym", "Gym light sweep tutorial", "Gym workout routine to build muscle #gymedit"],
  ])("%s keeps a named craft and drops category-specific filler", (genre, useful, noise) => {
    expect(evidence(genre, useful).eligible, useful).toBe(true);
    expect(evidence(genre, noise).eligible, noise).toBe(false);
    const result = rankCategoryVideos(genre, [
      { url: "https://www.instagram.com/p/useful", title: useful, views: 30 },
      { url: "https://www.instagram.com/p/noise", title: noise, views: 9_000_000 },
    ]);
    expect(result.map((video) => video.title)).toEqual([useful]);
  });
  it.each([
    ["cars", "سيارة روتوسكوب"],
    ["food", "أكل تحريك القصاصات"],
    ["anime", "أنمي تقسيم الشاشة"],
    ["travel", "سفر ويب بان"],
    ["football", "كورة فريز فريم"],
    ["coffee", "قهوة تصوير ماكرو"],
    ["perfume", "عطر تصوير انعكاسات"],
    ["camping", "كشتة لقطة درون"],
    ["fashion", "أزياء موشن جرافيك"],
    ["gaming", "قيمنق تتبع الحركة"],
    ["weddings", "زواج تصميم صوت"],
    ["gym", "جيم لايت سويب"],
  ])("%s recognizes a specific Arabic craft", (genre, title) => {
    expect(evidence(genre, title).eligible).toBe(true);
  });
  it("keeps fan edits and explicit teaching but rejects a generic edit tag on filmed subjects", () => {
    for (const [genre, title] of [
      ["anime", "Anime edit"],
      ["football", "Messi edit"],
      ["gaming", "Valorant edit"],
      ["cars", "Car editing tutorial"],
      ["food", "شرح ايديت أكل"],
    ])
      expect(evidence(genre, title).eligible, title).toBe(true);
    for (const [genre, title] of [
      ["food", "Food #edit"],
      ["cars", "My car #edit"],
      ["gym", "Gym ايديت"],
      ["food", "لقطات من طعام اليوم #ايديت"],
    ])
      expect(evidence(genre, title).eligible, title).toBe(false);
  });
  it("rejects prompt bait even with craft keywords, and allows a real breakdown with incidental shop links", () => {
    expect(
      evidence("cars", "Comment CAR to get the AI prompt - car speed ramp match cut commercial")
        .eligible,
    ).toBe(false);
    expect(evidence("cars", "اكتب سيارة لتحصل على برومبت إعلان سيارات سينمائي").eligible).toBe(
      false,
    );
    expect(
      evidence("coffee", "Coffee macro closeup lighting tutorial. My camera affiliate links below.")
        .eligible,
    ).toBe(true);
    expect(
      evidence(
        "cars",
        "AI car commercial breakdown: match cut between generated shots. Comment CAR for the prompt.",
      ).eligible,
    ).toBe(true);
    expect(evidence("food", "Commercial food prices are rising").eligible).toBe(false);
  });
  it.each([
    ["travel", "Time Travel Effect Tutorial🔥🎥"],
    [
      "camping",
      "A highly realistic cinematic selfie photograph during a desert film shoot in India. Foreground: I am holding the phone",
    ],
    ["perfume", "Creating a Luxurious Atmosphere for Your Perfume Store"],
    [
      "gaming",
      "✅ GATOTKACA Build Tutorial ! #mobilelegend #indonesia #gaming #gamer #game #savage #mobilelegends #mlbb #montage",
    ],
    ["food", "How to cook food for a family #edit"],
  ])("rejects observed category ambiguity for %s", (genre, title) => {
    expect(evidence(genre, title).eligible).toBe(false);
  });
  it("retains real destination footage, filming instruction and AI craft demonstrations", () => {
    expect(
      evidence("travel", "Travel film: a time travel match cut across my vacation destinations")
        .eligible,
    ).toBe(true);
    expect(
      evidence("camping", "Desert AI filmmaking tutorial: match cut between generated shots")
        .eligible,
    ).toBe(true);
    expect(evidence("perfume", "Perfume store b-roll filming breakdown").eligible).toBe(true);
    expect(evidence("food", "How to film food").eligible).toBe(true);
  });
});

describe("ranking and diversity", () => {
  const video = (
    id: string,
    title = "Food cinematic edit",
    creator?: string,
    views = 0,
  ): TopVideo => ({
    url: `https://www.instagram.com/p/${id}`,
    title,
    creator,
    views,
  });
  it("specific visual techniques beat raw popularity or repeated search hits", () => {
    const repeated = video("repeated", "Food cinematic commercial", "@one", 999999);
    const specific = video("specific", "Food cinematic match cut commercial", "@two", 10);
    const result = rankCategoryVideos("food", [
      repeated,
      repeated,
      repeated,
      specific,
      video("filler", "Food prices", "@three", 1000000),
    ]);
    expect(result.map((v) => v.url)).toEqual([specific.url, repeated.url]);
    expect(result[0].evidence).toEqual({
      basis: "metadata",
      subjects: ["food"],
      techniques: ["match cut", "cinematic", "creative commercial"],
    });
  });
  it("gives distinct creators the first places, caps one creator at three, never pads", () => {
    const same = [1, 2, 3, 4, 5].map((n) => video(`a${n}`, "Food cinematic speed ramp edit", "@A"));
    const other = video("other", "Food cinematic commercial", "@b");
    expect(rankCategoryVideos("food", [...same, other]).map((v) => v.url)).toEqual([
      same[0].url,
      other.url,
      same[1].url,
      same[2].url,
    ]);
    expect(rankCategoryVideos("food", [video("bad", "Food processors")])).toEqual([]);
  });
  it("a single named craft outranks a popular title stuffed with generic creative labels", () => {
    const craft = video("craft", "Food rotoscoping", "@craft", 10);
    const broad = video(
      "broad",
      "Food cinematic commercial photography montage edit",
      "@broad",
      1_000_000,
    );
    expect(rankCategoryVideos("food", [broad, craft]).map((v) => v.url)).toEqual([
      craft.url,
      broad.url,
    ]);
  });
  it("preserves descriptions and dates, validates links and recomputes untrusted stored evidence", () => {
    const good = {
      ...video("good", "Lunch shoot"),
      snippet: "Food cinematic match cut",
      publishedAt: "2026-10-06T00:00:00Z",
      source: "tavily" as const,
    };
    const bad = {
      ...video("bad", "Price list"),
      evidence: { basis: "metadata" as const, subjects: ["food"], techniques: ["cinematic"] },
    };
    const result = rankCategoryVideos("food", [
      good,
      bad,
      { ...good, url: "https://example.com/reel/x" },
      { ...good, url: "https://www.instagram.com/explore/tags/food" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject(good);
  });
});
