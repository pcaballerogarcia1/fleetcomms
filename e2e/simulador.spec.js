// Rutas de puntos: el simulador «qué pasaría si» con un trabajador de más
// dice dónde lo pone y cuánto cuesta frente al escenario actual.
import { test, expect } from "@playwright/test";
import { sembrar, escribir, leer, ORG } from "./semilla.mjs";
import { vigilarErrores, entrarOficina } from "./ayudas.mjs";

test.beforeEach(async () => {
  await sembrar();
  const markers = Array.from({ length: 24 }, (_, i) => ({ lat: 40.41 + (i % 6) * 0.004, lng: -3.71 + Math.floor(i / 6) * 0.005, nombre: `Punto ${i + 1}`, barrio: i < 12 ? "Centro" : "Retiro" }));
  await escribir("planning_layers/capa-e2e", { projectId: "p-puntos", org_id: ORG, id: "capa-e2e", name: "Contenedores", visible: true, totalMarkers: markers.length, markers });
  // con costes, para que el simulador los enseñe
  const p = await leer("scheduling_projects/p-puntos");
  await escribir("scheduling_projects/p-puntos", { ...p, scheduling: { constraints: { costeHora: 22, costeKm: 0.9 } } });
});

test("simular un trabajador de más enseña dónde va y el coste", async ({ page }) => {
  const errores = vigilarErrores(page);
  await entrarOficina(page);
  await page.getByText("Abrir proyecto").first().click();
  await page.waitForURL(/\/planning/);
  await page.getByRole("button", { name: "Rutas", exact: true }).first().click();
  await page.getByRole("button", { name: /Importar desde Planificación/ }).first().click();
  await page.getByRole("button", { name: /Generar escenario/ }).first().click();
  await expect(page.getByRole("button", { name: /Excel/ })).toBeVisible({ timeout: 90_000 });
  await expect.poll(async () => (await leer("scheduling_scenarios/p-puntos"))?.v || null, { timeout: 60_000 }).not.toBeNull();
  await expect(page.getByRole("button", { name: /Generando/ })).toHaveCount(0, { timeout: 60_000 });

  await page.getByRole("button", { name: /Simulador/ }).first().click();
  await page.getByRole("button", { name: "Quitar vehículo" }).click(); // de +1 a 0
  await page.getByRole("button", { name: "Añadir trabajador" }).click();
  await page.getByRole("button", { name: "Simular", exact: true }).click();
  await expect(page.getByText(/Trabajadores de más:/)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("Coste", { exact: true })).toBeVisible();
  await expect(page.getByText("Horas pagadas")).toBeVisible();
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/s1-simulador.png` });
  expect(errores.filter(e => !/osrm|router\.project-osrm|Failed to load resource|ERR_/i.test(e))).toEqual([]);
});
