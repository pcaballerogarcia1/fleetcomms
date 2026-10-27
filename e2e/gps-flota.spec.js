// Control → Mapa de flota → GPS de la empresa: elegir proveedor, probar,
// emparejar por matrícula, guardar y ver los vehículos en el mapa.
// (El servidor /api/gps se simula: aquí no hay cuentas reales de GPS.)
import { test, expect } from "@playwright/test";
import { sembrar, leer, ORG } from "./semilla.mjs";
import { vigilarErrores, entrarOficina } from "./ayudas.mjs";

test("conectar el GPS de la flota y ver sus vehículos en el mapa", async ({ page }) => {
  await sembrar();
  const ahora = Date.now();
  let pedido = null;
  await page.route("**/api/gps", async route => {
    pedido = route.request().postDataJSON();
    await route.fulfill({ json: { vehiculos: [
      { id: "001", nombre: "WF-001", matricula: "0001-ABC", lat: 40.42, lng: -3.70, velocidad: 37, hora: ahora, odometroKm: 120000 },
      { id: "002", nombre: "WF-002", matricula: "9999ZZZ", lat: 40.43, lng: -3.69, velocidad: 0, hora: ahora - 3600_000, odometroKm: null },
    ] } });
  });
  const errores = vigilarErrores(page);
  await entrarOficina(page);
  await page.getByText("Abrir proyecto").first().click();
  await page.waitForURL(/\/planning/);
  await page.getByRole("button", { name: "Control", exact: true }).first().click();
  await page.getByRole("button", { name: "Mapa de flota", exact: true }).click();
  await page.getByRole("button", { name: "Conectar GPS de la flota" }).click();
  const v = page.getByRole("dialog", { name: "GPS de la flota" });
  await v.getByLabel("GPS de la empresa").selectOption("webfleet");
  await v.getByLabel("Cuenta (account)").fill("empresa");
  await v.getByLabel("Usuario", { exact: true }).fill("operanzia");
  await v.getByLabel("Contraseña").fill("secreta");
  await v.getByRole("button", { name: "Probar conexión" }).click();
  await expect(v.getByText("Conectado: 2 vehículos con posición")).toBeVisible();
  expect(pedido).toMatchObject({ proveedor: "webfleet", cred: { cuenta: "empresa", usuario: "operanzia" } });
  // por matrícula: 0001-ABC es el Camión 1 de la flota
  await expect(v.getByLabel("Vehículo de la flota para WF-001")).toHaveValue("v1");
  await expect(v.getByLabel("Vehículo de la flota para WF-002")).toHaveValue("");
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/g1-gps.png` });
  await v.getByRole("button", { name: "Guardar y conectar" }).click();
  await expect.poll(async () => (await leer(`gps_conexiones/${ORG}`))?.activa).toBe(true);

  await expect(page.getByText("Camión 1 · 37 km/h")).toBeVisible();
  await expect(page.getByText(/WF-002 · hace 60 min/)).toBeVisible();
  await expect(page.getByText(/2\s*vehículos de Webfleet/)).toBeVisible();
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/g2-mapa.png` });
  expect(errores.filter(e => !/Failed to load resource|ERR_|tile\.openstreetmap/i.test(e))).toEqual([]);
});
