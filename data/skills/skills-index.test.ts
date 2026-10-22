import { expect, it } from "vitest";
import { skills } from "@/data";
import workerCopy from "@/workers/scout/src/categories/skills.json";

/**
 * The Worker's copy of the skill list (planning/tools/19-category-trends.md §3). The lessons' AI may link only these
 * ids. The Worker can't bundle the app's packs (≈ 500 KB), so it keeps a copy. A new or renamed skill fails here until
 * the copy is regenerated, from the repo root:
 *   pnpm exec tsx -e "import { writeFileSync } from 'node:fs'; import { skills } from './data/index.ts'; writeFileSync('workers/scout/src/categories/skills.json', JSON.stringify(skills.map((s) => ({ id: s.id, en: s.name.en, ar: s.name.ar })), null, 2) + '\n');"
 * Parsed JSON is compared, not text: Windows checkouts turn the file's line endings into CRLF.
 */
it("the Worker's skills index is the app's skills: ids, English and Arabic names, in order", () => {
  expect(workerCopy).toEqual(skills.map((s) => ({ id: s.id, en: s.name.en, ar: s.name.ar })));
});
