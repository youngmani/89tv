import type { NextConfig } from "next";

// Set BASE_PATH when hosting under a sub-path (e.g. GitHub Pages project sites).
const basePath = process.env.BASE_PATH || "";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  basePath: basePath || undefined,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

export default nextConfig;
