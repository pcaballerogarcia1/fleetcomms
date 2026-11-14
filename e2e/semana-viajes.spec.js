// Rutas en un proyecto de reparto = la semana: pedidos cerca de la base
// (rutas de un día, alguno con «solo este día») y por toda España (viajes
// de varios días), camiones con su carga máxima; planificar la semana, ver un
// día con todos los camiones, un camión con su mapa y agenda, enviarla a los
// conductores y volver a abrirla (el plan queda guardado).
import { test, expect } from "@playwright/test";
import { sembrar, escribir, leer, listar, ORG } from "./semilla.mjs";
import { vigilarErrores, entrarOficina } from "./ayudas.mjs";

const lunesQueViene = () => {
  const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const masDias = (f, n) => { const [a, m, d] = f.split("-").map(Number); const x = new Date(a, m - 1, d + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };

test("Rutas de un proyecto de reparto: la semana con rutas de un día y viajes de varios días", async ({ page }) => {
  await sembrar();
  const p = await leer("scheduling_projects/p-puntos");
  await escribir("scheduling_projects/p-puntos", { ...p, sector: "distribucion" });
  // la flota con su carga máxima en palés
  const vs = (await listar("scheduling_vehicles")).filter(v => v.org_id === ORG);
  for (const [i, v] of vs.entries()) { const { _id, ...resto } = v; await escribir(`scheduling_vehicles/${_id}`, { ...resto, cargaMax: [32, 20, 12][i] ?? 10 }); }
  // y dos furgonetas para el reparto de cerca
  for (const n of [1, 2]) { const resto = { ...vs[0] }; delete resto._id; await escribir(`scheduling_vehicles/furgo${n}`, { ...resto, nombre: `Furgoneta ${n}`, matricula: `F-${n}`, cargaMax: 8 }); }
  const lunes = lunesQueViene();
  // [ciudad, lat, lng, palés, día (0 = lunes), solo ese día]
  const pedidos = [
    ["A Coruña", 43.3623, -8.4115, 10, 0], ["Oviedo", 43.3603, -5.8448, 8, 1], ["Madrid", 40.4168, -3.7038, 6, 0], ["Barcelona", 41.3874, 2.1686, 9, 2],
    ["Sevilla", 37.3891, -5.9845, 7, 1], ["Palma", 39.5696, 2.6502, 4, 0], ["Las Palmas", 28.1235, -15.4363, 3, 0],
    ["Molina de Segura", 38.0546, -1.2075, 3, 0, true], ["Cartagena", 37.6257, -0.9966, 2, 2, true], ["Alcantarilla", 37.9692, -1.2170, 2, 4, true],
    ["Murcia centro", 37.9838, -1.1280, 4, 1, true], ["Orihuela", 38.0848, -0.9440, 3, 1, true], ["Lorca", 37.6771, -1.7006, 3, 3, true], ["Mazarrón", 37.5990, -1.3150, 3, 3, true],
  ];
  for (const [i, [c, lat, lng, palets, dia, fija]] of pedidos.entries()) {
    await escribir(`pedidos/w${i}`, { org_id: ORG, projectId: "p-puntos", fecha: masDias(lunes, dia), fechaFija: !!fija, cliente: { nombre: `Distribuidor ${c}`, lat, lng, direccion: c }, ref: `G${i}`, bultos: palets, kg: palets * 600, estado: "pendiente", origen: "manual", creadoEn: Date.now() + i });
  }

  const errores = vigilarErrores(page);
  await entrarOficina(page);
  await page.getByText("Abrir proyecto").first().click();
  await page.waitForURL(/\/planning/);
  await page.getByRole("button", { name: "Rutas", exact: true }).first().click();
  // en un proyecto de reparto, Rutas abre la semana directamente
  const v = page.getByRole("dialog", { name: "Semana de reparto" });
  await expect(v).toBeVisible({ timeout: 20_000 });
  await v.getByLabel("Lunes de la semana").fill(lunes);
  await expect(v.getByRole("button", { name: "Planificar la semana" })).toBeEnabled();
  await v.getByRole("button", { name: "Planificar la semana" }).click();
  await expect(v.getByText("Ocupación media")).toBeVisible({ timeout: 30_000 });
  await expect(v.getByText(/^67 \/ 67$/)).toBeVisible(); // todos los palés servidos
  await expect(v.getByText("Rutas de un día")).toBeVisible();
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/semana-reparto.png` });

  // un día: todos los camiones, unos en ruta del día y otros de viaje (con dónde duermen)
  const martes = Number(masDias(lunes, 1).slice(8));
  await v.getByRole("tab", { name: `mar ${martes}` }).click();
  await expect(v.getByLabel(`Camiones del mar ${martes}`).getByText(/Distribuidor Murcia centro/)).toBeVisible(); // «solo este día»: ese día
  // el día con alguna ruta de ida y vuelta en el día
  await v.getByRole("tab").filter({ has: page.getByText(/^[1-9]\d* rutas? ·/) }).first().click();
  await expect(v.getByLabel(/^Camiones del/).getByText("Ruta del día").first()).toBeVisible();
  await expect(v.getByLabel(/^Camiones del/).getByText(/vuelve a Murcia/).first()).toBeVisible();
  const dia = Number(lunes.slice(8));
  await v.getByRole("tab", { name: `lun ${dia}` }).click();
  const delDia = v.getByLabel(`Camiones del lun ${dia}`);
  await expect(delDia.getByText(/^De viaje · día 1 de \d$/).first()).toBeVisible();
  await expect(delDia.getByText(/Duerme:/).first()).toBeVisible();
  await expect(delDia.getByText(/Distribuidor Molina de Segura/)).toBeVisible(); // el de «solo este día», ese día
  // un camión de viaje: su mapa y su agenda
  await delDia.getByRole("button", { name: /de viaje, día 1/ }).first().click();
  await expect(v.getByLabel(/^Detalle del viaje/)).toBeVisible();
  await expect(v.getByText(/^Noche:/).first()).toBeVisible();
  await expect(v.locator("path.leaflet-interactive").first()).toBeVisible({ timeout: 20_000 });
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/semana-reparto-dia.png` });
  // el miércoles, la ruta con Cartagena (solo ese día)
  await v.getByRole("tab", { name: `mié ${Number(masDias(lunes, 2).slice(8))}` }).click();
  await expect(v.getByText(/Distribuidor Cartagena/).first()).toBeVisible();

  // enviar a los conductores: una ruta por día de cada viaje
  page.once("dialog", d => d.accept());
  await v.getByRole("button", { name: /Enviar a conductores/ }).click();
  await expect(v.getByText(/^Enviados: \d+ rutas y viajes en \d+ rutas de día/)).toBeVisible({ timeout: 30_000 });
  const planes = (await listar("planes")).filter(x => x.origenViajes);
  expect(planes.flatMap(x => x.ubicaciones).map(u => u.pedidoId).sort()).toEqual(pedidos.map((_, i) => `w${i}`).sort());
  expect(planes.every(x => x.fecha >= lunes && x.fecha <= masDias(lunes, 4))).toBe(true);
  // los de «solo este día», justo ese día
  const fechaDe = id => planes.find(x => x.ubicaciones.some(u => u.pedidoId === id)).fecha;
  expect(fechaDe("w7")).toBe(lunes);
  expect(fechaDe("w8")).toBe(masDias(lunes, 2));
  expect(fechaDe("w9")).toBe(masDias(lunes, 4));
  expect(fechaDe("w10")).toBe(masDias(lunes, 1));
  expect(fechaDe("w12")).toBe(masDias(lunes, 3));
  // los de «a partir de su día», nunca antes
  for (const [i, [, , , , d, fija]] of pedidos.entries()) if (!fija) expect(fechaDe(`w${i}`) >= masDias(lunes, d)).toBe(true);
  expect((await leer("pedidos/w0")).ruta).toBeTruthy();
  await expect(v.getByRole("button", { name: /Enviar a conductores/ })).toBeDisabled(); // todo enviado

  // al volver, el plan sigue ahí (guardado por semana)
  await v.getByRole("button", { name: "Cerrar" }).first().click();
  await page.getByRole("button", { name: "Semana de reparto" }).click();
  await v.getByLabel("Lunes de la semana").fill(lunes);
  await expect(v.getByText(/^67 \/ 67$/)).toBeVisible({ timeout: 15_000 });
  expect(JSON.parse((await leer(`semanas_reparto/p-puntos_${lunes}`)).plan).enviados.length).toBeGreaterThan(0);
  expect(errores).toEqual([]);
});
