// Reparto: en la bandeja de pedidos se ve, en directo, qué ha pasado con cada
// uno en su ruta (entregado, no entregado con el motivo, aún en ruta), se abre
// su prueba de entrega, y los no entregados se pasan a otro día.
import { test, expect } from "@playwright/test";
import { sembrar, escribir, leer, listar, ORG } from "./semilla.mjs";
import { vigilarErrores, entrarOficina } from "./ayudas.mjs";

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

test("el resultado de cada entrega en la bandeja, y pasar los no entregados a otro día", async ({ page }) => {
  await sembrar();
  const hoy = new Date(), fecha = ymd(hoy), manana = ymd(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1));
  const p = await leer("scheduling_projects/p-puntos");
  await escribir("scheduling_projects/p-puntos", { ...p, sector: "distribucion" });
  const cli = (n, lat) => ({ nombre: n, direccion: `${n}, Salamanca`, lat, lng: -5.66, telefono: "", contacto: "" });
  const pedido = (id, c, extra = {}) => escribir(`pedidos/${id}`, { org_id: ORG, projectId: "p-puntos", fecha, cliente: c, ref: id.toUpperCase(), bultos: 2, kg: 20, desde: "", hasta: "", duracion: 5, notas: "", estado: "pendiente", origen: "manual", creadoEn: Date.now(), ruta: "Camión 1", ...extra });
  await pedido("pe1", cli("Bar El Puente", 40.961));
  await pedido("pe2", cli("Farmacia Sol", 40.962), { desde: "09:00", hasta: "11:00" });
  await pedido("pe3", cli("Restaurante La Ría", 40.963));
  const ahora = Date.now();
  await escribir("planes/ruta-hoy", {
    org_id: ORG, projectId: "p-puntos", origenVRP: true, tipo: "ruta", sector: "distribucion", nombre: "Camión 1 · Día", mes: fecha.slice(0, 7), diaNum: hoy.getDate(), fecha,
    vehiculoNombre: "Camión 1", conductorNombre: "Carlos Conductor", conductorUid: null, fechaSubida: ahora,
    ubicaciones: [
      { id: "u0", orden: 1, pedidoId: "pe1", calle: "Bar El Puente", lat: 40.961, lng: -5.66, elementos: [], realizado: true, realizadoEn: ahora, entrega: { estado: "entregada", recibe: "Ana Pérez", firma: false, fotos: 0, lat: null, lng: null, en: ahora } },
      { id: "u1", orden: 2, pedidoId: "pe2", calle: "Farmacia Sol", lat: 40.962, lng: -5.66, elementos: [], realizado: true, realizadoEn: ahora, entrega: { estado: "no_entregada", motivo: "ausente", fotos: 0, firma: false, lat: null, lng: null, en: ahora } },
      { id: "u2", orden: 3, pedidoId: "pe3", calle: "Restaurante La Ría", lat: 40.963, lng: -5.66, elementos: [], realizado: false },
    ],
  });

  const errores = vigilarErrores(page);
  await entrarOficina(page);
  await page.getByText("Abrir proyecto").first().click();
  await page.waitForURL(/\/planning/);
  await page.getByRole("button", { name: "Pedidos", exact: true }).click();
  await page.getByRole("button", { name: "Hoy", exact: true }).click();
  await expect(page.getByText("Entregado · Ana Pérez")).toBeVisible();
  await expect(page.getByText("No entregado · No había nadie")).toBeVisible();
  await expect(page.getByText("En ruta · Camión 1")).toBeVisible();
  await expect(page.getByText("No entregados", { exact: true })).toBeVisible();
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/resultado1.png` });

  // su prueba de entrega, como en Control
  await page.getByRole("button", { name: "Ver la entrega de Bar El Puente" }).click();
  await expect(page.getByRole("dialog", { name: "Prueba de entrega" }).getByText("Ana Pérez")).toBeVisible();
  await page.getByRole("dialog", { name: "Prueba de entrega" }).getByRole("button", { name: "Cerrar" }).click();

  // el no entregado, a mañana (con todo lo suyo)
  await page.getByRole("button", { name: /Pasar el no entregado al/ }).click();
  await expect(page.getByText(/Pasado al/)).toBeVisible();
  await expect.poll(async () => (await listar("pedidos")).filter(x => x.fecha === manana).length).toBe(1);
  const nuevo = (await listar("pedidos")).find(x => x.fecha === manana);
  expect(nuevo).toMatchObject({ origen: "reprogramado", desdePedido: "pe2", desdeFecha: fecha, ref: "PE2", desde: "09:00", hasta: "11:00", estado: "pendiente", cliente: { nombre: "Farmacia Sol" } });
  expect(nuevo.ruta).toBeFalsy();
  expect((await leer("pedidos/pe2")).reprogramadoA).toBe(manana);
  await page.getByRole("button", { name: "Día siguiente" }).click();
  await expect(page.getByText(/^del /)).toBeVisible();
  await expect(page.getByRole("cell", { name: /Farmacia Sol/ }).first()).toBeVisible();
  expect(errores.filter(e => !/Failed to load resource|ERR_/i.test(e))).toEqual([]);
});
