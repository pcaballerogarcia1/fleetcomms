// Limpieza viaria (fase 1): buscar el municipio, descargar sus calles en
// tramos, crear la capa, repartirlos en itinerarios en Rutas y ver la
// cobertura del mes. CartoCiudad y OpenStreetMap se simulan.
import { test, expect } from "@playwright/test";
import { sembrar, escribir, leer, ORG } from "./semilla.mjs";
import { vigilarErrores, entrarOficina } from "./ayudas.mjs";

// una cuadrícula de 4 calles de ~350 m (cada una sale en 2 tramos)
const calle = (id, nombre, a, b) => ({ type: "way", id, tags: { highway: "residential", name: nombre },
  geometry: [0, 1, 2, 3].map(i => ({ lat: a[0] + (b[0] - a[0]) * i / 3, lon: a[1] + (b[1] - a[1]) * i / 3 })) });
const OSM = { elements: [
  calle(1, "Calle Mayor", [40.9640, -5.6650], [40.9640, -5.6608]),
  calle(2, "Calle Toro", [40.9670, -5.6650], [40.9670, -5.6608]),
  calle(3, "Calle Zamora", [40.9640, -5.6650], [40.9670, -5.6650]),
  calle(4, "Rúa Mayor", [40.9640, -5.6608], [40.9670, -5.6608]),
] };

test("de las calles de un municipio a los itinerarios de barrido", async ({ page }) => {
  await sembrar();
  const p = await leer("scheduling_projects/p-puntos");
  await escribir("scheduling_projects/p-puntos", { ...p, sector: "viaria" });
  await page.route("**/geocoder/api/geocoder/candidates**", r => r.fulfill({ json: [{ address: "Salamanca", type: "Municipio", lat: 40.9655, lng: -5.6629 }] }));
  let consulta = "";
  await page.route("https://overpass-api.de/api/interpreter", r => { consulta = decodeURIComponent(r.request().postData() || ""); r.fulfill({ json: OSM }); });

  const errores = vigilarErrores(page);
  await entrarOficina(page);
  await page.getByText("Abrir proyecto").first().click();
  await page.waitForURL(/\/planning/);
  await page.getByRole("button", { name: /Calles para barrer/ }).click();
  const v = page.getByRole("dialog", { name: "Calles para barrer" });
  await v.getByLabel("Municipio o barrio").fill("Salamanca");
  await v.getByRole("button", { name: "Buscar" }).click();
  await v.getByRole("button", { name: "Descargar las calles" }).click();
  await expect(v.getByText(/8 tramos · 1,4 km de calle/)).toBeVisible();
  expect(consulta).toMatch(/way\["highway"~"\^\(primary\|/);
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/v1-callejero.png` });
  await v.getByRole("button", { name: "Crear la capa de calles" }).click();
  await expect(v).toHaveCount(0);
  await expect(page.getByText("Calles · Salamanca").first()).toBeVisible();
  if (globalThis.process.env.CAPTURAS) { await page.waitForTimeout(2500); await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/v2-capa.png` }); }

  // Rutas: los tramos son las «paradas», con su tiempo de barrido
  await page.getByRole("button", { name: "Rutas", exact: true }).first().click();
  await page.getByRole("button", { name: /Importar desde Planificación/ }).first().click();
  await expect(page.getByRole("button", { name: /8 paradas/ })).toBeVisible();
  await page.getByRole("button", { name: /Generar escenario/ }).first().click();
  await expect(page.getByRole("button", { name: /Excel/ })).toBeVisible({ timeout: 90_000 });
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/v3-itinerarios.png` });
  expect(errores.filter(e => !/osrm|router\.project-osrm|Failed to load resource|ERR_|overpass|cartociudad/i.test(e))).toEqual([]);
});

test("cobertura del mes de las calles", async ({ page }) => {
  await sembrar();
  const p = await leer("scheduling_projects/p-puntos");
  await escribir("scheduling_projects/p-puntos", { ...p, sector: "viaria" });
  const hoy = new Date(), mes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
  const t = (lat, realizado) => ({ id: `u${lat}`, pa: `Calle ${lat}`, lat, lng: -5.66, geom: [lat, -5.665, lat, -5.661], metros: 340, realizado, elementos: [] });
  await escribir("planes/viaria-1", { org_id: ORG, tipo: "prev", nombre: "Itinerario 1", mes, diaNum: 1, vehiculoNombre: "Operario 1", conductorUid: null, fechaSubida: Date.now(), ubicaciones: [t(40.964, true), t(40.965, false), t(40.966, true)] });
  await escribir("planes/viaria-2", { org_id: ORG, tipo: "prev", nombre: "Itinerario 1", mes, diaNum: 2, vehiculoNombre: "Operario 1", conductorUid: null, fechaSubida: Date.now(), ubicaciones: [t(40.964, true), t(40.965, false), t(40.966, false)] });

  const errores = vigilarErrores(page);
  await entrarOficina(page);
  await page.getByText("Abrir proyecto").first().click();
  await page.waitForURL(/\/planning/);
  await page.getByRole("button", { name: "Análisis", exact: true }).first().click();
  await page.getByRole("button", { name: "Cobertura", exact: true }).click();
  await expect(page.getByText("50 %")).toBeVisible();             // 3 de 6 pasadas
  await expect(page.getByText("0,3 de 1,0 km")).toBeVisible();    // una calle completa
  await expect(page.getByRole("region", { name: "Mapa de cobertura" })).toBeVisible();
  if (globalThis.process.env.CAPTURAS) { await page.waitForTimeout(1500); await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/v4-cobertura.png` }); }
  expect(errores.filter(e => !/Failed to load resource|ERR_|tile\.openstreetmap/i.test(e))).toEqual([]);
});
