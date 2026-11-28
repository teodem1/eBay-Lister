import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Same "@/" alias as tsconfig.json, so route tests can load route files.
export default defineConfig({
  resolve: { alias: { "@/": fileURLToPath(new URL("./src/", import.meta.url)) } },
});
