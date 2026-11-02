// Reparto: el conductor entrega una parada con quién lo recibe, su firma y una
// foto (y la posición del móvil), y otra la marca «no entregado» con el
// motivo; la oficina lo ve en Control con la firma y la foto.
import { test, expect } from "@playwright/test";
import { sembrar, escribir, leer, listar, ORG, mesActual } from "./semilla.mjs";
import { vigilarErrores, entrarCampo, entrarOficina } from "./ayudas.mjs";

// una foto pequeñita (PNG de 1×1)
const FOTO = globalThis.Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("entregar con firma y foto, no entregar con motivo, y verlo en la oficina", async ({ browser }) => {
  const { uids } = await sembrar();
  const parada = (id, extra) => ({ id, orden: id, calle: `Calle Mayor`, num: String(id * 10), barri: "Centro", lat: 40.41 + id / 1000, lng: -3.70, elementos: [], realizado: false, ...extra });
  await escribir("planes/plan-reparto", {
    org_id: ORG, tipo: "prev", sector: "distribucion", nombre: "Reparto de prueba", mes: mesActual(), diaServicio: "Día 03", conductorUid: uids.cond1,
    conductorNombre: "Carlos Conductor", fechaSubida: Date.now() + 1000, archivo: "semilla",
    ubicaciones: [
      parada(1, { pa: "Bar Pepe", contacto: "Bar Pepe", pedido: "PE-4471", bultos: "3", kg: "120", franja: { desde: 540, hasta: 660 } }),
      parada(2, { pa: "Farmacia Sol", contacto: "Farmacia Sol", pedido: "PE-4472", bultos: "1" }),
    ],
  });

  // ── el conductor, con el GPS del móvil
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, geolocation: { latitude: 40.4112, longitude: -3.7004, accuracy: 15 }, permissions: ["geolocation"] });
  const movil = await ctx.newPage();
  const errMovil = vigilarErrores(movil);
  await entrarCampo(movil, "cond1@demo.test");
  await movil.getByText("Mantenimiento Preventivo").click();
  await movil.getByText("Reparto de prueba").first().click();
  await expect(movil.getByText("Pedido PE-4471 · 3 bultos · 120 kg")).toBeVisible();
  await expect(movil.getByText("Entregar 09:00–11:00")).toBeVisible();
  await expect(movil.getByRole("button", { name: "Marcar todas" })).toHaveCount(0); // en reparto, una a una

  // entregada: quién, firma y foto
  await movil.getByRole("button", { name: "Entregar", exact: true }).first().click();
  await movil.getByRole("button", { name: "Entregado", exact: true }).click();
  await movil.getByRole("button", { name: "Confirmar entrega" }).click();
  await expect(movil.getByRole("alert")).toHaveText("Falta la firma de quien lo recibe"); // «Bar Pepe» ya venía como quien recibe
  await movil.getByLabel("Quién lo recibe").fill("Ana Pérez");
  const firma = await movil.getByRole("img", { name: "Firma" }).boundingBox();
  await movil.mouse.move(firma.x + 30, firma.y + 100);
  await movil.mouse.down();
  for (const [dx, dy] of [[80, -40], [140, 30], [200, -20], [260, 20]]) await movil.mouse.move(firma.x + dx, firma.y + 100 + dy, { steps: 4 });
  await movil.mouse.up();
  await movil.getByLabel("Foto de la entrega").setInputFiles({ name: "entrega.png", mimeType: "image/png", buffer: FOTO });
  await expect(movil.getByAltText("Foto 1")).toBeVisible();
  if (globalThis.process.env.CAPTURAS) await movil.screenshot({ path: `${globalThis.process.env.CAPTURAS}/entrega1-movil.png` });
  await movil.getByRole("button", { name: "Confirmar entrega" }).click();
  await expect(movil.getByText(/Recibe Ana Pérez/)).toBeVisible();
  await expect.poll(async () => (await leer("planes/plan-reparto")).ubicaciones[0].entrega?.recibe).toBe("Ana Pérez");
  const e1 = (await leer("planes/plan-reparto")).ubicaciones[0];
  expect(e1).toMatchObject({ realizado: true, entrega: { estado: "entregada", firma: true, fotos: 1, lat: 40.4112, lng: -3.7004 } });
  await expect.poll(async () => (await listar("entregas_pruebas")).length).toBe(2); // la firma y la foto

  // no entregada: el motivo
  await movil.getByRole("button", { name: "Entregar", exact: true }).first().click();
  await movil.getByRole("button", { name: "No entregado", exact: true }).click();
  await movil.getByLabel("No había nadie").check();
  await movil.getByRole("button", { name: "Confirmar: no entregado" }).click();
  await expect(movil.getByText(/No entregado · No había nadie/)).toBeVisible();
  await expect.poll(async () => (await leer("planes/plan-reparto")).ubicaciones[1].entrega?.motivo).toBe("ausente");
  if (globalThis.process.env.CAPTURAS) await movil.screenshot({ path: `${globalThis.process.env.CAPTURAS}/entrega2-lista.png` });

  // ── la oficina, en Control
  const page = await (await browser.newContext()).newPage();
  const errores = vigilarErrores(page);
  await entrarOficina(page);
  await page.getByText("Abrir proyecto").first().click();
  await page.waitForURL(/\/planning/);
  await page.getByRole("button", { name: "Control", exact: true }).first().click();
  await page.getByText("Reparto de prueba").first().click();
  await expect(page.getByText("Recibe Ana Pérez")).toBeVisible();
  await expect(page.getByText("No entregado · No había nadie")).toBeVisible();
  await page.getByRole("button", { name: "Ver prueba de entrega" }).last().click(); // la más antigua: la entregada
  const ventana = page.getByRole("dialog", { name: "Prueba de entrega" });
  await expect(ventana.getByText("PE-4471")).toBeVisible();
  await expect(ventana.getByAltText("Firma de quien lo recibe")).toBeVisible();
  await expect(ventana.getByAltText("Foto 1 de la entrega")).toBeVisible();
  await expect(ventana.getByRole("link", { name: /40.4112, -3.7004/ })).toBeVisible();
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/entrega3-oficina.png` });
  // el albarán firmado, para mandárselo al cliente
  const [albaran] = await Promise.all([page.waitForEvent("popup"), ventana.getByRole("button", { name: "Albarán en PDF" }).click()]);
  await expect(albaran.getByText("Albarán de entrega")).toBeVisible();
  await expect(albaran.getByText("Ana Pérez")).toBeVisible();
  expect(await albaran.locator("img").count()).toBe(2); // la firma y la foto
  await albaran.close();
  const ruido = e => /Failed to load resource|ERR_|api\/avisos/i.test(e);
  expect(errMovil.filter(e => !ruido(e))).toEqual([]);
  expect(errores.filter(e => !ruido(e))).toEqual([]);
});
