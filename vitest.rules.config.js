// Tests de reglas de Firestore (necesitan el emulador): npm run test:rules
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["rules-tests/**/*.test.js"], environment: "node", testTimeout: 20000, hookTimeout: 60000, fileParallelism: false },
});
