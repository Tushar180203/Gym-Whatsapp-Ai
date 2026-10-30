import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig({ esbuild: { jsx: "automatic" }, server: { fs: { allow: [fileURLToPath(new URL("../../../", import.meta.url))] } } });
