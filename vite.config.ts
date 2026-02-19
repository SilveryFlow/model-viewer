import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import UnoCSS from "unocss/vite";
import viteRestart from "vite-plugin-restart";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    UnoCSS(),
    viteRestart({
      restart: [".env*", "vite.config.[jt]s", "src/config/**/*", "scripts/vite/**/*"],
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "0.0.0.0",
    warmup: {
      clientFiles: [
        "./src/main.ts",
        "./src/App.vue",
        "./src/router/index.ts",
        "./src/views/HomeView.vue",
      ],
    },
  },
  css: {
    devSourcemap: true,
  },
  build: {
    rollupOptions: {
      output: {
        chunkFileNames: "js/[name]-[hash].js",
        entryFileNames: "js/[name]-[hash].js",
        assetFileNames: (assetInfo) => {
          const name = assetInfo?.names?.[0] ?? "";
          if (!name) {
            return "assets/[name]-[hash][extname]";
          }

          if (name.endsWith(".css")) {
            return "css/[name]-[hash][extname]";
          }

          if (/\.(png|jpe?g|gif|svg|webp|ico)$/i.test(name)) {
            return "images/[name]-[hash][extname]";
          }

          if (/\.(woff2?|eot|ttf|otf)$/i.test(name)) {
            return "fonts/[name]-[hash][extname]";
          }

          return "assets/[name]-[hash][extname]";
        },
      },
    },
  },
});
