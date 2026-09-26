import type { Program } from "@/lib/domain";
import { pillars } from "./pillars";

/**
 * Programs = islands on the map, grouped under the owner's 6 pillars (round 22).
 * `kind` stays: craft = technique/knowledge (round 21), app = a specific tool.
 * Sections for craft programs come from master plan round 21; app sections are the round 10 drafts;
 * programs added in round 22 (✚) have short draft sections to be filled later.
 */

const s = (id: string, ar: string, en: string) => ({ id, name: { ar, en } });

/* ---------- Tools: DaVinci Resolve (home island) ---------- */

export const davinci: Program = {
  id: "davinci",
  pillarId: "editing",
  kind: "app",
  name: { ar: "دافنشي ريزولف", en: "DaVinci Resolve" },
  icon: "🎬",
  color: "#e0493b",
  sections: [
    s("media", "صفحة Media", "Media"),
    s("cut", "صفحة Cut", "Cut"),
    s("edit", "صفحة Edit", "Edit"),
    s("fusion", "صفحة Fusion", "Fusion"),
    s("color", "صفحة Color", "Color"),
    s("fair", "صفحة Fairlight", "Fairlight"),
    s("deliver", "صفحة Deliver", "Deliver"),
  ],
};

/* ---------- Craft programs (round 21) ---------- */

