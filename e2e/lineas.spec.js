// Líneas regulares contra los emuladores: crear el proyecto, importar una red
// GTFS pequeña, poner una cochera, generar vehículos y turnos, y mover una
// pieza a mano (que se guarda).
import { test, expect } from "@playwright/test";
import { sembrar, listar, leer } from "./semilla.mjs";
import { vigilarErrores, entrarOficina, gtfsMini } from "./ayudas.mjs";

test.beforeEach(async () => { await sembrar(); });

// Arrastrar en el Gantt con los mismos eventos que lanza el navegador
// destino: número de fila, o "nuevo" (la zona verde de autobús/turno nuevo)
async function arrastrar(page, filaOrigen, destino) {
  await page.evaluate(fo => {
    const barras = [...document.querySelectorAll('.sched-block[draggable="true"]')];
    const filas = [...new Set(barras.map(b => b.parentElement.parentElement))];
    window.__filas = filas;
    window.__dt = new DataTransfer();
    window.__src = filas[fo].querySelector('.sched-block[draggable="true"]');
    window.__src.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: window.__dt }));
  }, filaOrigen);
  await page.waitForTimeout(250);
  await page.evaluate(d => {
    window.__dst = d === "nuevo"
      ? [...document.querySelectorAll("div")].find(e => e.textContent.startsWith("Suelta aquí para") && e.children.length === 0)
      : window.__filas[d];
  }, destino);
  await page.evaluate(() => window.__dst.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: window.__dt })));
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    window.__dst.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: window.__dt }));
    window.__src.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: window.__dt }));
  });
}

test("de la red GTFS a los turnos, con cochera y un cambio a mano", async ({ page }) => {
  const errores = vigilarErrores(page);
  await entrarOficina(page);

  // 1) proyecto de líneas
  await page.getByText("Nuevo proyecto").first().click();
  await page.getByRole("button", { name: /^Líneas regulares/ }).click();
  await page.fill('input[placeholder="Nombre del proyecto *"]', "Líneas e2e");
  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await expect.poll(async () => (await listar("scheduling_projects")).filter(p => p.tipo === "lineas").length).toBe(1);
  const pid = (await listar("scheduling_projects")).find(p => p.tipo === "lineas")._id;
  await page.goto("/planning");

  // 2) importar la red
  const [elegir] = await Promise.all([page.waitForEvent("filechooser"), page.getByText("Importar red (GTFS .zip)").click()]);
  await elegir.setFiles({ name: "red-mini.zip", mimeType: "application/zip", buffer: gtfsMini() });
  // ventana para elegir qué se importa: todo marcado de entrada
  await expect(page.getByText(/Qué quieres importar/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Se importarán 2 líneas y 1 calendario/)).toBeVisible();
  await page.getByRole("button", { name: "Importar", exact: true }).click();
  await expect(page.getByText(/2 líneas/).first()).toBeVisible({ timeout: 60_000 });

  // 3) cochera pinchando en el mapa
  await page.getByRole("button", { name: "+ Añadir" }).click();
  const mapa = await page.locator(".leaflet-container").first().boundingBox();
  await page.mouse.click(mapa.x + mapa.width / 2, mapa.y + mapa.height / 2);
  await expect.poll(async () => ((await leer(`planning_depots/${pid}`))?.depots || []).length).toBe(1);

  // 4) Scheduling: los dos pasos
  await page.getByRole("button", { name: "Scheduling", exact: true }).first().click();
  await expect(page.getByText(/piezas de media|\d+ (partido|refuerzo|mañana|tarde|noche|sin tipo)/).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/en vacío/).first()).toBeVisible();
  await page.getByRole("button", { name: /Trabajadores/ }).first().click();
  await expect(page.locator('.sched-block[draggable="true"]').first()).toBeVisible();
  await expect(page.getByText(/^split \d+h\d\d$/).first()).toBeVisible(); // los partidos marcan su split

  // 5) mover una pieza a un turno nuevo: se guarda como cambio a mano y sobrevive a recargar
  await arrastrar(page, 0, "nuevo");
  await expect(page.getByText(/^Pieza movida a un turno nuevo/)).toBeVisible();
  await expect.poll(async () => ((await leer(`planning_settings/${pid}`))?.lineasSched?.porCalendario?.laborable?.manuales || []).length).toBe(1);
  await page.reload();
  await expect(page.getByText(/1 cambio a mano en este calendario/)).toBeVisible({ timeout: 60_000 });

  // 6) varios viajes a la vez (Ctrl+clic) a un turno nuevo, y anclar una fila arriba
  await page.getByRole("button", { name: /Trabajadores/ }).first().click();
  const bloques = page.locator('.sched-block[draggable="true"]');
  await bloques.nth(0).click({ modifiers: ["Control"] });
  await bloques.nth(1).click({ modifiers: ["Control"] });
  await expect(page.getByText(/2 viaje\(s\) elegidos/)).toBeVisible();
  await page.getByRole("button", { name: "A un turno nuevo" }).click();
  await expect(page.getByText(/^2 viajes movidos a un turno nuevo/)).toBeVisible();
  await expect.poll(async () => (((await leer(`planning_settings/${pid}`))?.lineasSched?.porCalendario?.laborable?.manuales) || []).filter(o => o.tipo === "viajesTurno").length).toBe(1);
  await page.getByTitle(/Anclar arriba/).first().click();
  await expect(page.getByText(/anclado\(s\) arriba/)).toBeVisible();

  // 7) Restricciones: borrar un número para escribir otro ya no deja un 0 guardado
  await page.getByRole("button", { name: /Restricciones/ }).first().click();
  const piezas = page.locator("div").filter({ has: page.locator("label", { hasText: /^Piezas por turno$/ }) }).last().locator("input");
  await piezas.fill("");
  await piezas.fill("1");
  await piezas.press("Enter");
  await expect(page.getByText(/Piezas por turno: 1\. Ningún turno puede juntar/)).toBeVisible();
  await piezas.fill("");
  await piezas.press("Enter");
  await expect(piezas).toHaveValue("4"); // vacío = el valor por defecto, no 0
  await expect(page.getByText(/Revisa estas restricciones/)).toBeHidden();
  expect(errores).toEqual([]);
});

