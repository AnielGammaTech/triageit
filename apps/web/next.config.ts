import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appDir, "../..");

const nextConfig: NextConfig = {
  transpilePackages: ["@triageit/shared"],
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  webpack: (config) => {
    // Node.js ESM requires .js extensions in imports, but webpack needs
    // to resolve .js → .ts for the shared package's TypeScript source
    config.resolve = {
      ...config.resolve,
      extensionAlias: {
        ...config.resolve?.extensionAlias,
        ".js": [".ts", ".tsx", ".js", ".jsx"],
      },
    };
    return config;
  },
};

export default nextConfig;
