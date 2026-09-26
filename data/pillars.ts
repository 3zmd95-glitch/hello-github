import type { Pillar } from "@/lib/domain";

/**
 * The owner's 6 pillars of content creation (master plan round 22), in order.
 * Top level of the skill tree: Pillar → Program → Section → Skill. Each pillar's level comes from its programs' XP.
 */
export const pillars: Pillar[] = [
  {
    id: "capture",
    order: 1,
    name: { ar: "التصوير", en: "Capture" },
    icon: "📷",
    color: "#3fa9f5",
  },
  {
    id: "editing",
    order: 2,
    name: { ar: "المونتاج", en: "Editing" },
    icon: "✂️",
    color: "#e0493b",
  },
  {
    id: "design",
    order: 3,
    name: { ar: "التصميم والهوية", en: "Design & brand" },
    icon: "🎨",
    color: "#ff5fa2",
  },
  {
    id: "ai",
    order: 4,
    name: { ar: "الذكاء الاصطناعي", en: "AI" },
    icon: "🤖",
    color: "#00e0a4",
  },
  {
    id: "projects",
    order: 5,
    name: { ar: "إدارة المشاريع والإلهام", en: "Projects & inspiration" },
    icon: "🗂️",
    color: "#9b7bff",
  },
  {
    id: "growth",
    order: 6,
    name: { ar: "النمو والكسب", en: "Growth & earning" },
    icon: "📈",
    color: "#ffc53d",
  },
];
