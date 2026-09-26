"use client";

import { useEffect } from "react";
import { withBasePath } from "@/lib/basePath";

/** Registers the app-shell service worker (production builds only, so dev reloads stay fresh). */
export default function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register(withBasePath("/sw.js"), { scope: withBasePath("/") })
      .catch(() => undefined);
  }, []);
  return null;
}
