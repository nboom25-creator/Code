import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// App build only. Test configuration lives in `vitest.config.ts` — keeping them apart
// avoids mixing the React plugin (typed against Vite's Rolldown build) into Vitest's
// own nested Vite, and it keeps the headless test path free of app plugins.
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
});
