import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  // Static export for GitHub Pages (Sprint 1–2). Sync and server features come in Sprint 3.
  output: "export",
  basePath,
  assetPrefix: basePath,
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
