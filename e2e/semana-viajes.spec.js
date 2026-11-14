// Rutas › Semana (viajes de varios días): pedidos por toda España la
// semana que viene, camiones con su carga máxima en palés; planificar la
// semana (con noches fuera) y enviarla a los conductores.
import { test, expect } from "@playwright/test";
import { sembrar, escribir, leer, listar, ORG } from "./semilla.mjs";
import { vigilarErrores, entrarOficina } from "./ayudas.mjs";

const lunesQueViene = () => {
  const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const masDias = (f, n) => { const [a, m, d] = f.split("-").map(Number); const x = new Date(a, m - 1, d + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };

test("planificar la semana con viajes de varios días y enviarla a los conductores", async ({ page }) => {
  await sembrar();
  const p = await leer("scheduling_projects/p-puntos");
  await escribir("scheduling_projects/p-puntos", { ...p, sector: "distribucion" });
  // la flota con su carga máxima en palés
  const vs = (await listar("scheduling_vehicles")).filter(v => v.org_id === ORG);
  for (const [i, v] of vs.entries()) { const { _id, ...resto } = v; await escribir(`scheduling_vehicles/${_id}`, { ...resto, cargaMax: [32, 20, 12][i] ?? 10 }); }
  const lunes = lunesQueViene();
  const pedidos = [
    ["A Coruña", 43.3623, -8.4115, 10], ["Oviedo", 43.3603, -5.8448, 8], ["Madrid", 40.4168, -3.7038, 6], ["Barcelona", 41.3874, 2.1686, 9],
    ["Sevilla", 37.3891, -5.9845, 7], ["Valencia", 39.4699, -0.3763, 5], ["Palma", 39.5696, 2.6502, 4], ["Las Palmas", 28.1235, -15.4363, 3],
  ];
  for (const [i, [c, lat, lng, palets]] of pedidos.entries()) {
    await escribir(`pedidos/w${i}`, { org_id: ORG, projectId: "p-puntos", fecha: masDias(lunes, i % 3), cliente: { nombre: `Distribuidor ${c}`, lat, lng, direccion: c }, ref: `G${i}`, bultos: palets, kg: palets * 600, estado: "pendiente", origen: "manual", creadoEn: Date.now() + i });
  }

  const errores = vigilarErrores(page);
  await entrarOficina(page);
  await page.getByText("Abrir proyecto").first().click();
  await page.waitForURL(/\/planning/);
  await page.getByRole("button", { name: "Rutas", exact: true }).first().click();
  await page.getByRole("button", { name: /Semana \(viajes largos\)/ }).click();
  const v = page.getByRole("dialog", { name: "Semana: viajes de varios días" });
  await v.getByLabel("Lunes de la semana").fill(lunes);
  await v.getByRole("button", { name: "Planificar la semana" }).click();
  await expect(v.getByText("Ocupación media")).toBeVisible({ timeout: 30_000 });
  await expect(v.getByText(/^52 \/ 52$/)).toBeVisible(); // todos los palés servidos
  // el detalle de un viaje: su agenda con la noche fuera
  await expect(v.getByLabel(/^Detalle del viaje/)).toBeVisible();
  await expect(v.getByText(/^Noche:/).first()).toBeVisible();
  // el mapa del viaje: el recorrido y sus puntos
  await expect(v.locator(".leaflet-container")).toHaveCount(1);
  await expect(v.locator("path.leaflet-interactive").first()).toBeVisible({ timeout: 20_000 });
  await expect(v.getByText(/naviera a (Baleares|Canarias)/).first()).toBeVisible();
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/semana-viajes.png` });

  // enviar a los conductores: una ruta por día de cada viaje
  page.once("dialog", d => d.accept());
  await v.getByRole("button", { name: /Enviar a conductores/ }).click();
  await expect(v.getByText(/^Enviados: \d+ viajes en \d+ rutas de día/)).toBeVisible({ timeout: 30_000 });
  const planes = (await listar("planes")).filter(x => x.origenViajes);
  expect(planes.length).toBeGreaterThan(0);
  expect(planes.flatMap(x => x.ubicaciones).map(u => u.pedidoId).sort()).toEqual(pedidos.map((_, i) => `w${i}`).sort());
  expect(planes.every(x => x.fecha >= lunes && x.fecha <= masDias(lunes, 4))).toBe(true);
  expect((await leer("pedidos/w0")).ruta).toBeTruthy();
  expect(errores).toEqual([]);
});
