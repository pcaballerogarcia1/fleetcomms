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
  // en fecha local (con toISOString, pasada la medianoche en España aún sería ayer y saldría «en 9 días»)
  const d10 = new Date(); d10.setDate(d10.getDate() + 10);
  const itv = `${d10.getFullYear()}-${String(d10.getMonth() + 1).padStart(2, "0")}-${String(d10.getDate()).padStart(2, "0")}`;
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
