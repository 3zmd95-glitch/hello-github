/** Recommendations are grounded in titles/captions/descriptions, never a claim that we watched a video. */
import { CATEGORY_PROFILES } from "../discover/category-profiles";
import { mentions } from "../discover/relevance";
import { normalizeTerm } from "../discover/terms";
import { canonicalUrl, isVideoUrl, platformForHost } from "../normalize";
import type { TopVideo } from "./video";

const CREATIVE: Record<string, readonly string[]> = {
  "match cut": ["match cut", "matchcut", "ماتش كت"],
  "speed ramp": ["speed ramp", "speedramp", "سبيد رامب"],
  "beat sync": ["beat sync", "beatsync", "على الإيقاع"],
  "b-roll": ["b roll", "broll", "بي رول"],
  "rolling shots": ["rolling shot", "roller", "رولينج"],
  "camera movement": [
    "camera movement",
    "camera transition",
    "orbit shot",
    "tracking shot",
    "drift shot",
    "panning",
    "حركة الكاميرا",
    "لقطات متحركة",
  ],
  "shot composition": ["composition", "low angle", "زاوية منخفضة", "تكوين"],
  "shot planning": ["shot"],
  lighting: [
    "lighting",
    "backlight",
    "backlit",
    "backlighting",
    "rim light",
    "light painting",
    "إضاءة",
    "اضاءه",
  ],
  "color grading": [
    "color grading",
    "colour grading",
    "color grade",
    "colorgrade",
    "تلوين سينمائي",
  ],
  "stop motion": ["stop motion", "stopmotion", "ستوب موشن"],
  "time lapse": ["time lapse", "timelapse", "hyperlapse", "هايبرلابس", "تايم لابس"],
  "sound design": ["sound design", "تصميم صوت"],
  "rack focus": ["rack focus", "focus pull", "راك فوكس"],
  "slow motion": ["slow motion", "slowmo", "سلوموشن"],
  masking: ["masking", "mask transition", "ماسك"],
  rotoscoping: ["rotoscope", "rotoscoping", "روتوسكوب"],
  "cutout animation": ["cutout animation", "cut out animation", "paper cutout", "تحريك القصاصات"],
  "whip pan": ["whip pan", "swish pan", "ويب بان"],
  "freeze frame": ["freeze frame", "freeze effect", "فريز فريم", "تجميد اللقطة"],
  "split screen": ["split screen", "splitscreen", "تقسيم الشاشة"],
  "motion tracking": [
    "motion tracking",
    "text tracking",
    "tracked text",
    "تتبع الحركة",
    "تتبع النص",
  ],
  "motion graphics": ["motion graphics", "motion graphic", "موشن جرافيك"],
  "text animation": ["text animation", "animated text", "kinetic typography", "تحريك النص"],
  "macro closeup": [
    "macro shot",
    "macro closeup",
    "macro close up",
    "macro photography",
    "تصوير ماكرو",
  ],
  "reflection shot": ["reflection shot", "reflection photography", "تصوير انعكاسات"],
  "drone reveal": ["drone reveal", "drone shot", "لقطة درون"],
  "light sweep": ["light sweep", "لايت سويب"],
  "velocity edit": ["velocity edit", "فيلوسيتي"],
  "invisible cut": ["invisible cut", "hidden cut", "seamless cut", "قص مخفي"],
  "dolly zoom": ["dolly zoom", "vertigo effect", "دولي زوم"],
  transitions: ["transition", "ترانزيشن", "انتقال"],
  montage: ["montage", "amv", "مونتاج"],
  filmmaking: [
    "filmmaking",
    "filming",
    "how to film",
    "videography",
    "cinematography",
    "photography",
    "short film",
    "highlight film",
    "lookbook",
    "تصوير",
    "فيلم",
  ],
  cinematic: ["cinematic", "سينمائي"],
  editing: ["edit", "editing", "edited", "ايديت", "إيديت"],
  "creative commercial": [
    "commercial",
    "advertisement",
    "video ad",
    "spec ad",
    "cinematic ad",
    "إعلان",
    "اعلان",
  ],
};
const FORMS = Object.entries(CREATIVE).map(([name, aliases]) => ({
  name,
  aliases: aliases.map(normalizeTerm),
}));
// A project/style word can describe a useful reference, but cannot outweigh shopping/prompt bait
// or count as a named craft. A generic #edit alone is not a filming technique.
const PROJECT = new Set(["filmmaking", "cinematic", "creative commercial", "montage"]);
const CONTEXTUAL = new Set(["shot planning", "lighting", "editing"]);
const FAN_EDIT_GENRES = new Set(["anime", "football", "gaming"]);
const CRAFT_FOR_SOUNDTRACK = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${Object.values(CREATIVE)
    .flat()
    .map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[ -]+"))
    .join(
      "|",
    )})(?:s)?(?:[ -]+(?:reels?|videos?|edits?))?[ -]+(?:songs?|music|audio|soundtracks?|tracks?)(?=\\s*(?:$|(?:for|ideas?|suggestions?|recommendations?)\\b))`,
  "iu",
);

/** Music recommendations describe where a track could be used, not an edit already performed.
 * Mask the resource span only: retain independent title/body craft, credits and actual lessons. */
function appliedCraftText(text: string): string {
  return text
    .split(
      /([.!?؟;؛|\r\n]+|[,،—]\s*(?=(?:i|we)\s+(?:filmed|shot|edited|animated|created)\b|و?(?:صورت|صورنا|عدلت|عدلنا|صممت|صممنا)\s))/iu,
    )
    .map((clause, index) => {
      if (index % 2) return clause;
      const purpose =
        /\b(?:songs?|music|audio|soundtracks?|tracks?)\s+(?:(?:ideas?|suggestions?|recommendations?)(?:\s+for)?|for|to (?:use|add) (?:to|in|for))\b|(?:[أا]غاني|موسيقى|موسيقي|صوتيات|[أا]صوات)\s+(?:مناسب[ةه]\s+)?(?:لل?|من [أا]جل)/iu.exec(
          clause,
        );
      // Decorative suffixes and tags do not change a soundtrack noun phrase into applied craft.
      // Removing only the tail preserves match positions in the original source clause.
      const modifier = CRAFT_FOR_SOUNDTRACK.exec(
        clause.replace(/(?:#[\p{L}\p{N}_]+|\((?:part|pt)\s+\d{1,3}\)|[^\p{L}\p{N}\s]|\s)+$/giu, ""),
      );
      const start = Math.min(purpose?.index ?? Infinity, modifier?.index ?? Infinity);
      // A bare #tutorial cannot turn intended-use words into an applied technique or a lesson.
      if (!Number.isFinite(start) || hasTeachingEvidence(clause.replace(/#[\p{L}\p{N}_]+/gu, " ")))
        return clause;
      return clause.slice(0, start);
    })
    .join("");
}

/** An unfinished alternate-caption draft is not a description of the published edit. Remove its
 * sample and unresolved continuation, preserving independent titles and preceding instruction.
 * This deliberately does not classify AI work, memes, or ordinary prompt tutorials as invalid. */
function captionEvidenceText(text: string): string {
  const alternateDraft =
    /\bor,?\s+if\s+(?:it['’]s|it is|this is)\s+(?:specifically\s+)?for\s+(?:a|an|your)\s+[^:\r\n]{1,80}\b(?:edit|video|reel|caption|description)\s*:/gi;
  const quoteLabel =
    /\b(?:(?:quoted|example)\s+(?:prompt|caption|description)|(?:prompt|caption|description)\s+(?:example|template))\s*:/i;
  for (const marker of text.matchAll(alternateDraft)) {
    const continuation = text.slice(marker.index + marker[0].length);
    // Public descriptions retain line breaks: a standalone KEYWORD heading can follow several
    // blank lines. Its whole list belongs to the draft, including later apparent craft labels.
    if (
      !/^\s*(?:keywords?|hashtags?)\b/i.test(continuation) &&
      !/^[^\r\n]*\[(?:add|insert|your)\s+[^\]]{1,80}\]/i.test(continuation)
    )
      continue;

    const prefix = text.slice(0, marker.index);
    const lineStart = prefix.lastIndexOf("\n") + 1;
    const line = prefix.slice(lineStart);
    if (line.trim()) {
      const label = quoteLabel.exec(line);
      return prefix.slice(0, lineStart + (label?.index ?? 0));
    }

    // A standalone alternate marker can follow the closing quote of its sample. Drop that
    // sample line too, but never borrow the separately supplied title's creative claims.
    const previous = prefix.trimEnd();
    const previousStart = previous.lastIndexOf("\n") + 1;
    const previousLine = previous.slice(previousStart);
    const label = quoteLabel.exec(previousLine);
    if (label || /["”]\s*$/.test(previousLine))
      return previous.slice(0, previousStart + (label?.index ?? 0));
    return previous;
  }
  return text;
}

/** A bare AMV/edit label beside tags does not describe a creative project. Keep a title's
 * subject and project cue in the same prose segment instead of joining text across tag piles. */
function describedEditProject(genreId: string, text: string): boolean {
  const aliases = [
    ...CREATIVE.montage,
    ...(FAN_EDIT_GENRES.has(genreId) ? CREATIVE.editing : []),
  ].map(normalizeTerm);
  return text.split(/#[\p{L}\p{N}_]+|https?:\/\/\S+|[\r\n]+/gu).some((segment) => {
    const normalized = normalizeTerm(segment);
    if (!aliases.some((alias) => mentions(normalized, alias))) return false;
    // These generic labels can repeat as SEO text. A named subject/title, not another label,
    // supplies descriptive context (e.g. "Yuta edit reworked" or "Deku ... AMV/EDIT").
    const context = normalized.replace(
      /\b(?:amv|montage|edit|edits|editing|edited)\b|(?<!\p{L})(?:مونتاج|ايديت|إيديت)(?!\p{L})/giu,
      " ",
    );
    return /\p{L}{2}/u.test(context);
  });
}

/** A creator's biography, SEO list and statutory notice describe neither this post's lesson
 * nor its steps. Keep the actual title/body, and resume when a new paragraph/section begins. */
function postTeachingText(text: string): string {
  let ancillary = false;
  const output: string[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim() || !/[\p{L}\p{N}]/u.test(line)) {
      ancillary = false;
      output.push("");
      continue;
    }
    const heading = line.match(/^[^\p{L}\p{N}]*([\p{L}][\p{L}\p{N} &/-]{0,65}):\s*(.*)$/u);
    if (heading) ancillary = false;
    const name = heading?.[1].toLowerCase().trim() ?? "";
    const body = heading?.[2] ?? "";
    const biography =
      /^(?:about me|about us|about (?:the|my|our) channel|creator bio)$/.test(name) &&
      (!body || /^(?:welcome\b|(?:i|we|my|our)\b)/i.test(body));
    const keywords =
      /^(?:tags|keywords|hashtags)(?:\s*(?:&|and)\s*(?:tags|keywords|hashtags))*$/.test(name);
    const externalTutorialChannel =
      /^tutorials? channel$/.test(name) && /^[\s\-–—:>]*https?:\/\/\S+\s*$/i.test(body);
    // This dedicated outbound resource line advertises instruction elsewhere, not this upload.
    // Do not suppress following post-level instructions or titles that themselves name a lesson.
    if (index > 0 && externalTutorialChannel) continue;
    // A title such as "About Me: typography tutorial" is real post-level text, not a bio footer.
    if (index > 0 && (biography || keywords)) ancillary = true;
    const legal =
      /\bcopyright disclaimer under section 107\b|\bnon[ -]?profit,?\s+educational or personal use tips the balance\b/i.exec(
        line,
      );
    if (legal) {
      if (!ancillary) output.push(line.slice(0, legal.index));
      ancillary = true;
    } else if (!ancillary) output.push(line);
  }
  return output.join("\n");
}

/** A teaching word alone is not a lesson when the post only requests, promises or advertises one. */
export function hasTeachingEvidence(text: string): boolean {
  text = postTeachingText(captionEvidenceText(text));
  const prose = text.replace(/#[\p{L}\p{N}_]+/gu, " ").replace(/https?:\/\/\S+/g, " ");
  const normalized = normalizeTerm(prose);
  const craftContext =
    /\b(?:photography|filmmaking|cinematography|videography|editing|animation)\b/i.test(prose);
  const namedCraft = FORMS.some(
    ({ name, aliases }) =>
      !PROJECT.has(name) &&
      !CONTEXTUAL.has(name) &&
      name !== "transitions" &&
      aliases.some((alias) => mentions(normalized, alias)),
  );
  // A concise real craft demonstration may carry its teaching label as #tutorial, as in the
  // observed Four Corner Beat Sync lesson. The tag alone, or craft only in tags, is insufficient.
  const tagIsClaimedLesson =
    namedCraft &&
    !/\b(?:comment|dm|message|reply|want|need|request|coming|soon|tomorrow|later|next week|followed|watched|credit to|not a tutorial|no tutorial)\b|(?:تبون|تبغون|تريدون|اكتب|علق|ارسل|أرسل|قريب|بكرة|بكره|لاحق|راح|سوف|ليس شرح|مو شرح)/iu.test(
      prose,
    );
  const teachingText = tagIsClaimedLesson
    ? text
        .replace(/#([\p{L}\p{N}_]+)/gu, (_tag, word: string) =>
          /^(?:tutorials?|شرح|تعليم)$/iu.test(word) ? word : " ",
        )
        .replace(/https?:\/\/\S+/g, " ")
    : prose;
  const explicitLesson = teachingText.split(/[.!?؟\n;]+/u).some((sentence) => {
    const firstPersonProcess =
      /\bhow (?:i|we) (?:film|shoot|edit|animate|color grade|colour grade|light)\b/i.test(sentence);
    const explainedProcess =
      craftContext &&
      (/\b(?:photographer|filmmaker|editor|cinematographer) explains?\b/i.test(sentence) ||
        /\b(?:i(?:['’]m| am)|we(?:['’]re| are)) (?:sharing|showing|explaining) (?:my|our) (?:secrets|process|workflow|techniques|tips|settings)\b/i.test(
          sentence,
        ));
    const teaching =
      /\b(?:tutorials?|how[ -]to|guides?|step[ -]by[ -]step|explained|breakdown|learn|lessons?|tips|behind the scenes|before and after)\b|(?<!\p{L})(?:و|ف|ب|ل|ال|بال|وال|لل)?(?:شرح|طريقة|طريقه|كيف|تعلم|درس|خطوات|تعليم|كواليس)(?!\p{L})/iu.test(
        sentence,
      ) ||
      ((craftContext || namedCraft) && /\btip\b/i.test(sentence)) ||
      firstPersonProcess ||
      explainedProcess;
    if (!teaching) return false;
    const solicitation =
      (explainedProcess && /\b(?:comment|dm|message|reply|request)\b/i.test(sentence)) ||
      /\b(?:comment|dm|message|reply|ask|request|want|need|should i|shall i|would you|do you)\b[^.!?\n]{0,120}\b(?:tutorial|guide|lesson|breakdown|tips?|how[ -]to|how (?:i|we))\b/i.test(
        sentence,
      ) ||
      /(?:تبون|تبغون|تبو|يبغى|يبغي|تريدون|تريد|بدكم|عايزين|اكتب|علق|ارسل|أرسل|اطلب)[^.!?\n]{0,100}(?:شرح|طريقة|طريقه|تعليم)/u.test(
        sentence,
      );
    const elsewhere =
      ((firstPersonProcess || explainedProcess) &&
        /\b(?:coming soon|coming tomorrow|available soon|next week|coming next|tomorrow)\b/i.test(
          sentence,
        )) ||
      /\b(?:tutorials?|guides?|lessons?|breakdown|tips?)\b[^.!?\n]{0,65}\b(?:coming|soon|tomorrow|next week|later|on (?:my|our) (?:page|channel)|link in bio|available on)\b/i.test(
        sentence,
      ) ||
      /\b(?:will|gonna|going to|planning to)\b[^.!?\n]{0,80}\b(?:tutorial|teach|explain|breakdown)\b/i.test(
        sentence,
      ) ||
      /\b(?:followed|watched|used|thanks for|credit to)\b[^.!?\n]{0,70}\b(?:tutorial|guide|lesson)\b/i.test(
        sentence,
      ) ||
      /(?:الشرح|شرح|الطريقة|الطريقه)[^.!?\n]{0,60}(?:قريب|بكرة|بكره|لاحق|بايو|البايو|قناتي)/u.test(
        sentence,
      ) ||
      /(?:راح|سوف|بعدين)[^.!?\n]{0,50}(?:اشرح|أشرح|شرح)/u.test(sentence);
    const denied =
      /\b(?:no|not a|without a)\s+(?:tutorial|guide|lesson|tip)\b/i.test(sentence) ||
      /(?:مو|ليس|بدون)\s+(?:شرح|درس)/u.test(sentence);
    return !solicitation && !elsewhere && !denied;
  });
  if (explicitLesson) return true;
  // A narrated shot list can teach without saying "tutorial": require an instructional purpose,
  // at least three distinct shot types and an explanation, not merely a finished montage's shot tags.
  const shotTypes = [
    "wide shot",
    "low angle",
    "close up",
    "high angle",
    "profile shot",
    "medium shot",
    "over the shoulder",
  ];
  const shotLesson =
    /\b(?:shot list|list of shots?|(?:simple|quick|easy) list to make your videos?|make your videos? (?:feel |look )?more cinematic)\b/i.test(
      normalized,
    ) &&
    shotTypes.filter((shot) => mentions(normalized, shot)).length >= 3 &&
    /\b(?:this|it) (?:sets|shows|creates|helps|adds|makes|establishes|reveals|directs|frames|captures|emphasizes)\b/i.test(
      normalized,
    ) &&
    !/\b(?:coming soon|coming tomorrow|available soon|tutorial tomorrow|lesson tomorrow|guide tomorrow)\b/i.test(
      normalized,
    );
  return shotLesson;
}

/** Whole words/phrases; a few exact category+creative hashtag compounds are expanded below, never arbitrary substrings. */
const has = mentions;
const TAG_ENDINGS = [
  "edit",
  "edits",
  "editing",
  "cinematic",
  "videography",
  "filmmaking",
  "broll",
  "transition",
  "transitions",
  "montage",
  "photography",
];

function expanded(genreId: string, text: string): string {
  const subjects = CATEGORY_PROFILES[genreId]?.subjects ?? [];
  return text.replace(/#([\p{L}\p{N}_]+)/gu, (tag, raw: string) => {
    const flat = normalizeTerm(raw.replace(/_/g, " ")).replace(/ /g, "");
    for (const s of subjects)
      for (const ending of TAG_ENDINGS) {
        const subject = normalizeTerm(s).replace(/ /g, "");
        if (
          [subject, `${subject}s`].some((word) => flat === word + ending || flat === ending + word)
        )
          return `${s} ${ending}`;
      }
    return tag;
  });
}

export type CategoryExclusion =
  | "empty-prose"
  | "full-feature-upload"
  | "background-ambience"
  | "equipment"
  | "image-prompt"
  | "prompt-bait"
  | "sales"
  | "ordinary-content";

export interface CategoryCreativeEvidence {
  category: boolean;
  creative: boolean;
  eligible: boolean;
  subjects: string[];
  techniques: string[];
  /** Specific craft cues only; generic AMV/cinematic/edit labels never establish a named technique. */
  namedTechniques: string[];
  teaching: boolean;
  /** Promotional, ordinary-content or empty-tag noise that a personal preference must not promote. */
  excluded: boolean;
  /** Keep missing text distinct from substantive exclusions when independent visual evidence exists. */
  exclusions: CategoryExclusion[];
  /** A creative project described in prose; an #edit hashtag alone cannot supply this evidence. */
  project: boolean;
  score: number;
}

/** A subject is mandatory; generic popularity/POV/ASMR/reel tags alone are not evidence of a creative example.
 * Product catalogues and equipment shopping retain no creative flag, including for generic lesson tutorials. */
export function categoryCreativeEvidence(genreId: string, text: string): CategoryCreativeEvidence {
  text = captionEvidenceText(text);
  const profile = CATEGORY_PROFILES[genreId];
  const normalized = normalizeTerm(expanded(genreId, text));
  const craftText = appliedCraftText(text);
  const craftNormalized = normalizeTerm(expanded(genreId, craftText));
  // "Time travel" names an effect, not a destination; other real travel words can still establish the category.
  const subjectText =
    genreId === "travel" ? normalized.replace(/\btime travel\b/g, " ") : normalized;
  const subjects = [
    ...new Set((profile?.subjects ?? []).filter((s) => has(subjectText, normalizeTerm(s)))),
  ];
  // "Commercial coffee machine" is an equipment class, not a filmed commercial.
  // Other explicit ad/craft words can still establish a real creative example.
  const commercialMachine = /\bcommercial\s+(?:coffee|espresso)\s+machines?\b/i.test(text);
  const techniques = FORMS.filter(({ name, aliases }) =>
    aliases.some(
      (a) =>
        !(name === "creative commercial" && a === "commercial" && commercialMachine) &&
        has(craftNormalized, a),
    ),
  ).map((a) => a.name);
  const prose = text.replace(/#[\p{L}\p{N}_]+/gu, "").replace(/https?:\/\/\S+/g, "");
  const craftProse = craftText.replace(/#[\p{L}\p{N}_]+/gu, "").replace(/https?:\/\/\S+/g, "");
  const equipment =
    /\b(food processors?|prep tables?|work tables?|stainless steel kitchen|air fryers?)\b/i.test(
      text,
    );
  const sales =
    /\b(price list|for sale|buy now|shop now|discount code|coupon code|best deals|grocery deals|affiliate links?|prompt pack|preset pack|photography packages?|commercial (?:food )?prices)\b/i.test(
      text,
    ) || /للبيع|اشتر الآن|اشتري الان|كود خصم|عروض البقالة|قائمة أسعار/.test(text);
  const promptBait =
    /\b(?:comment|dm|message|reply)\b[^.!?\n]{0,120}\b(?:prompt|preset|pack)\b/i.test(text) ||
    /\b(?:get|grab|download|buy)\b[^.!?\n]{0,60}\b(?:ai prompts?|prompt packs?)\b/i.test(text) ||
    /(?:اكتب|علق|أرسل|ارسل)[^.!?\n]{0,100}(?:برومبت|برومبتات)/.test(text);
  const substantive = techniques.some((t) => !PROJECT.has(t) && !CONTEXTUAL.has(t));
  const teaching = hasTeachingEvidence(craftText);
  const title = text.split(/\r?\n/, 1)[0];
  const fullFeatureUpload =
    /\b(?:full(?:[ -]length)?|complete)[ -]+(?:movies?|feature(?:[ -]films?)?)\b|(?:فيلم|الفيلم)\s+كامل/iu.test(
      title,
    ) && !hasTeachingEvidence(title);
  // A long passive-listening upload may contain real B-roll, but its advertised purpose is
  // background playback. Require duration, ambience and use together; neither length nor
  // ambient sound alone disqualifies an edit, and real sound-design/editing lessons stay useful.
  const longPlayback =
    /\b(?:[1-9]\d*(?:\.\d+)?|one|two|three|four|eight|ten|twelve)[ -]*(?:hours?|hrs?)\b|\b(?:[6-9]\d|\d{3,})[ -]*(?:minutes?|mins?)\b/i.test(
      title,
    );
  const ambience =
    /\b(?:ambience|ambiance|ambient sounds?|relaxing (?:jazz )?music|jazz music|lo[ -]?fi|white noise)\b/i.test(
      title,
    );
  const passiveUse =
    /\bbackground (?:music|sounds?|playback)\b|\b(?:play|playing|listen|listening)\b[^.!?\n]{0,40}\bthe background\b|\bfor (?:work|study|studying|sleep|sleeping|meditation|relaxation|focus)\b/i.test(
      prose,
    );
  const backgroundAmbience = longPlayback && ambience && passiveUse && !teaching;
  const visualContext =
    /\b(video|film|camera|photography|photograph|composition|shoot|shooting)\b/i.test(craftProse) ||
    /تصوير|لقط/.test(craftProse);
  const teachesEditing =
    teaching &&
    CREATIVE.editing.some((word) => has(normalizeTerm(craftProse), normalizeTerm(word)));
  const contextual =
    (techniques.includes("shot planning") && visualContext) ||
    (techniques.includes("lighting") && visualContext) ||
    (techniques.includes("editing") && (FAN_EDIT_GENRES.has(genreId) || teachesEditing));
  // #edit on coaching, recipes, uncut gameplay or a whole episode is not evidence of an edit breakdown.
  const ordinaryContent =
    /\b(full episode|full match|uncut gameplay|full gameplay|football (?:training|coaching)|soccer (?:training|coaching)|workout routine|fitness advice|build muscle|fat loss|cooking recipe|espresso extraction|build tutorial|perfume store|fragrance store)\b/i.test(
      prose,
    );
  const imagePrompt =
    /\b(?:foreground|background)\s*:/i.test(prose) &&
    /\b(?:realistic|photorealistic|selfie)\s+(?:\w+\s+){0,3}(?:photograph|image)\b/i.test(prose) &&
    !teaching;
  const exclusions: CategoryExclusion[] = [];
  if (!/\p{L}/u.test(prose)) exclusions.push("empty-prose");
  if (fullFeatureUpload) exclusions.push("full-feature-upload");
  if (backgroundAmbience) exclusions.push("background-ambience");
  if (equipment) exclusions.push("equipment");
  if (imagePrompt) exclusions.push("image-prompt");
  if (promptBait && !(teaching && substantive)) exclusions.push("prompt-bait");
  if (sales && !(teaching && substantive)) exclusions.push("sales");
  if (ordinaryContent && !substantive) exclusions.push("ordinary-content");
  const excluded = exclusions.length > 0;
  const creative =
    !excluded &&
    techniques.length > 0 &&
    (substantive || techniques.some((t) => PROJECT.has(t)) || contextual);
  const category = subjects.length > 0;
  const proseNormalized = normalizeTerm(craftProse);
  const project =
    creative &&
    (describedEditProject(genreId, craftText) ||
      (techniques.includes("creative commercial") &&
        CREATIVE["creative commercial"].some((alias) =>
          has(proseNormalized, normalizeTerm(alias)),
        )) ||
      ["short film", "highlight film", "lookbook"].some((alias) => has(proseNormalized, alias)) ||
      (CREATIVE.cinematic.some((alias) => has(proseNormalized, normalizeTerm(alias))) &&
        /\b(?:film|video|reel|edit)\b|(?:فيلم|فيديو|ايديت|إيديت)/iu.test(craftProse)));
  return {
    category,
    creative,
    eligible: category && creative,
    subjects,
    techniques: excluded ? [] : techniques,
    namedTechniques: excluded
      ? []
      : techniques.filter(
          (name) =>
            (!PROJECT.has(name) && !CONTEXTUAL.has(name) && name !== "transitions") ||
            (name === "lighting" && visualContext),
        ),
    teaching: !excluded && teaching,
    excluded,
    exclusions,
    project,
    // Even several generic project labels cannot outrank one named craft through popularity.
    score: creative ? (substantive ? 20 : 4) + Math.min(techniques.length, 4) * 2 : 0,
  };
}

/** Canonical video links only. Duplicate query hits cannot increase rank. Caption specificity comes before views;
 * each known creator gets one place before another gets a second, at most three posts per creator. */
export function rankCategoryVideos(
  genreId: string,
  videos: readonly TopVideo[],
  max = 50,
): TopVideo[] {
  const unique = new Map<string, { video: TopVideo; score: number; index: number }>();
  for (const v of videos) {
    let u: URL;
    try {
      u = new URL(v.url);
    } catch {
      continue;
    }
    const platform = platformForHost(u.hostname);
    if (u.protocol !== "https:" || !platform || !isVideoUrl(platform, u)) continue;
    const url = canonicalUrl(platform, u);
    const evidence = categoryCreativeEvidence(genreId, `${v.title}\n${v.snippet ?? ""}`);
    if (!evidence.eligible) continue;
    const video: TopVideo = {
      ...v,
      url,
      evidence: { basis: "metadata", subjects: evidence.subjects, techniques: evidence.techniques },
    };
    const previous = unique.get(url);
    // Richer text can replace the first hit; seeing the identical hit again has no effect.
    if (
      !previous ||
      evidence.score > previous.score ||
      (evidence.score === previous.score &&
        (v.snippet?.length ?? 0) > (previous.video.snippet?.length ?? 0))
    )
      unique.set(url, { video, score: evidence.score, index: previous?.index ?? unique.size });
  }
  const ranked = [...unique.values()].sort(
    (a, b) =>
      b.score - a.score || (b.video.views ?? -1) - (a.video.views ?? -1) || a.index - b.index,
  );
  const out: TopVideo[] = [];
  const counts = new Map<string, number>();
  const creator = (v: TopVideo) => {
    const u = new URL(v.url);
    const handle = u.pathname.match(/^\/@([^/]+)\//)?.[1] ?? v.creator?.trim().replace(/^@/, "");
    return handle ? `${platformForHost(u.hostname)}:${handle.toLowerCase()}` : v.url;
  };
  for (let round = 0; round < 3 && out.length < max; round++)
    for (const row of ranked) {
      if (out.length >= max) break;
      const key = creator(row.video);
      if ((counts.get(key) ?? 0) !== round || out.includes(row.video)) continue;
      out.push(row.video);
      counts.set(key, round + 1);
    }
  return out;
}
