import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import AppShell from "@/components/shell/AppShell";
import RegisterSW from "@/components/pwa/RegisterSW";
import { withBasePath } from "@/lib/basePath";
import "./globals.css";

const FONTS_CSS =
  "https://fonts.googleapis.com/css2?family=Baloo+Bhaijaan+2:wght@400;600;800&family=Pixelify+Sans:wght@400;700&display=swap";

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
    <html lang="ar" dir="rtl" data-world="training" className="h-full antialiased">
      <head>
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
