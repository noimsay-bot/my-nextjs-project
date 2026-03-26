import path from "path";
import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir: isDevelopment ? ".next-dev" : ".next",
  outputFileTracingRoot: path.resolve(__dirname),
};

export default nextConfig;
