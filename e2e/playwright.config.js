/* global process */
// Pruebas de extremo a extremo contra los emuladores de Firebase:
//   npm run e2e      (arranca los emuladores, compila y prueba)
//   npm run medir    (con el medidor de lecturas: e2e/medir.config.js)
import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".",
  testMatch: ["*.spec.js"],
  testIgnore: ["medir.spec.js"],
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1, // comparten los mismos emuladores
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4317",
    viewport: { width: 1500, height: 900 },
    serviceWorkers: "block",
    // en local, el Chrome instalado; en la CI, el Chromium de Playwright
    ...(process.env.CI ? {} : { channel: "chrome" }),
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx vite preview --outDir dist-e2e --port 4317 --strictPort --host 127.0.0.1",
    cwd: fileURLToPath(new URL("..", import.meta.url)), // la raíz del repo (si no, arranca en e2e/)
    url: "http://127.0.0.1:4317",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
