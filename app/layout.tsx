import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import AppShell from "@/components/shell/AppShell";
import RegisterSW from "@/components/pwa/RegisterSW";
import { basePath, withBasePath } from "@/lib/basePath";
import "./globals.css";

// Training: Baloo Bhaijaan 2 + Pixelify Sans. Social: IBM Plex Sans Arabic (master plan "Tech stack").
const FONTS_CSS =
  "https://fonts.googleapis.com/css2?family=Baloo+Bhaijaan+2:wght@400;600;800&family=Pixelify+Sans:wght@400;700&family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap";

/**
 * Static export: every page ships with `data-world="training"`, so on a direct load of a Social route this
 * sets the attribute before first paint (the shell keeps it in sync afterwards) to avoid a pixel-look flash.
 */
const WORLD_BOOT = `(function(){try{var b=${JSON.stringify(basePath())};var p=location.pathname;if(b&&p.indexOf(b)===0)p=p.slice(b.length);document.documentElement.dataset.world=/^\\/social(\\/|$)/.test(p)?"social":"training"}catch(e){}})()`;

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
  themeColor: "#0d141d",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html
      lang="ar"
      dir="rtl"
      data-world="training"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <head>
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
