// Recursos → Vehículos: la ficha del vehículo (combustible, autonomía, ITV…)
// se abre a la derecha y se guarda.
import { test, expect } from "@playwright/test";
import { sembrar, listar } from "./semilla.mjs";
import { vigilarErrores, entrarOficina } from "./ayudas.mjs";

test.beforeEach(async () => { await sembrar(); });

test("la ficha del vehículo se rellena a la derecha y se guarda", async ({ page }) => {
  const errores = vigilarErrores(page);
  await entrarOficina(page);
  await page.getByText("Abrir proyecto").first().click();
  await page.waitForURL(/\/planning/);
  await page.getByRole("button", { name: "Recursos", exact: true }).first().click();
  await page.getByTitle("Editar").first().click();
  await expect(page.getByText(/^Ficha de Camión/)).toBeVisible();
  const itv = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  await page.getByLabel("Marca").fill("Renault");
  await page.getByLabel("Modelo").fill("Kangoo E-Tech");
  await page.getByLabel("Combustible").selectOption("Eléctrico");
  await page.getByLabel(/^Autonomía/).fill("180");
  await page.getByLabel("Consumo (litros o kWh cada 100 km)").fill("18,5");
  await page.getByLabel("Próxima ITV").fill(itv);
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/v1-ficha-vehiculo.png` });
  await page.getByRole("button", { name: "Guardar", exact: true }).last().click();
  await expect(page.getByText("180 km", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("ITV en 10 días")).toBeVisible();
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/v2-guardado.png` });
  const v = (await listar("scheduling_vehicles")).find(x => x.marca === "Renault");
  expect(v).toMatchObject({ modelo: "Kangoo E-Tech", combustible: "Eléctrico", autonomiaKm: 180, consumo: 18.5, proximaITV: itv });
  expect(errores).toEqual([]);
});
