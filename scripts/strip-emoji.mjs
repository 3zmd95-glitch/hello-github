// scripts/strip-emoji.mjs — removes a leading emoji (and its joiners / variation selectors / following space)
// from every value of the given message files. Usage: node scripts/strip-emoji.mjs messages/social.ar.json …
import { readFileSync, writeFileSync } from "node:fs";

const LEAD =
  /^(?:(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:️|‍(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}))*\s*)+/u;
// Keys the Training world renders (the skill sheet and the map read social.bridge.*): their emoji stay.
const KEEP = new Set([
  "social.bridge.inCalendar",
  "social.bridge.planVideo",
  "social.bridge.posted",
]);
let total = 0;
for (const file of process.argv.slice(2)) {
  const json = JSON.parse(readFileSync(file, "utf8"));
  let n = 0;
  for (const [k, v] of Object.entries(json)) {
    if (typeof v !== "string" || KEEP.has(k)) continue;
    const out = v.replace(LEAD, "");
    if (out !== v) {
      json[k] = out;
      n++;
    }
  }
  writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  console.log(`${file}: ${n} values`);
  total += n;
}
console.log(`total ${total}`);
