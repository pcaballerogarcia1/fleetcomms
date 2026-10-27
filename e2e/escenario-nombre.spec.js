// Rutas de puntos: generar, poner nombre al escenario, volver a generar (empieza
// sin nombre y el anterior queda en el historial con el suyo) y restaurarlo.
import { test, expect } from "@playwright/test";
import { sembrar, escribir, leer, ORG } from "./semilla.mjs";
import { vigilarErrores, entrarOficina } from "./ayudas.mjs";

test.beforeEach(async () => {
  await sembrar();
  const markers = Array.from({ length: 24 }, (_, i) => ({ lat: 40.41 + (i % 6) * 0.004, lng: -3.71 + Math.floor(i / 6) * 0.005, nombre: `Punto ${i + 1}`, barrio: i < 12 ? "Centro" : "Retiro" }));
  await escribir("planning_layers/capa-e2e", { projectId: "p-puntos", org_id: ORG, id: "capa-e2e", name: "Contenedores", visible: true, totalMarkers: markers.length, markers });
});

async function generar(page) {
  await page.getByRole("button", { name: /Generar escenario/ }).first().click();
  await expect(page.getByText(/asignadas/).first()).toBeVisible({ timeout: 90_000 });
  await expect.poll(async () => (await leer("scheduling_scenarios/p-puntos"))?.v || null, { timeout: 60_000 }).not.toBeNull();
}

test("el escenario se puede nombrar y el nombre viaja con cada versión", async ({ page }) => {
  const errores = vigilarErrores(page);
  page.on("dialog", d => d.accept());
  await entrarOficina(page);
  await page.getByText("Abrir proyecto").first().click();
  await page.waitForURL(/\/planning/);
  await page.getByRole("button", { name: "Rutas", exact: true }).first().click();
  await page.getByRole("button", { name: /Importar desde Planificación/ }).first().click();
  await generar(page);
  // nombrarlo
  await page.getByRole("button", { name: /Ponle nombre/ }).click();
  await page.getByLabel("Nombre del escenario").fill("Octubre · base");
  await page.getByLabel("Nombre del escenario").press("Enter");
  await expect.poll(async () => (await leer("scheduling_scenarios/p-puntos"))?.nombre).toBe("Octubre · base");
  await expect(page.getByRole("button", { name: /Octubre · base/ })).toBeVisible();
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/e1-nombre.png` });
  // volver a generar: el nuevo empieza sin nombre y el anterior queda guardado con el suyo
  const v1 = (await leer("scheduling_scenarios/p-puntos")).v;
  await generar(page);
  await expect.poll(async () => (await leer("scheduling_scenarios/p-puntos"))?.v).not.toBe(v1);
  await expect.poll(async () => { const m = await leer("scheduling_scenarios/p-puntos"); return [m?.nombre ?? null, m?.puntos?.[0]?.nombre ?? null]; }).toEqual([null, "Octubre · base"]);
  // en el historial se ve con su nombre y se restaura con él
  await page.getByTitle("Historial de versiones del escenario").click();
  await expect(page.getByText("Octubre · base")).toBeVisible();
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/e2-historial.png` });
  // compararlo con el actual
  await page.getByRole("button", { name: "Comparar", exact: true }).first().click();
  const comp = page.getByRole("dialog", { name: "Comparar escenarios" });
  await expect(comp.getByText("Paradas hechas")).toBeVisible();
  await expect(comp.getByText(/Octubre · base/)).toBeVisible();
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/e3-comparar.png` });
  await comp.getByRole("button", { name: "Cerrar" }).click();
  await page.getByRole("button", { name: "Restaurar" }).first().click();
  await expect.poll(async () => (await leer("scheduling_scenarios/p-puntos"))?.nombre, { timeout: 30_000 }).toBe("Octubre · base");
  expect(errores.filter(e => !/osrm|router\.project-osrm|Failed to load resource|ERR_/i.test(e))).toEqual([]);
});
