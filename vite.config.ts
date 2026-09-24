import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { lingui } from "@lingui/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import Icons from "unplugin-icons/vite";
import { cardImagesPlugin, localScryfallPlugin, createProxy } from "./tools/local-runtime";

const proxy = createProxy();
export default defineConfig({
  plugins: [
    react({ babel: { plugins: ["@lingui/babel-plugin-lingui-macro"] } }),
    lingui(), tailwindcss(), Icons({ compiler: "raw" }),
    cardImagesPlugin(), localScryfallPlugin(),
  ],
  build: { rollupOptions: { input: { main: fileURLToPath(new URL("./index.html", import.meta.url)) } } },
  resolve: { alias: { "@": fileURLToPath(new URL("./ui", import.meta.url)) } },
  define: { __APP_VERSION__: JSON.stringify("phase-mana-0.1.0") },
  server: { host: "127.0.0.1", port: 1420, strictPort: false, proxy, watch: { ignored: ["**/target/**", "**/card-images/**", "**/data/**", "**/.phase-mana/**", "**/desktop/stage/**", "**/release/**"] } },
  preview: { host: "127.0.0.1", port: 1420, strictPort: false, proxy },
});
