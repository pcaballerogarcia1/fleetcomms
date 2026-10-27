// Cuadrante → Versiones: guardar el cuadrante con nombre, ver qué cambia
// frente al actual y volver a él.
import { test, expect } from "@playwright/test";
import { sembrar, leer, escribir, ORG } from "./semilla.mjs";
import { vigilarErrores, entrarOficina } from "./ayudas.mjs";

test("guardar una versión del cuadrante, compararla y volver a ella", async ({ page }) => {
  await sembrar();
  const hoy = new Date(), y = hoy.getFullYear(), m = hoy.getMonth() + 1;
  const id = `${ORG}_${y}_${String(m).padStart(2, "0")}`;
  await escribir(`scheduling_workers/w1`, { org_id: ORG, nombre: "Trabajador 1", apellidos: "Demo", activo: true });
  await escribir(`rostering/${id}`, { org_id: ORG, year: y, month: m, formato: 2 });
  await escribir(`rostering/${id}/trabajadores/w1`, { org_id: ORG, year: y, month: m, grid: { 1: "M", 2: "M", 3: "T" } });

  const errores = vigilarErrores(page);
  page.on("dialog", d => d.accept());
  await entrarOficina(page);
  await page.getByText("Abrir proyecto").first().click();
  await page.waitForURL(/\/planning/);
  await page.getByRole("button", { name: "Cuadrante", exact: true }).first().click();
  await page.getByRole("button", { name: "Versiones" }).click();
  const v = page.getByRole("dialog", { name: "Versiones del cuadrante" });
  await v.getByLabel("Nombre de la versión").fill("Base");
  await v.getByRole("button", { name: "Guardar versión" }).click();
  await expect(v.getByText("Base", { exact: true })).toBeVisible();

  // alguien cambia dos turnos
  await escribir(`rostering/${id}/trabajadores/w1`, { org_id: ORG, year: y, month: m, grid: { 1: "M", 2: "L", 3: "N" } });
  await v.getByRole("button", { name: "Comparar" }).click();
  await expect(v.getByText(/Cambian\s*2 turnos/)).toBeVisible();
  await expect(v.getByText("Trabajador 1 Demo")).toBeVisible();
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/c1-versiones.png` });

  await v.getByRole("button", { name: "Volver a esta" }).click();
  await expect.poll(async () => (await leer(`rostering/${id}/trabajadores/w1`))?.grid).toEqual({ 1: "M", 2: "M", 3: "T" });
  await expect(v.getByText(/Antes de volver a «Base»/)).toBeVisible();
  expect(errores.filter(e => !/Failed to load resource|ERR_/i.test(e))).toEqual([]);
});
