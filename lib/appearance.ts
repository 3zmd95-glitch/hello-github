import type { Settings } from "./domain";

export type Scheme = "light" | "dark";

/** Social's page color per scheme (tools/18 §3.1 `--bg`): the browser bar follows it. */
export const SOCIAL_BG: Record<Scheme, string> = { light: "#f2f3f6", dark: "#0b0d10" };

/**
 * The scheme the Social world draws in for an Appearance setting: Light and Dark as chosen, System as the phone
 * says (`prefersDark`). The root layout's boot script repeats this rule in plain JS, before first paint.
 */
export function resolveScheme(appearance: Settings["appearance"], prefersDark: boolean): Scheme {
  if (appearance === "system") return prefersDark ? "dark" : "light";
  return appearance;
}
