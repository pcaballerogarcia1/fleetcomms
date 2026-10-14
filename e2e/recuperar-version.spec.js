// Tras publicar una versión nueva, un navegador con la anterior guardada puede
// no conseguir descargar una pantalla: la app debe ponerse al día sola.
import { test, expect } from "@playwright/test";
import { sembrar } from "./semilla.mjs";
import { entrarOficina } from "./ayudas.mjs";
test("si una pantalla no se descarga (versión vieja), la app se pone al día sola", async ({ page }) => {
  await sembrar();
  let fallos = 0;
  await page.route(/\/assets\/scheduling-[^/]+\.js$/, r => { if (fallos++ === 0) return r.abort(); return r.continue(); });
  await entrarOficina(page).catch(() => {});
  await expect(page.getByText("Abrir proyecto").first()).toBeVisible({ timeout: 30_000 });
  expect(fallos).toBeGreaterThan(1);
});
