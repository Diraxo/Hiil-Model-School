import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    watch: {
      // .pw-scratch holds the headless Chromium profile used for browser QA — its Cookies/
      // Network files get locked by the running browser and crash Vite's fs watcher (EBUSY)
      // if it isn't excluded. Dev-tooling only, no effect on production build.
      ignored: ["**/.pw-scratch/**"],
    },
  },
});
