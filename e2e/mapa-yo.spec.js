// App del conductor: en el mapa de la ruta se ve dónde está (punto azul) y
// «Dónde estoy» lo centra ahí; sin permiso de ubicación, lo explica.
import { test, expect } from "@playwright/test";
import { sembrar } from "./semilla.mjs";
import { vigilarErrores, entrarCampo } from "./ayudas.mjs";

test("el conductor se ve en el mapa", async ({ browser }) => {
  await sembrar();
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, geolocation: { latitude: 40.4150, longitude: -3.6950, accuracy: 25 }, permissions: ["geolocation"] });
  const movil = await ctx.newPage();
  const errores = vigilarErrores(movil);
  await entrarCampo(movil, "cond1@demo.test");
  await movil.getByText("Mantenimiento Preventivo").click();
  await movil.getByText("Ruta de prueba").first().click();
  await expect(movil.getByText("Tú", { exact: true })).toBeVisible(); // en la leyenda, en cuanto hay posición
  await expect(movil.locator('path[fill="#2f80ff"]').first()).toBeAttached(); // el punto azul
  await movil.getByRole("button", { name: "Dónde estoy" }).click();
  await expect(movil.getByRole("status")).toHaveCount(0); // con posición, centra (sin avisos)
  if (globalThis.process.env.CAPTURAS) await movil.screenshot({ path: `${globalThis.process.env.CAPTURAS}/yo-mapa.png` });
  expect(errores).toEqual([]);

  // sin permiso de ubicación: lo dice
  const ctx2 = await browser.newContext({ viewport: { width: 400, height: 860 }, permissions: [] });
  const m2 = await ctx2.newPage();
  await entrarCampo(m2, "cond1@demo.test");
  await m2.getByText("Mantenimiento Preventivo").click();
  await m2.getByText("Ruta de prueba").first().click();
  await m2.getByRole("button", { name: "Dónde estoy" }).click();
  await expect(m2.getByRole("status")).toHaveText(/ubicación|GPS|Buscando/);
});
