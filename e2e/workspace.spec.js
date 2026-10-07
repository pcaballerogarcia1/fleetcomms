// Workspace de oficina contra los emuladores: entrar, recorrer los módulos
// sin errores, crear un proyecto y añadir un depot.
import { test, expect } from "@playwright/test";
import { sembrar, leer, listar } from "./semilla.mjs";
import { vigilarErrores, entrarOficina } from "./ayudas.mjs";

test.beforeEach(async () => { await sembrar(); });

test("el administrador recorre todos los módulos sin errores", async ({ page }) => {
  const errores = vigilarErrores(page);
  await entrarOficina(page);
  await expect(page.getByText("Proyecto de puntos")).toBeVisible();
  await page.getByText("Abrir proyecto").first().click();
  await page.waitForURL(/\/planning/);
  for (const [modulo, ruta] of [["Scheduling", "/scheduling"], ["Rostering", "/rostering"], ["Control", "/control"], ["Analytics", "/analytics"], ["Planning", "/planning"]]) {
    await page.getByRole("button", { name: modulo, exact: true }).first().click();
    await page.waitForURL(new RegExp(ruta));
    await page.waitForTimeout(800);
  }
  expect(errores).toEqual([]);
});

test("crear un proyecto lo guarda en la organización", async ({ page }) => {
  await entrarOficina(page);
  await page.getByText("Nuevo proyecto").first().click();
  await page.fill('input[placeholder="Nombre del proyecto *"]', "Proyecto e2e");
  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await expect.poll(async () => (await listar("scheduling_projects")).filter(p => p.nombre === "Proyecto e2e").map(p => p.org_id)).toEqual(["demo"]);
});

test("añadir un depot a mano lo guarda en el proyecto", async ({ page }) => {
  await entrarOficina(page);
  await page.getByText("Abrir proyecto").first().click();
  await page.waitForURL(/\/planning/);
  await page.getByTitle("Añadir depot manualmente").click();
  await page.getByPlaceholder("Latitud").fill("40.4168");
  await page.getByPlaceholder("Longitud").fill("-3.7038");
  await page.getByPlaceholder("Nombre (opcional)").fill("Depot e2e");
  await page.getByRole("button", { name: "Añadir", exact: true }).click();
  await expect.poll(async () => ((await leer("planning_depots/p-puntos"))?.depots || []).map(d => d.nombre)).toEqual(["Depot e2e"]);
});
