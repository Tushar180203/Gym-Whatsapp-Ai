import type { NextConfig } from "next";
const config: NextConfig = {
  experimental: { externalDir: true }, serverExternalPackages: ["pg"],
  webpack(config) { config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] }; return config; }
};
export default config;
