// Reparto: de la bandeja de pedidos de un día a las rutas de ese día. En
// Rutas se traen los pedidos de la fecha, se genera el escenario de ese día y
// se publica SOLO ese día (lo publicado de otros días no se toca). Cada pedido
// queda marcado con su ruta.
import { test, expect } from "@playwright/test";
import { sembrar, escribir, leer, listar, ORG } from "./semilla.mjs";
import { vigilarErrores, entrarOficina } from "./ayudas.mjs";

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

test("planificar y publicar un día de pedidos", async ({ page }) => {
  await sembrar();
  const d = new Date(); d.setDate(d.getDate() + 2);
  const fecha = ymd(d), mes = fecha.slice(0, 7), dia = d.getDate(), otroDia = dia === 1 ? 2 : 1;
  const p = await leer("scheduling_projects/p-puntos");
  // con costes (Restricciones): 22 €/h y 0,9 €/km, para el indicador «Margen»
  await escribir("scheduling_projects/p-puntos", { ...p, sector: "distribucion", scheduling: { ...(p.scheduling || {}), constraints: { ...(p.scheduling?.constraints || {}), costeHora: 22, costeKm: 0.9 } } });
  await escribir("precios/p-puntos", { org_id: ORG, projectId: "p-puntos", defaultPrecio: 25 }); // 25 € por entrega, para el indicador «Margen»
  const cliente = (n, lat, lng) => ({ nombre: n, direccion: `${n}, Salamanca`, lat, lng, telefono: "", contacto: "" });
  const pedido = (id, c, extra = {}) => escribir(`pedidos/${id}`, { org_id: ORG, projectId: "p-puntos", fecha, cliente: c, ref: id.toUpperCase(), bultos: 2, kg: 20, desde: "", hasta: "", duracion: 5, notas: "", estado: "pendiente", origen: "manual", creadoEn: Date.now(), ...extra });
  await pedido("pe1", cliente("Bar El Puente", 40.9636, -5.6649), { desde: "09:00", hasta: "11:00" });
  await pedido("pe2", cliente("Farmacia Sol", 40.9651, -5.6635));
  await pedido("pe3", cliente("Restaurante La Ría", 40.9711, -5.6565), { notas: "Llamar antes" });
  await pedido("pe4", cliente("Anulado", 40.97, -5.66), { estado: "anulado" });
  // lo ya publicado de otro día de este proyecto: no se debe tocar
  await escribir("planes/otro-dia", { org_id: ORG, projectId: "p-puntos", origenVRP: true, origenScheduling: true, tipo: "ruta", nombre: "Otro día", mes, diaNum: otroDia, diaServicio: `Día ${String(otroDia).padStart(2, "0")}`, ubicaciones: [{ id: "u0", realizado: false, lat: 40.96, lng: -5.66, elementos: [] }], fechaSubida: Date.now() });

  const errores = vigilarErrores(page);
  page.on("dialog", dlg => dlg.accept()); // avisos de publicar (conductores sin asignar…)
  await entrarOficina(page);
  await page.getByText("Abrir proyecto").first().click();
  await page.waitForURL(/\/planning/);
  await page.getByRole("button", { name: "Rutas", exact: true }).first().click();
  await page.getByLabel("Día de los pedidos").fill(fecha);
  await page.getByRole("button", { name: /Traer los pedidos del día/ }).click();
  await expect(page.getByRole("button", { name: /3 pedidos/ })).toBeVisible(); // sin el anulado
  await page.getByRole("button", { name: /Generar escenario/ }).first().click();
  await expect(page.getByRole("button", { name: /Excel/ })).toBeVisible({ timeout: 90_000 });
  // «Margen»: 3 entregas × 25 € = 75 € de facturación máxima, frente al coste; en verde si se gana, en rojo si se pierde
  await expect(page.getByText("Margen", { exact: true })).toBeVisible();
  await expect(page.getByText(/^75\s€\s−\s\d+\s€\scoste/)).toBeVisible(); // (los € llevan espacio duro)
  const valor = page.getByText(/^-?\d+,\d %$/).last();
  const texto = await valor.textContent();
  const color = await valor.evaluate(e => getComputedStyle(e).color);
  expect(color).toBe(texto.startsWith("-") ? "rgb(239, 107, 107)" : "rgb(63, 207, 142)"); // rojo o verde del tema oscuro
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/dia1-rutas.png` });

  await page.getByRole("button", { name: "Enviar a conductores" }).first().click();
  await expect(page.getByText(/Se sustituyen solo las rutas de ese día/)).toBeVisible();
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/dia2-publicar.png` });
  await page.getByRole("button", { name: "Publicar planes" }).click();

  await expect.poll(async () => (await listar("planes")).filter(x => x.fecha === fecha).length).toBeGreaterThan(0);
  const delDia = (await listar("planes")).filter(x => x.fecha === fecha);
  expect(delDia.every(x => x.diaNum === dia && x.mes === mes && x.sector === "distribucion")).toBe(true);
  const ubs = delDia.flatMap(x => x.ubicaciones);
  expect(ubs.map(u => u.pedidoId).sort()).toEqual(["pe1", "pe2", "pe3"]);
  expect(ubs.find(u => u.pedidoId === "pe1")).toMatchObject({ pedido: "PE1", bultos: "2", franja: { desde: 540, hasta: 660 } });
  expect(ubs.find(u => u.pedidoId === "pe3").comentari).toBe("Llamar antes");
  expect(await leer("planes/otro-dia")).toBeTruthy(); // el otro día, intacto
  await expect.poll(async () => (await leer("pedidos/pe1")).ruta).toBeTruthy();
  expect((await leer("pedidos/pe4")).ruta).toBeFalsy();

  // en la bandeja de pedidos se ve en qué ruta va cada uno
  await page.getByRole("button", { name: "Planificación", exact: true }).first().click();
  await page.getByRole("button", { name: "Pedidos", exact: true }).click();
  await page.getByLabel("Fecha de los pedidos").fill(fecha);
  await expect(page.getByText(/En ruta · /).first()).toBeVisible();
  expect(errores.filter(e => !/osrm|router\.project-osrm|Failed to load resource|ERR_|cartociudad|api\/avisos/i.test(e))).toEqual([]);
});