export const craftPrograms: Program[] = [
  {
    id: "camera",
    pillarId: "capture",
    kind: "craft",
    name: { ar: "الكاميرا", en: "Camera" },
    icon: "📷",
    color: "#4f8cff",
    sections: [
      s("exposure-triangle", "مثلث التعريض", "Exposure triangle"),
      s("shutter-angle", "زاوية الغالق (قاعدة ١٨٠°)", "Shutter angle (180° rule)"),
      s("frame-rates", "معدل الفريمات والسلوموشن", "Frame rates & slow motion"),
      s("picture-profiles", "بروفايلات الصورة والـ Log", "Picture profiles & Log"),
      s("white-balance", "توازن الأبيض", "White balance"),
      s("focus", "الفوكس (يدوي، سحب، هايبرفوكال)", "Focus (manual, pulling, hyperfocal)"),
      s("lenses", "العدسات والبعد البؤري", "Lenses & focal length"),
      s("stabilization", "الثبات (باليد، جيمبل)", "Stabilization (handheld, gimbal)"),
      s("camera-movement", "حركة الكاميرا", "Camera movement"),
      s("phone-videography", "التصوير بالجوال", "Phone videography"),
    ],
  },
  {
    id: "lighting",
    pillarId: "capture",
    kind: "craft",
    name: { ar: "الإضاءة", en: "Lighting" },
    icon: "💡",
    color: "#ffc53d",
    sections: [
      s("natural-light", "الضوء الطبيعي والساعة الذهبية", "Natural light & golden hour"),
      s("harsh-sun", "شمس الظهر القوية", "Harsh midday sun"),
      s("three-point", "الإضاءة الثلاثية", "Three-point lighting"),
      s("motivated-light", "الإضاءة المبررة", "Motivated light"),
      s("practicals", "إضاءات داخل الكادر", "Practicals"),
      s("color-temperature", "حرارة اللون والجلز", "Color temperature & gels"),
      s("low-light", "الإضاءة الضعيفة والليل", "Low light & night"),
      s("interview-setups", "تجهيز المقابلات", "Interview setups"),
    ],
  },
  {
    id: "composition",
    pillarId: "capture",
    kind: "craft",
    name: { ar: "التكوين", en: "Composition" },
    icon: "🖼️",
    color: "#b07cff",
    sections: [
      s("shot-sizes", "أحجام اللقطات", "Shot sizes (WS/MS/CU)"),
      s("thirds-lines", "قاعدة الأثلاث والخطوط", "Rule of thirds & leading lines"),
      s("headroom-eyeline", "مساحة الرأس واتجاه النظر", "Headroom & eyeline"),
      s("depth-layers", "طبقات العمق", "Depth layers (FG/MG/BG)"),
      s("symmetry-framing", "التماثل والإطار داخل الإطار", "Symmetry & framing"),
      s("dutch-angle", "الزاوية المايلة", "Dutch angle"),
      s("line-180", "خط الـ ١٨٠°", "180° line"),
      s("blocking", "توزيع الحركة (بلوكنق)", "Blocking"),
    ],
  },
  {
    id: "sound",
    pillarId: "capture",
    kind: "craft",
    name: { ar: "الصوت في التصوير", en: "Sound on set" },
    icon: "🎙️",
    color: "#2fc4b2",
    sections: [
      s("lav-vs-shotgun", "مايك لاف ولا شوتقن", "Lav vs shotgun"),
      s("levels-headroom", "مستويات الصوت والهامش", "Levels & headroom"),
      s("room-tone", "صوت الغرفة", "Room tone"),
      s("wind-protection", "حماية من الهوا", "Wind protection"),
      s("sync", "المزامنة (تصفيقة / تايم كود)", "Sync (clap / timecode)"),
      s("phone-audio", "صوت الجوال", "Phone audio"),
    ],
  },
  {
    id: "story",
    pillarId: "capture",
    kind: "craft",
    name: { ar: "القصة والإخراج", en: "Story & directing" },
    icon: "🎭",
    color: "#ff7a59",
    sections: [
      s("hook-beats-cta", "هوك، أحداث، دعوة", "Hook–beats–CTA structure"),
      s("shot-lists", "قائمة اللقطات والستوريبورد", "Shot lists & storyboards"),
      s("sequencing", "ترتيب اللقطات (واسع ← متوسط ← قريب)", "Sequencing (wide → medium → close)"),
      s("b-roll", "تخطيط الـ B-roll", "B-roll planning"),
      s("coverage", "التغطية", "Coverage"),
      s("directing-interviews", "إدارة المقابلات", "Directing interviews"),
      s("pacing", "الإيقاع والسرعة", "Pacing & rhythm"),
      s("match-cut", "تخطيط الـ Match cut", "Planning a match cut"),
    ],
  },
  {
    id: "color-craft",
    pillarId: "editing",
    kind: "craft",
    name: { ar: "فن الألوان", en: "Color craft" },
    icon: "🎨",
    color: "#ff5fa2",
    sections: [
      s("color-theory", "نظرية الألوان والباليتات", "Color theory & palettes"),
      s("skin-tones", "ألوان البشرة", "Skin tones"),
      s("scopes", "قراءة السكوبات", "Reading scopes"),
      s("lut-theory", "نظرية الـ LUT", "LUT theory"),
      s("film-emulation", "محاكاة الفيلم", "Film emulation"),
      s("teal-orange", "تيل وأورنج ومتى لا", "Teal–orange and when not to"),
    ],
  },
  {
    id: "production",
    pillarId: "projects",
    kind: "craft",
    name: { ar: "سير الإنتاج", en: "Production workflow" },
    icon: "📋",
    color: "#8bc34a",
    sections: [
      s("location-scouting", "استكشاف المواقع", "Location scouting"),
      s("permits", "التصاريح (هيئة الأفلام)", "Permits (Saudi Film Commission)"),
      s("gear-checklist", "قائمة العدة", "Gear checklist"),
      s("call-sheet", "جدول التصوير (Call sheet)", "Call sheet"),
      s("data-management", "إدارة الملفات في الموقع", "Data management on set"),
      s("backups", "النسخ الاحتياطي", "Backups"),
    ],
  },
];

/* ---------- Other app programs (round 10 draft sections) ---------- */

