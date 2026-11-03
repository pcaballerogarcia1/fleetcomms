// Planificación → Pedidos (reparto): apuntar pedidos de clientes de la lista
// y de uno nuevo (por su dirección), pegarlos desde Excel y los fijos, que
// salen solos el día que toca (y si se anulan ese día, no vuelven).
import { test, expect } from "@playwright/test";
import { sembrar, escribir, listar, ORG, mesActual } from "./semilla.mjs";
import { vigilarErrores, entrarOficina } from "./ayudas.mjs";

// el próximo lunes (al menos dentro de 2 días): los fijos solo salen de hoy en adelante
function proximoLunes() {
  const d = new Date(); d.setDate(d.getDate() + 2);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

test("la bandeja de pedidos de un día", async ({ page }) => {
  await sembrar();
  await escribir("scheduling_projects/p-puntos", { org_id: ORG, nombre: "Proyecto de puntos", tipo: "puntos", mes: mesActual(), createdAt: Date.now(), status: "borrador", sector: "distribucion" });
  await escribir("planning_layers/p-puntos_clientes", {
    id: "clientes", name: "clientes", type: "xlsx", color: "#4f7fe0", visible: true, projectId: "p-puntos", orgId: ORG,
    markers: [
      { lat: 40.9636, lng: -5.6649, Cliente: "Bar El Puente", Dirección: "Rúa Mayor 12", Población: "Salamanca", Teléfono: "923 000 111" },
      { lat: 40.9651, lng: -5.6635, Cliente: "Farmacia Sol", Dirección: "Plaza Mayor 5", Población: "Salamanca" },
      { lat: 40.9711, lng: -5.6565, Cliente: "Restaurante La Ría", Dirección: "Avenida de Portugal 40", Población: "Salamanca" },
    ],
  });
  const errores = vigilarErrores(page);
  await page.route("**/geocoder/api/geocoder/**", route => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith("/candidates")) return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    const ok = u.searchParams.get("q") === "Calle Toro 23, Salamanca";
    return route.fulfill({ status: 200, contentType: "application/json", body: ok ? JSON.stringify({ type: "portal", tip_via: "CALLE", address: "TORO", portalNumber: 23, muni: "Salamanca", lat: 40.9663, lng: -5.6628 }) : "" });
  });
  await entrarOficina(page);
  await page.getByText("Abrir proyecto").first().click();
  await page.waitForURL(/\/planning/);
  await page.getByRole("button", { name: "Pedidos", exact: true }).click();
  const lunes = proximoLunes();
  await page.getByLabel("Fecha de los pedidos").fill(lunes);
  await expect(page.getByText("No hay pedidos para este día.")).toBeVisible();

  // 1) un cliente de la lista: se busca por su nombre
  await page.getByLabel("Cliente", { exact: true }).fill("bar");
  await page.getByRole("option", { name: /Bar El Puente/ }).click();
  await page.getByLabel("Nº de pedido").fill("P-1");
  await page.getByLabel("Bultos").fill("3");
  await page.getByLabel("Kg").fill("45");
  await page.getByLabel("Desde").fill("9");
  await page.getByLabel("Hasta").fill("11");
  await page.getByRole("button", { name: "Añadir", exact: true }).click();
  await expect(page.getByRole("cell", { name: "P-1" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "09:00–11:00" })).toBeVisible();

  // 2) un cliente nuevo: por su dirección (y queda en la lista)
  await page.getByLabel("Cliente", { exact: true }).fill("Kiosco Nuevo");
  await page.getByLabel("Dirección del cliente nuevo").fill("Calle Toro 23, Salamanca");
  await page.getByLabel("Nº de pedido").fill("P-2");
  await page.getByRole("button", { name: "Añadir", exact: true }).click();
  await expect(page.getByRole("cell", { name: "P-2" })).toBeVisible();
  await expect.poll(async () => (await listar("planning_layers")).find(l => l.id === "clientes-nuevos")?.markers?.[0]?.Cliente).toBe("Kiosco Nuevo");

  // 3) pegados desde Excel
  await page.getByRole("button", { name: "Pegar desde Excel" }).click();
  await page.getByLabel("Tabla pegada").fill("Cliente\tPedido\tBultos\tKg\nFarmacia Sol\tP-3\t1\t6");
  await page.getByRole("button", { name: "Revisar" }).click();
  await expect(page.getByText("Cliente de la lista")).toBeVisible();
  await page.getByRole("button", { name: "Añadir 1 pedido" }).click();
  await expect(page.getByRole("dialog", { name: "Pegar pedidos desde Excel" })).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "P-3" })).toBeVisible();

  // 4) un fijo de los lunes: sale solo
  await page.getByRole("button", { name: /Pedidos fijos/ }).click();
  const fijos = page.getByRole("dialog", { name: "Pedidos fijos" });
  await fijos.getByLabel("Cliente del pedido fijo").fill("ría");
  await fijos.getByRole("option", { name: /Restaurante La Ría/ }).click();
  await fijos.getByRole("button", { name: "lunes" }).click();
  await fijos.getByLabel("Bultos del fijo").fill("2");
  await fijos.getByRole("button", { name: "Añadir fijo" }).click();
  await expect(fijos.getByRole("cell", { name: "L", exact: true })).toBeVisible();
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/pedidos2-fijos.png` });
  await fijos.getByRole("button", { name: "Cerrar" }).click();
  await expect(page.getByText("fijo", { exact: true })).toBeVisible();
  await expect(page.getByText(/^4$/).first()).toBeVisible(); // 4 pedidos
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/pedidos1-dia.png` });

  // anulado ese día, no vuelve (ni se duplica) al ir y volver
  await page.getByRole("button", { name: "Anular el pedido de Restaurante La Ría" }).click();
  await expect(page.getByText("anulado")).toBeVisible();
  await page.getByRole("button", { name: "Día siguiente" }).click();
  await expect(page.getByText("No hay pedidos para este día.")).toBeVisible(); // martes: el fijo es de los lunes
  await page.getByRole("button", { name: "Día anterior" }).click();
  await expect(page.getByText("anulado")).toBeVisible();
  const delLunes = (await listar("pedidos")).filter(p => p.fecha === lunes);
  expect(delLunes).toHaveLength(4);
  expect(delLunes.find(p => p.origen === "fijo")).toMatchObject({ estado: "anulado", bultos: 2, cliente: { nombre: "Restaurante La Ría" } });
  expect(delLunes.find(p => p.ref === "P-1")).toMatchObject({ bultos: 3, kg: 45, desde: "09:00", hasta: "11:00", cliente: { nombre: "Bar El Puente", lat: 40.9636 } });
  expect(errores.filter(e => !/Failed to load resource|ERR_/i.test(e))).toEqual([]);
});
