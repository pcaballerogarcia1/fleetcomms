// Análisis → Cierre del mes: horas de los fichajes, extra, avisos frente al
// Cuadrante, precios y cerrar el mes.
import { test, expect } from "@playwright/test";
import { sembrar, escribir, leer, ORG } from "./semilla.mjs";
import { vigilarErrores, entrarOficina } from "./ayudas.mjs";

test("cierre del mes con horas extra y avisos", async ({ page }) => {
  const { uids } = await sembrar();
  const hoy = new Date(), y = hoy.getFullYear(), m = hoy.getMonth() + 1, mm = String(m).padStart(2, "0");
  const a = (d, h, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
  await escribir("scheduling_workers/w1", { org_id: ORG, nombre: "Carlos", apellidos: "Conductor", activo: true, uid: uids.cond1 });
  await escribir(`rostering/${ORG}_${y}_${mm}`, { org_id: ORG, year: y, month: m, formato: 2 });
  await escribir(`rostering/${ORG}_${y}_${mm}/trabajadores/w1`, { org_id: ORG, year: y, month: m, grid: { 2: "M", 3: "M" } });
  // día 2: 11 h (2 extra); día 3 con turno y sin fichaje
  await escribir("fichajes/f1", { org_id: ORG, uid: uids.cond1, nombre: "Carlos", fecha: `${y}-${mm}-02`, horaEntrada: a(2, 6), horaSalida: a(2, 17), kmRecorridos: 80, estado: "cerrado" });

  const errores = vigilarErrores(page);
  page.on("dialog", d => d.accept());
  await entrarOficina(page);
  await page.getByText("Abrir proyecto").first().click();
  await page.waitForURL(/\/planning/);
  await page.getByRole("button", { name: "Análisis", exact: true }).first().click();
  await page.getByRole("button", { name: "Cierre del mes", exact: true }).click();
  const fila = page.getByRole("row", { name: /Carlos Conductor/ });
  await expect(fila).toContainText("11h00");
  await expect(fila).toContainText("2h00");
  await expect(fila).toContainText(/Con turno sin fichaje: 3/);

  await page.getByLabel("€ / hora ordinaria").fill("20");
  await page.getByLabel("€ / hora extra").fill("30");
  await page.getByLabel("€ / hora extra").blur();
  await expect(fila).toContainText("240,00 €"); // 9 h × 20 + 2 h × 30
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/a2-cierre.png` });

  await page.getByRole("button", { name: "Cerrar el mes" }).click();
  await expect(page.getByText(/Mes cerrado el/)).toBeVisible();
  await expect.poll(async () => (await leer(`rostering/${ORG}_cierre_${y}_${mm}`))?.cerrado).toBe(true);
  await page.getByRole("button", { name: "Reabrir" }).click();
  await expect(page.getByRole("button", { name: "Cerrar el mes" })).toBeVisible();
  expect(errores.filter(e => !/Failed to load resource|ERR_/i.test(e))).toEqual([]);
});