export const otherAppPrograms: Program[] = [
  {
    id: "capcut",
    pillarId: "editing",
    kind: "app",
    name: { ar: "كاب كات", en: "CapCut" },
    icon: "✂️",
    color: "#22d3ee",
    sections: [
      s("editing-basics", "أساسيات المونتاج", "Editing basics"),
      s("text-captions", "النصوص والكابشن", "Text & captions"),
      s("effects-filters", "المؤثرات والفلاتر", "Effects & filters"),
      s("audio-beat-sync", "الصوت ومزامنة البيت", "Audio & beat sync"),
      s("keyframes-speed", "الكي فريم والسرعة", "Keyframes & speed"),
      s("templates", "القوالب", "Templates"),
      s("export", "التصدير", "Export"),
    ],
  },
  {
    id: "photoshop",
    pillarId: "design",
    kind: "app",
    name: { ar: "فوتوشوب", en: "Photoshop" },
    icon: "🖌️",
    color: "#31a8ff",
    sections: [
      s("selections-masks", "التحديد والماسكات", "Selections & masks"),
      s("layers-blending", "الطبقات والدمج", "Layers & blending"),
      s("retouching", "الريتتش", "Retouching"),
      s("color-adjustments", "الألوان والتعديلات", "Color & adjustments"),
      s("compositing", "الدمج (كومبوزيت)", "Compositing"),
      s("typography", "الخطوط", "Typography"),
      s("generative-fill", "التعبئة التوليدية", "Generative Fill"),
      s("export", "التصدير", "Export"),
    ],
  },
  {
    id: "lightroom",
    pillarId: "capture",
    kind: "app",
    name: { ar: "لايت روم", en: "Lightroom" },
    icon: "🌅",
    color: "#4fa3ff",
    sections: [
      s("organize", "التنظيم", "Organize"),
      s("light-tone", "الإضاءة والدرجات", "Light & tone"),
      s("color-mixer", "خلاط الألوان (HSL)", "Color mixer (HSL)"),
      s("masking", "الماسكات", "Masking"),
      s("presets", "البريسيتات", "Presets"),
      s("export", "التصدير", "Export"),
    ],
  },
  {
    id: "illustrator",
    pillarId: "design",
    kind: "app",
    name: { ar: "إليستريتور", en: "Illustrator" },
    icon: "✒️",
    color: "#ff9a00",
    sections: [
      s("pen-shapes", "القلم والأشكال", "Pen & shapes"),
      s("type", "النصوص", "Type"),
      s("color-swatches", "الألوان والعينات", "Color & swatches"),
      s("patterns", "النقشات", "Patterns"),
      s("effects", "المؤثرات", "Effects"),
      s("export", "التصدير", "Export"),
    ],
  },
  {
    id: "canva",
    pillarId: "design",
    kind: "app",
    name: { ar: "كانفا", en: "Canva" },
    icon: "🟣",
    color: "#7d2ae8",
    sections: [
      s("templates", "القوالب", "Templates"),
      s("brand-kit", "هوية البراند", "Brand kit"),
      s("magic-studio", "ماجك ستوديو (ذكاء اصطناعي)", "Magic Studio (AI)"),
      s("video", "الفيديو", "Video"),
      s("social-posts", "بوستات السوشال", "Social posts"),
      s("presentations", "العروض", "Presentations"),
    ],
  },
  {
    id: "higgsfield",
    pillarId: "ai",
    kind: "app",
    name: { ar: "هيقزفيلد", en: "Higgsfield" },
    icon: "🛸",
    color: "#00e0a4",
    sections: [
      s("prompting", "كتابة البرومبت", "Prompting"),
      s("camera-motion", "حركة الكاميرا", "Camera motion"),
      s("character-consistency", "ثبات الشخصية", "Character consistency"),
      s("effects", "المؤثرات", "Effects"),
      s("upscale-export", "التكبير والتصدير", "Upscale & export"),
    ],
  },
  {
    id: "claude",
    pillarId: "ai",
    kind: "app",
    name: { ar: "كلود", en: "Claude" },
    icon: "🧠",
    color: "#d97757",
    sections: [
      s("prompting", "كتابة البرومبت", "Prompting"),
      s("projects-knowledge", "المشاريع والمعرفة", "Projects & knowledge"),
      s("artifacts", "الـ Artifacts", "Artifacts"),
      s("research", "البحث", "Research"),
      s("automation", "الأتمتة", "Automation"),
    ],
  },
  {
    id: "obsidian",
    pillarId: "projects",
    kind: "app",
    name: { ar: "أوبسيديان", en: "Obsidian" },
    icon: "💎",
    color: "#7c5cff",
    sections: [
      s("notes-links", "الملاحظات والروابط", "Notes & links"),
      s("vault-structure", "ترتيب الـ Vault", "Vault structure"),
      s("templates", "القوالب", "Templates"),
      s("plugins", "الإضافات", "Plugins"),
      s("canvas", "الكانفس", "Canvas"),
      s("git-sync", "مزامنة Git", "Git sync"),
    ],
  },
  {
    id: "snapseed",
    pillarId: "capture",
    kind: "app",
    name: { ar: "سناب سيد", en: "Snapseed" },
    icon: "🌿",
    color: "#34a853",
    sections: [
      s("tune-details", "الضبط والتفاصيل", "Tune & details"),
      s("healing", "المعالجة", "Healing"),
      s("selective-edits", "التعديل الانتقائي", "Selective edits"),
      s("curves", "المنحنيات", "Curves"),
      s("looks-filters", "الستايلات والفلاتر", "Looks & filters"),
      s("double-exposure", "التعريض المزدوج", "Double exposure"),
    ],
  },
  {
    id: "dazz-cam",
    pillarId: "capture",
    kind: "app",
    name: { ar: "داز كام", en: "Dazz Cam" },
    icon: "📸",
    color: "#e8b04a",
    sections: [
      s("camera-presets", "إعدادات الكاميرات", "Camera presets"),
      s("film-looks", "ستايلات الفيلم", "Film looks"),
      s("flash-date-stamp", "الفلاش وختم التاريخ", "Flash & date stamp"),
      s("photo-dumps", "الفوتو دمب", "Photo dumps"),
    ],
  },
  {
    id: "cosmos",
    pillarId: "projects",
    kind: "app",
    name: { ar: "كوزموس", en: "Cosmos" },
    icon: "🌌",
    color: "#5b6cff",
    sections: [
      s("collecting-references", "جمع المراجع", "Collecting references"),
      s("clusters", "المجموعات", "Clusters"),
      s("moodboards", "المود بورد", "Moodboards"),
    ],
  },
  {
    id: "workflow",
    pillarId: "projects",
    kind: "app",
    // Display name narrowed so it does not overlap "Files, archive & backup"; id kept for stored progress.
    name: { ar: "قوالب وسير المشاريع", en: "Project templates & workflow" },
    icon: "🧰",
    color: "#9e9e9e",
    sections: [
      s("file-organization", "ترتيب الملفات", "File organization"),
      s("audio-download", "تحميل الصوتيات", "Audio download"),
      s("backup", "النسخ الاحتياطي", "Backup"),
      s("project-templates", "قوالب المشاريع", "Project templates"),
    ],
  },
];

