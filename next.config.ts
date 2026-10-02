import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Vercel-friendly defaults — plain `next build` / `next start` */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
