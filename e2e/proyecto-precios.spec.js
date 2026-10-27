// Renombrar un proyecto desde su menú y poner precio por visita a un trabajo.
import { test, expect } from "@playwright/test";
import { sembrar, leer, listar } from "./semilla.mjs";
import { vigilarErrores, entrarOficina } from "./ayudas.mjs";

test.beforeEach(async () => { await sembrar(); });

test("renombrar el proyecto y poner precio por visita a un trabajo", async ({ page }) => {
  const errores = vigilarErrores(page);
  await entrarOficina(page);
  await page.getByText("Abrir proyecto").first().click();
  await page.waitForURL(/\/planning/);
  // renombrar desde el menú del nombre del proyecto
  await page.getByTitle("Opciones del proyecto").click();
  await page.getByRole("menuitem", { name: /Renombrar proyecto/ }).click();
  await page.getByLabel("Nombre del proyecto").fill("Madrid · Recogida lateral");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect.poll(async () => (await leer("scheduling_projects/p-puntos"))?.nombre).toBe("Madrid · Recogida lateral");
  await expect(page.getByTitle("Opciones del proyecto")).toContainText("Madrid · Recogida lateral");
  // sin pestaña de Inventario en Planificación
  await expect(page.getByRole("button", { name: "Inventario", exact: true })).toHaveCount(0);
  // trabajos con precio
  await page.getByRole("button", { name: "Trabajos", exact: true }).first().click();
  await page.getByRole("button", { name: "Empezar con la plantilla" }).click();
  const precio = page.getByLabel(/Precio por visita de /).first();
  await precio.fill("2,5");
  await precio.press("Enter");
  await expect.poll(async () => Object.values((await leer("precios/p-puntos"))?.porTrabajo || {})).toEqual([2.5]);
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/p1-precios-trabajos.png` });
  expect(errores).toEqual([]);
  void listar;
});
