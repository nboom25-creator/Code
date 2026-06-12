import { defineConfig } from "vite";
import path from "node:path";

const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the shared module directly to its TypeScript source.
      "@wow/shared": path.resolve(root, "../shared/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    // Allow Vite to read the shared module that lives outside the client root.
    fs: { allow: [path.resolve(root, "..")] },
  },
});
