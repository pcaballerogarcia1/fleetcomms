// Planificación: subir la lista de clientes con dirección y sin coordenadas
// (como sale de un programa de facturación): se sitúan solas en el mapa con
// CartoCiudad (aquí, sus respuestas simuladas), y las que no aparecen se dicen.
import { test, expect } from "@playwright/test";
import { sembrar, listar } from "./semilla.mjs";
import { vigilarErrores, entrarOficina } from "./ayudas.mjs";

// CSV con punto y coma y comillas, como lo exporta Excel en español
const CSV = [
  "Cliente;Dirección;Población;Pedido;Bultos;Kg;Desde;Hasta",
  'Bar El Puente;"C/ Mayor, 12";Salamanca;P-1;3;45;09:00;11:00',
  "Farmacia Sol;Plaza Mayor 5;Salamanca;P-2;1;6;;",
  "Casa Perdida;Calle Inventada 99;Salamanca;P-3;1;1;;",
].join("\n");
const SITIOS = {
  "Calle Mayor 12, Salamanca": { type: "portal", tip_via: "CALLE", address: "MAYOR", portalNumber: 12, muni: "Salamanca", lat: 40.9652, lng: -5.6641 },
  "Plaza Mayor 5, Salamanca": { type: "portal", tip_via: "PLAZA", address: "MAYOR", portalNumber: 5, muni: "Salamanca", lat: 40.9648, lng: -5.6637 },
};

test("clientes con dirección: se sitúan solos y se avisa de los que no", async ({ page }) => {
  await sembrar();
  const errores = vigilarErrores(page);
  await page.route("**/geocoder/api/geocoder/**", route => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith("/candidates")) return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    const r = SITIOS[u.searchParams.get("q")];
    return route.fulfill({ status: 200, contentType: "application/json", body: r ? JSON.stringify(r) : "" });
  });
  await entrarOficina(page);
  await page.getByText("Abrir proyecto").first().click();
  await page.waitForURL(/\/planning/);
  const [selector] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Subir CSV / KML / Excel" }).click()]);
  await selector.setFiles({ name: "clientes.csv", mimeType: "text/csv", buffer: globalThis.Buffer.from(CSV, "utf8") });

  const ventana = page.getByRole("dialog", { name: "Situar direcciones en el mapa" });
  await expect(ventana.getByText(/3 filas con dirección pero sin coordenadas/)).toBeVisible();
  await ventana.getByRole("button", { name: "Situar en el mapa" }).click();
  await expect(ventana.getByText("En su portal")).toBeVisible();
  await expect(ventana.getByText("Calle Inventada 99, Salamanca")).toBeVisible(); // la que no aparece
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/direcciones1.png` });
  await ventana.getByRole("button", { name: "Crear la capa con 2 puntos" }).click();
  await expect(ventana).toHaveCount(0);

  await expect.poll(async () => (await listar("planning_layers")).find(l => l.name === "clientes")?.markers?.length).toBe(2);
  const capa = (await listar("planning_layers")).find(l => l.name === "clientes");
  expect(capa.markers[0]).toMatchObject({ Cliente: "Bar El Puente", Pedido: "P-1", Desde: "09:00", lat: 40.9652, lng: -5.6641, situado: "en el portal" });
  expect(errores.filter(e => !/Failed to load resource|ERR_/i.test(e))).toEqual([]);
});