/* ---------- Round 22 additions (✚), draft sections ---------- */

export const pillarPrograms: Program[] = [
  /* Capture */
  {
    id: "iphone-camera",
    pillarId: "capture",
    kind: "app",
    name: { ar: "كاميرا الآيفون", en: "iPhone Camera" },
    icon: "📱",
    color: "#a0aec0",
    sections: [
      s("photo-modes", "أوضاع التصوير", "Photo modes"),
      s("video-settings", "إعدادات الفيديو (الدقة والفريمات)", "Video settings (resolution & fps)"),
      s("cinematic-mode", "الوضع السينمائي", "Cinematic mode"),
      s("prores-log", "ProRes والـ Log", "ProRes & Log"),
      s("action-slomo", "وضع الأكشن والسلوموشن", "Action mode & slow motion"),
    ],
  },
  {
    id: "blackmagic-camera",
    pillarId: "capture",
    kind: "app",
    name: { ar: "بلاك ماجك كاميرا", en: "Blackmagic Camera" },
    icon: "🎥",
    color: "#f28c28",
    sections: [
      s("manual-controls", "التحكم اليدوي (ISO، غالق، WB)", "Manual controls (ISO, shutter, WB)"),
      s(
        "monitoring-tools",
        "أدوات المراقبة (زيبرا، فوكس بيكنق)",
        "Monitoring tools (zebras, focus peaking)",
      ),
      s("codecs-formats", "الكوديك والصيغ", "Codecs & formats"),
      s("lens-switching", "تبديل العدسات", "Lens switching"),
      s("media-sync", "حفظ ومزامنة الملفات", "Media & sync"),
    ],
  },
  {
    id: "equipment",
    pillarId: "capture",
    kind: "craft",
    name: { ar: "العدة والإكسسوارات", en: "Equipment & accessories" },
    icon: "🎒",
    color: "#6d9b74",
    sections: [
      s("phone-rigs", "ريقات الجوال", "Phone rigs"),
      s("nd-filters", "فلاتر ND", "ND filters"),
      s("mics", "المايكات", "Mics"),
      s("lights", "الإضاءات", "Lights"),
      s("tripod-gimbal", "الترايبود والجيمبل", "Tripod & gimbal"),
      s("camera-upgrade", "خطة الترقية للكاميرا", "The camera upgrade path"),
    ],
  },
  /* Editing */
  {
    id: "editing-theory",
    pillarId: "editing",
    kind: "craft",
    name: { ar: "نظرية المونتاج", en: "Editing theory" },
    icon: "🎞️",
    color: "#c56cf0",
    sections: [
      s("cuts-continuity", "القطع والاستمرارية", "Cuts & continuity"),
      s("jl-cuts", "قطع J و L", "J/L cuts"),
      s("pacing-rhythm", "الإيقاع والسرعة", "Pacing & rhythm"),
      s("montage", "المونتاج التتابعي", "Montage"),
    ],
  },
  /* Design & brand */
  {
    id: "brand-identity",
    pillarId: "design",
    kind: "craft",
    name: { ar: "الهوية والبراند", en: "Brand identity" },
    icon: "🏷️",
    color: "#ff6b6b",
    sections: [
      s("colors", "ألوان الهوية", "Colors"),
      s("logo", "الشعار", "Logo"),
      s("bio-profile", "البايو والبروفايل", "Bio & profile"),
      s("thumbnail-system", "نظام الثمبنيل", "Thumbnail system"),
    ],
  },
  /* AI */
  {
    id: "gemini",
    pillarId: "ai",
    kind: "app",
    name: { ar: "جيميناي", en: "Gemini" },
    icon: "✨",
    color: "#4285f4",
    sections: [
      s("learning-extraction", "التعلّم واستخراج المعلومة", "Learning & extraction"),
      s("research-prompts", "برومبتات البحث", "Research prompts"),
    ],
  },
  {
    id: "ai-audio",
    pillarId: "ai",
    kind: "app",
    name: { ar: "الذكاء الاصطناعي للصوت", en: "AI for audio" },
    icon: "🎧",
    color: "#26a0da",
    sections: [
      s("voice-cleanup", "تنظيف الصوت", "Voice clean-up"),
      s("music", "الموسيقى", "Music"),
    ],
  },
  /* Projects & inspiration */
  {
    id: "files-backup",
    pillarId: "projects",
    kind: "craft",
    name: { ar: "الملفات والأرشيف والنسخ", en: "Files, archive & backup" },
    icon: "🗄️",
    color: "#78909c",
    sections: [
      s("folder-structure", "ترتيب المجلدات", "Folder structure"),
      s("archive", "الأرشيف", "Archive"),
      s("storage-transfers", "التخزين ونقل الملفات", "Storage & transfers"),
      s("backup", "النسخ الاحتياطي", "Backup"),
    ],
  },
  {
    id: "download-sources",
    pillarId: "projects",
    kind: "craft",
    name: { ar: "مصادر التحميل", en: "Download sources" },
    icon: "📥",
    color: "#4db6ac",
    sections: [
      s("sound", "الصوتيات", "Sound"),
      s("fonts", "الخطوط", "Fonts"),
      s("plugins", "الإضافات", "Plugins"),
      s("stock", "الستوك", "Stock"),
    ],
  },
  {
    id: "inspiration",
    pillarId: "projects",
    kind: "craft",
    name: { ar: "مصادر الإلهام", en: "Inspiration sources" },
    icon: "🌠",
    color: "#ffb74d",
    sections: [
      s("where-to-look", "وين تدوّر", "Where to look"),
      s("saving-references", "حفظ المراجع", "Saving references"),
    ],
  },
  /* Growth & earning */
  {
    id: "analytics",
    pillarId: "growth",
    kind: "craft",
    name: { ar: "قراءة الأرقام", en: "Analytics" },
    icon: "📊",
    color: "#42a5f5",
    sections: [
      s("reading-numbers", "قراءة الأرقام", "Reading the numbers"),
      s("platform-insights", "إحصائيات المنصات", "Platform insights"),
    ],
  },
  {
    id: "publishing-strategy",
    pillarId: "growth",
    kind: "craft",
    name: { ar: "استراتيجية النشر", en: "Publishing strategy" },
    icon: "📣",
    color: "#ef5350",
    sections: [
      s("algorithms", "الخوارزميات", "Algorithms"),
      s("posting-rhythm", "إيقاع النشر", "Posting rhythm"),
      s("hooks", "الهوكات", "Hooks"),
    ],
  },
  {
    id: "monetization",
    pillarId: "growth",
    kind: "craft",
    name: { ar: "الكسب من المحتوى", en: "Monetization" },
    icon: "💰",
    color: "#fbc02d",
    sections: [
      s("affiliate", "التسويق بالعمولة", "Affiliate"),
      s("products", "المنتجات", "Products"),
      s("brand-deals", "الشراكات والميديا كِت", "Brand deals & media kit"),
    ],
  },
  {
    id: "web-newsletter",
    pillarId: "growth",
    kind: "craft",
    name: { ar: "النشرة البريدية والموقع", en: "Newsletter & website" },
    icon: "📰",
    color: "#8d6e63",
    sections: [
      s("newsletter-basics", "أساسيات النشرة البريدية", "Newsletter basics"),
      s("website-basics", "أساسيات الموقع", "Website basics"),
    ],
  },
];

