import type { Viewport } from "next";
import type { ReactNode } from "react";

/**
 * `<meta name="theme-color">` for every Social route: the Social `--bg` per scheme (the root layout keeps Training's
 * navy). A route-level viewport, so the static HTML paints it from the first frame and Next swaps it on every
 * client navigation between the worlds. `color-scheme` likewise follows the phone here (the root layout's `dark`
 * would paint a dark canvas before the CSS loads on a cold start in light mode).
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f3f6" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0d10" },
  ],
  colorScheme: "light dark",
};

export default function SocialLayout({ children }: { children: ReactNode }) {
  return children;
}
