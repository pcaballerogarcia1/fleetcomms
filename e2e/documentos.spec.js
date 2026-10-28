// Documentos: la oficina sube una IT en Cuadrante → Documentos, el
// trabajador la abre en la app y confirma la lectura, y la oficina lo ve.
import { test, expect } from "@playwright/test";
import { sembrar } from "./semilla.mjs";
import { vigilarErrores, entrarOficina, entrarCampo, pdfMini } from "./ayudas.mjs";

test("subir una IT, leerla en la app y ver quién la ha leído", async ({ browser }) => {
  await sembrar();
  const page = await (await browser.newContext()).newPage();
  const errores = vigilarErrores(page);
  await entrarOficina(page);
  await page.getByText("Abrir proyecto").first().click();
  await page.waitForURL(/\/planning/);
  await page.getByRole("button", { name: "Cuadrante", exact: true }).first().click();
  await page.getByRole("button", { name: "Documentos", exact: true }).click();
  await page.getByRole("button", { name: "Subir documento" }).click();
  await page.getByLabel("Título del documento").fill("IT-04 Vaciado de soterrados");
  await page.getByLabel("Descripción").fill("Pasos y equipos de protección");
  await page.getByLabel("Archivo", { exact: true }).setInputFiles({ name: "IT-04.pdf", mimeType: "application/pdf", buffer: pdfMini([["IT-04: usar guantes y chaleco"]]) });
  await page.getByRole("button", { name: "Subir y avisar" }).click();
  await expect(page.getByText("IT-04 Vaciado de soterrados")).toBeVisible();
  await expect(page.getByText("Leído por 0 de 3")).toBeVisible(); // 2 conductores y el jefe

  // ── el trabajador
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 } });
  const movil = await ctx.newPage();
  movil.on("popup", p => p.close().catch(() => {})); // la pestaña del PDF
  const errMovil = vigilarErrores(movil);
  await entrarCampo(movil, "cond1@demo.test");
  // en el menú de su foto (con el número de pendientes encima)
  await movil.getByRole("button", { name: "Tu perfil" }).click();
  await expect(movil.getByRole("menuitem", { name: /Documentos\s*1/ })).toBeVisible();
  await expect(movil.getByRole("menuitem", { name: /Avisos en el móvil/ })).toBeVisible();
  if (globalThis.process.env.CAPTURAS) await movil.screenshot({ path: `${globalThis.process.env.CAPTURAS}/doc0-menu.png` });
  await movil.getByRole("menuitem", { name: /Documentos/ }).click();
  await expect(movil.getByRole("button", { name: "He leído y entendido" })).toBeDisabled(); // primero hay que abrirlo
  if (globalThis.process.env.CAPTURAS) await movil.screenshot({ path: `${globalThis.process.env.CAPTURAS}/doc1-app.png` });
  await movil.getByRole("button", { name: /Abrir/ }).click();
  await movil.getByRole("button", { name: "He leído y entendido" }).click();
  await expect(movil.getByText("Leído", { exact: true })).toBeVisible();

  // ── la oficina lo ve
  await expect(page.getByText("Leído por 1 de 3")).toBeVisible();
  await page.getByRole("button", { name: /Ver quién ha leído/ }).click();
  await expect(page.getByText("Sin leer (2)")).toBeVisible();
  // también un Word (una DPT)
  await page.getByRole("button", { name: "Subir documento" }).click();
  await page.getByLabel("Título del documento").fill("DPT Conductor de recolector");
  await page.getByLabel("Tipo de documento").selectOption("DPT");
  await page.getByLabel("Archivo", { exact: true }).setInputFiles({ name: "DPT-conductor.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: pdfMini([["simulado"]]) });
  await page.getByRole("button", { name: "Subir y avisar" }).click();
  await expect(page.getByText(/Ficha de puesto y riesgos \(DPT\) · Word · para todos/)).toBeVisible();
  await expect(movil.getByRole("button", { name: /Descargar/ })).toBeVisible();
  // y los avisos al móvil, también desde el menú de la foto
  await movil.getByRole("button", { name: "Tu perfil" }).click();
  await movil.getByRole("menuitem", { name: /Avisos en el móvil/ }).click();
  await expect(movil.getByText(/Avisos en el móvil|Avisos activados|no admite avisos|Añadir a pantalla de inicio/).first()).toBeVisible();
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/doc2-oficina.png` });
  const ruido = e => /Failed to load resource|ERR_|api\/avisos/i.test(e);
  expect(errores.filter(e => !ruido(e))).toEqual([]);
  expect(errMovil.filter(e => !ruido(e))).toEqual([]);
});
