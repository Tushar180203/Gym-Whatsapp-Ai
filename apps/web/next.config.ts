import type { NextConfig } from "next";
const config: NextConfig = {
  allowedDevOrigins: process.env.APP_ORIGIN ? [new URL(process.env.APP_ORIGIN).hostname] : [],
  experimental: { externalDir: true }, serverExternalPackages: ["pg"],
  webpack(config) { config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] }; return config; }
};
export default config;
