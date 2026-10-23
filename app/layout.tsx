import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import AppShell from "@/components/shell/AppShell";
import RegisterSW from "@/components/pwa/RegisterSW";
import { TRAINING_BG } from "@/lib/appearance";
import { basePath, withBasePath } from "@/lib/basePath";
import "./globals.css";

// Training: Baloo Bhaijaan 2 + Pixelify Sans. Social: Vazirmatn (round 35).
const FONTS_CSS =
  "https://fonts.googleapis.com/css2?family=Baloo+Bhaijaan+2:wght@400;600;800&family=Pixelify+Sans:wght@400;700&family=Vazirmatn:wght@400;500;600;700&display=swap";

/**
 * Static export: every page ships with `data-world="training"` and `data-scheme="light"`, so on a direct load of a
 * Social route this sets both before first paint (the shell keeps them in sync afterwards): no pixel-look flash,
 * and no light flash for an owner who picked Dark. The scheme is the saved Appearance setting (the store's
 * `3z-prod-v1` entry, lib/appearance `resolveScheme`): light unless Dark, or System with a dark phone. The
 * `theme-color` tag is left to the shell: a change before hydration makes React render a second tag.
 */
const WORLD_BOOT = `(function(){try{var b=${JSON.stringify(basePath())};var p=location.pathname;if(b&&p.indexOf(b)===0)p=p.slice(b.length);var w=p==="/social"||p.indexOf("/social/")===0?"social":"training";var a="light";try{var s=JSON.parse(localStorage.getItem("3z-prod-v1")||"null");a=(s&&s.state&&s.state.settings&&s.state.settings.appearance)||"light"}catch(e){}var d=a==="dark"||(a==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);var h=document.documentElement;h.dataset.world=w;h.dataset.scheme=d?"dark":"light"}catch(e){}})()`;

/**
 * ▶ Watch here (round 32): the only frames the dashboard may show are the three players (lib/embed), and no
 * plugin or `<base>` can be injected. GitHub Pages sends no headers of ours, so it is a meta tag, and only
 * these directives: no `script-src` / `default-src` (the inline boot script above and the fonts must keep
 * working) and never COEP (Instagram's embed is CORP same-origin).
 */
const CSP = [
  "frame-src https://www.youtube-nocookie.com https://www.youtube.com https://www.tiktok.com https://www.instagram.com",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

export const metadata: Metadata = {
  title: "3z Prod · عز ينتج",
  description: "لوحة تدريب 3z Prod: مهارة جديدة كل يوم.",
  applicationName: "3z Prod",
  appleWebApp: { capable: true, title: "3z", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // One tag for both worlds: the shell sets Social's page color on it once mounted (lib/appearance).
  themeColor: TRAINING_BG,
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html
      lang="ar"
      dir="rtl"
      data-world="training"
      data-scheme="light"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <head>
        <meta httpEquiv="Content-Security-Policy" content={CSP} />
        <script dangerouslySetInnerHTML={{ __html: WORLD_BOOT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={FONTS_CSS} />
        <link rel="apple-touch-icon" href={withBasePath("/icons/apple-touch-icon.png")} />
        <link
          rel="icon"
          type="image/png"
          sizes="192x192"
          href={withBasePath("/icons/icon-192.png")}
        />
      </head>
      <body className="min-h-full">
        <AppShell>{children}</AppShell>
        <RegisterSW />
      </body>
    </html>
  );
}
