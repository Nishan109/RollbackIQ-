import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  experimental: { turbopackFileSystemCacheForDev: false },
  transpilePackages: ["@rollbackiq/scanner-core"],
  serverExternalPackages: ["libpg-query", "typescript", "@mrleebo/prisma-ast"],
};

export default config;
