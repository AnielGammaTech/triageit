import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appDir, "../..");

const nextConfig: NextConfig = {
  transpilePackages: ["@triageit/shared"],
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  webpack: (config, { isServer }) => {
    // Node.js ESM requires .js extensions in imports, but webpack needs
    // to resolve .js → .ts for the shared package's TypeScript source
    config.resolve = {
      ...config.resolve,
      extensionAlias: {
        ...config.resolve?.extensionAlias,
        ".js": [".ts", ".tsx", ".js", ".jsx"],
      },
    };
    if (!isServer) {
      // Workaround for a Next.js ClientReferenceManifestPlugin bug: when a
      // "use client" page module is scope-hoisted into a webpack
      // ConcatenatedModule that happens to get module id 0, the plugin's
      // falsy `if (concatenatedModId)` check drops it from the client
      // reference manifest, causing a runtime 500:
      //   "Could not find the module .../page.tsx#default in the React
      //    Client Manifest" (hit /command in production).
      // Disabling client-side module concatenation prevents the
      // ConcatenatedModule path entirely. Remove once fixed upstream
      // (next/dist/build/webpack/plugins/flight-manifest-plugin.js).
      config.optimization = {
        ...config.optimization,
        concatenateModules: false,
      };
    }
    return config;
  },
};

export default nextConfig;
