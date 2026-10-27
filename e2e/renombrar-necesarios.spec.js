// Rutas: los vehículos que añade el cálculo («Vehículo necesario N») se
// pueden renombrar y el nombre se queda al volver a generar; los de la
// organización no tienen lápiz.
import { test, expect } from "@playwright/test";
import { sembrar, escribir, leer, ORG } from "./semilla.mjs";
import { vigilarErrores, entrarOficina } from "./ayudas.mjs";

test.beforeEach(async () => {
  await sembrar();
  const markers = Array.from({ length: 24 }, (_, i) => ({ lat: 40.41 + (i % 6) * 0.004, lng: -3.71 + Math.floor(i / 6) * 0.005, nombre: `Punto ${i + 1}` }));
  await escribir("planning_layers/capa-e2e", { projectId: "p-puntos", org_id: ORG, id: "capa-e2e", name: "Contenedores", visible: true, totalMarkers: markers.length, markers });
  // jornada corta, pocas paradas por vehículo y un solo día: hacen falta vehículos de más
  const p = await leer("scheduling_projects/p-puntos");
  await escribir("scheduling_projects/p-puntos", { ...p, scheduling: { constraints: { maxStops: 4, maxDays: 1, maxShiftMin: 90, vehiculoNecesarioMaxMin: 90, startMin: 360, endMin: 450 } } });
});

async function generar(page) {
  await page.getByRole("button", { name: /Generar escenario/ }).first().click();
  await expect(page.getByRole("button", { name: /Excel/ })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("button", { name: /Generando/ })).toHaveCount(0, { timeout: 90_000 });
}

test("renombrar un vehículo necesario y que se quede al volver a generar", async ({ page }) => {
  const errores = vigilarErrores(page);
  await entrarOficina(page);
  await page.getByText("Abrir proyecto").first().click();
  await page.waitForURL(/\/planning/);
  await page.getByRole("button", { name: "Rutas", exact: true }).first().click();
  await page.getByRole("button", { name: /Importar desde Planificación/ }).first().click();
  await generar(page);

  await expect(page.getByRole("button", { name: /Cambiar el nombre de Camión/ })).toHaveCount(0); // los de la organización, no
  await page.getByRole("button", { name: "Cambiar el nombre de Vehículo necesario 1" }).click();
  await page.getByLabel("Nuevo nombre de Vehículo necesario 1").fill("4521 KLM");
  await page.getByLabel("Nuevo nombre de Vehículo necesario 1").press("Enter");
  await expect(page.getByText("4521 KLM").first()).toBeVisible();
  await expect.poll(async () => (await leer("scheduling_projects/p-puntos"))?.scheduling?.constraints?.nombresVirtuales?.virtual_veh_1).toBe("4521 KLM");
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/n1-renombrar.png` });

  await generar(page);
  await expect(page.getByText("4521 KLM").first()).toBeVisible();
  expect(errores.filter(e => !/osrm|router\.project-osrm|Failed to load resource|ERR_/i.test(e))).toEqual([]);
});
