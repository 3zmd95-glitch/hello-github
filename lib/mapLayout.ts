import type { LText, ProgramKind } from "./domain";

/**
 * Pure helpers for the Map screen (master plan rounds 9, 10, 21, 22): island sizes, per-island themes,
 * node fill and region completion, plus the `#island=<id>` deep-link contract. No React, no store.
 */

/** DaVinci is the home island: biggest, gold "home" chip (round 10). */
export const HOME_ISLAND = "davinci";

/** Island radius bounds in logical sprite pixels (the canvas scales them up). */
export const ISLAND_MIN = 6;
export const ISLAND_MAX = 11;
export const HOME_MIN = 9;
export const HOME_MAX = 14;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const safeInt = (n: number) => (Number.isFinite(n) ? Math.floor(n) : 0);

/**
 * Island radius from the program level and its skill count: one extra pixel per 4 skills and one per level
 * above 1, capped so an island never outgrows its grid cell. The home island starts bigger and may grow further.
 */
export function islandSize(level: number, skillCount: number, home = false): number {
  const lv = Math.max(1, safeInt(level));
  const skills = Math.max(0, safeInt(skillCount));
  const grow = Math.floor(skills / 4) + (lv - 1);
  const [lo, hi] = home ? [HOME_MIN, HOME_MAX] : [ISLAND_MIN, ISLAND_MAX];
  return clamp(lo + grow, lo, hi);
}

/** Islands glow once the program reaches level 2. */
export function islandGlows(level: number): boolean {
  return safeInt(level) >= 2;
}

/** Fill height of a skill node, 0..100, from quests done (0..4). */
export function nodeFill(done: number): number {
  return clamp(safeInt(done), 0, 4) * 25;
}

/** Completion of a region (section): quests done over 4 per skill, as a whole percent. Empty → 0. */
export function regionPct(doneCounts: readonly number[]): number {
  if (doneCounts.length === 0) return 0;
  const total = doneCounts.reduce((n, d) => n + clamp(safeInt(d), 0, 4), 0);
  return Math.round((total / (doneCounts.length * 4)) * 100);
}

/** A region is done when every skill in it is mastered. Empty regions are never done. */
export function regionDone(doneCounts: readonly number[]): boolean {
  return doneCounts.length > 0 && doneCounts.every((d) => safeInt(d) >= 4);
}

/* ---------- Themes (round 10 app themes, round 21 craft themes, plus the round 22 additions) ---------- */

export interface IslandTheme {
  /** Theme line shown in the island header. */
  name: LText;
  /** Themed background tint for the region map (`--tbg`). */
  bg: string;
  /** Land color of the island sprite. */
  land: string;
}

const theme = (ar: string, en: string, bg: string, land: string): IslandTheme => ({
  name: { ar, en },
  bg,
  land,
});

