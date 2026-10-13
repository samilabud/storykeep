import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // The PDF library is ESM-only and loads font tools at run time. Leave it
  // out of the bundle and let Node load it directly.
  serverExternalPackages: ["@react-pdf/renderer"],
  // The PDF fonts are read from disk at run time. Tell the build to ship
  // them with the export route (needed on serverless hosts).
  outputFileTracingIncludes: {
    "/api/stories/[id]/export": ["./src/export/fonts/*.ttf"],
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
