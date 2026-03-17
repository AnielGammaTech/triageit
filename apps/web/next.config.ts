import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@triageit/shared"],
  output: "standalone",
};

export default nextConfig;
