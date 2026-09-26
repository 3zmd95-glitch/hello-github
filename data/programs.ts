import type { Program } from "@/lib/domain";

/**
 * Programs = islands on the map. Two archipelagos: Craft (videography) and Tools (apps).
 * Sections for craft programs come from master plan round 21; app sections are the round 10 drafts.
 */

const s = (id: string, ar: string, en: string) => ({ id, name: { ar, en } });

/* ---------- Tools: DaVinci Resolve (home island) ---------- */

export const davinci: Program = {
  id: "davinci",
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
    kind: "app",
    name: { ar: "سير العمل", en: "Workflow" },
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

/** Tools archipelago: DaVinci first (home island), then the other 12 apps. */
export const appPrograms: Program[] = [davinci, ...otherAppPrograms];

/** All programs: craft first, then tools. */
export const programs: Program[] = [...craftPrograms, ...appPrograms];
