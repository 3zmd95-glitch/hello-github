import type { Viewport } from "next";
import type { ReactNode } from "react";

/**
 * `color-scheme` for every Social route follows the phone (the root layout's `dark` would paint a dark canvas before
 * the CSS loads on a cold start in light mode); the Appearance setting then decides what Social draws (globals.css
 * `data-scheme`). The browser bar's `theme-color` is the root layout's one tag: the shell sets it to Social's page
 * color (lib/appearance) once mounted.
 */
export const viewport: Viewport = {
  colorScheme: "light dark",
};

export default function SocialLayout({ children }: { children: ReactNode }) {
  return children;
}