/** Display order inside each pillar, following the round 22 lists (tools first, then craft). */
const ORDER = [
  // Capture
  "iphone-camera",
  "blackmagic-camera",
  "dazz-cam",
  "lightroom",
  "snapseed",
  "camera",
  "lighting",
  "composition",
  "sound",
  "story",
  "equipment",
  // Editing
  "davinci",
  "capcut",
  "editing-theory",
  "color-craft",
  // Design & brand
  "canva",
  "photoshop",
  "illustrator",
  "brand-identity",
  // AI
  "claude",
  "gemini",
  "higgsfield",
  "ai-audio",
  // Projects & inspiration
  "obsidian",
  "cosmos",
  "workflow",
  "production",
  "files-backup",
  "download-sources",
  "inspiration",
  // Growth & earning
  "analytics",
  "publishing-strategy",
  "monetization",
  "web-newsletter",
];

const pillarOrder = new Map(pillars.map((p) => [p.id, p.order]));
const rank = (id: string) => {
  const i = ORDER.indexOf(id);
  return i === -1 ? ORDER.length : i;
};

/** All programs, sorted by pillar order, then by the round 22 order inside the pillar. */
export const programs: Program[] = [
  ...craftPrograms,
  davinci,
  ...otherAppPrograms,
  ...pillarPrograms,
].sort(
  (a, b) =>
    (pillarOrder.get(a.pillarId) ?? 99) - (pillarOrder.get(b.pillarId) ?? 99) ||
    rank(a.id) - rank(b.id),
);