test("al importar el GTFS se eligen las líneas que se quedan", async ({ page }) => {
  const errores = vigilarErrores(page);
  await entrarOficina(page);
  await page.getByText("Nuevo proyecto").first().click();
  await page.getByRole("button", { name: /^Líneas regulares/ }).click();
  await page.fill('input[placeholder="Nombre del proyecto *"]', "Solo L1");
  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await expect.poll(async () => (await listar("scheduling_projects")).filter(p => p.tipo === "lineas").length).toBe(1);
  await page.goto("/planning");
  const [elegir] = await Promise.all([page.waitForEvent("filechooser"), page.getByText("Importar red (GTFS .zip)").click()]);
  await elegir.setFiles({ name: "red-mini.zip", mimeType: "application/zip", buffer: gtfsMini() });
  await expect(page.getByText(/Qué quieres importar/)).toBeVisible({ timeout: 60_000 });
  // sin calendarios no se puede importar
  await page.getByRole("button", { name: "Ninguno", exact: true }).click();
  await expect(page.getByRole("button", { name: "Importar", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Todos", exact: true }).click();
  // solo la L1: se busca y se quitan las demás
  await page.getByRole("button", { name: "Ninguna", exact: true }).click();
  await page.getByPlaceholder(/Buscar línea/).fill("A - B");
  await page.getByRole("button", { name: "Marcar las encontradas" }).click();
  await expect(page.getByText(/Se importarán 1 línea y 1 calendario/)).toBeVisible();
  await page.getByRole("button", { name: "Importar", exact: true }).click();
  await expect(page.getByText(/1 líneas/).first()).toBeVisible({ timeout: 60_000 });
  // la tarjeta del proyecto enseña la red importada (antes decía «Sin planning»)
  await page.goto("/projects");
  await expect(page.getByText(/^1 línea · \d+ paradas$/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/1 calendario · red-mini\.zip/)).toBeVisible();
  expect(errores).toEqual([]);
});
