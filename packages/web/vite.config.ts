import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        // Use IPv4 loopback so this matches the backend default bind (HOST=127.0.0.1).
        // "localhost" often resolves to ::1 first; nothing is listening there → proxy 5xx.
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
});