export const ISLAND_THEMES: Readonly<Record<string, IslandTheme>> = {
  /* Tools (round 10) */
  davinci: theme("استوديو الأفلام", "Film studio", "#15151c", "#3b4452"),
  capcut: theme("مدينة النيون", "Neon city", "#12081f", "#2a1850"),
  photoshop: theme("المختبر الأزرق", "Blue lab", "#0b1e33", "#1d4f7a"),
  lightroom: theme("الغرفة المظلمة المشمسة", "Sunny darkroom", "#23160a", "#7a4a22"),
  illustrator: theme("الورشة البرتقالية", "Orange workshop", "#231205", "#8a4a12"),
  canva: theme("غرفة الحِرف البنفسجية", "Purple craft room", "#170f2e", "#4a2a8a"),
  higgsfield: theme("محطة الخيال العلمي", "Sci-fi station", "#061418", "#0f3a3a"),
  claude: theme("مكتبة الطين الدافية", "Warm clay library", "#21140e", "#8a4a32"),
  obsidian: theme("المكتبة البنفسجية", "Purple library", "#150d28", "#3a2a6a"),
  snapseed: theme("الحديقة الخضراء", "Green garden", "#0b1d12", "#2f7a3a"),
  "dazz-cam": theme("محل الفيلم القديم", "Retro film shop", "#1f170a", "#7a5a2a"),
  cosmos: theme("المرصد النجمي", "Starry observatory", "#08081a", "#2a2a5a"),
  workflow: theme("مخزن العدّة", "Toolshed", "#1a150e", "#5a4a32"),
  /* Craft (round 21) */
  camera: theme("موقع التصوير", "Film set", "#141a22", "#3a4656"),
  lighting: theme("السطوح المشمس", "Sunlit rooftop", "#201a0a", "#8a6a2a"),
  composition: theme("المعرض", "Gallery", "#1a1520", "#4a3a5a"),
  sound: theme("كابينة الاستوديو", "Studio booth", "#0e1a1a", "#2a5a52"),
  story: theme("مكتب الكاتب", "Writer's desk", "#1f140e", "#6a4a32"),
  "color-craft": theme("مختبر الألوان", "Paint lab", "#1e0f1a", "#6a2a52"),
  production: theme("مكتب الإنتاج", "Production office", "#121a10", "#4a6a2a"),
  /* Round 22 additions */
  "iphone-camera": theme("استوديو الجيب", "Pocket studio", "#14171c", "#4a5560"),
  "blackmagic-camera": theme("شاحنة الكاميرا", "Camera truck", "#1c1208", "#7a4a1a"),
  equipment: theme("خزنة العدة", "Gear locker", "#11191a", "#3a5a4a"),
  "editing-theory": theme("غرفة القص", "Cutting room", "#1a1020", "#5a3a6a"),
  "brand-identity": theme("محل اللافتات", "Sign shop", "#200e10", "#7a2a2a"),
  gemini: theme("مكتبة النجوم", "Star library", "#0c1424", "#2a4a8a"),
  "ai-audio": theme("مختبر الصوت", "Sound lab", "#0a1620", "#1a5a7a"),
  "files-backup": theme("قبو الأرشيف", "Archive vault", "#14181c", "#4a5a62"),
  "download-sources": theme("سوق الميناء", "Harbor market", "#0e1a18", "#2a6a5a"),
  inspiration: theme("المنارة", "Lighthouse", "#1e160a", "#8a6a2a"),
  analytics: theme("برج المراقبة", "Watchtower", "#0c1622", "#2a4a7a"),
  "publishing-strategy": theme("برج الإرسال", "Broadcast tower", "#200e0e", "#7a2a2a"),
  monetization: theme("ساحة السوق", "Market square", "#1e180a", "#8a6a1a"),
  "web-newsletter": theme("مكتب البريد", "Post office", "#1a1410", "#5a4a3a"),
};

/** Fallback themes by program kind, for programs added later without a theme row. */
export const KIND_THEMES: Readonly<Record<ProgramKind, IslandTheme>> = {
  app: theme("الورشة", "Workshop", "#161a20", "#3a4452"),
  craft: theme("الميدان", "The field", "#141c14", "#3a5a3a"),
};

/** Theme of a program, falling back to its kind's theme. */
export function themeFor(programId: string, kind: ProgramKind): IslandTheme {
  return ISLAND_THEMES[programId] ?? KIND_THEMES[kind];
}

/* ---------- Deep links: /map/#island=<programId> ---------- */

const HASH_KEY = "island";

/** `"#island=davinci"` (with or without the `#`) → `"davinci"`; anything else → null. */
export function parseIslandHash(hash: string | null | undefined): string | null {
  if (!hash) return null;
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  for (const part of raw.split("&")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq) !== HASH_KEY) continue;
    const value = decodeURIComponent(part.slice(eq + 1)).trim();
    return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value) ? value : null;
  }
  return null;
}

/** Hash for an island (`"#island=davinci"`), or `""` for the world map. */
export function islandHash(programId: string | null): string {
  return programId ? `#${HASH_KEY}=${encodeURIComponent(programId)}` : "";
}

/** Href other screens can link to: `/map/#island=davinci` (trailing slash matches the static export). */
export function mapIslandHref(programId: string | null): string {
  return `/map/${islandHash(programId)}`;
}
