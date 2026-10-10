// Líneas regulares contra los emuladores: crear el proyecto, importar una red
// GTFS pequeña, poner una cochera, generar vehículos y turnos, y mover una
// pieza a mano (que se guarda).
import { test, expect } from "@playwright/test";
import { sembrar, listar, leer, CLAVE } from "./semilla.mjs";
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

test("cambiar una hora de salida en Planning: la usa el Scheduling y avisa del cambio", async ({ page }) => {
  const errores = vigilarErrores(page);
  await entrarOficina(page);
  await page.getByText("Nuevo proyecto").first().click();
  await page.getByRole("button", { name: /^Líneas regulares/ }).click();
  await page.fill('input[placeholder="Nombre del proyecto *"]', "Horarios");
  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await expect.poll(async () => (await listar("scheduling_projects")).filter(p => p.tipo === "lineas").length).toBe(1);
  const pid = (await listar("scheduling_projects")).find(p => p.tipo === "lineas")._id;
  await page.goto("/planning");
  const [elegir] = await Promise.all([page.waitForEvent("filechooser"), page.getByText("Importar red (GTFS .zip)").click()]);
  await elegir.setFiles({ name: "red-mini.zip", mimeType: "application/zip", buffer: gtfsMini() });
  await page.getByRole("button", { name: "Importar", exact: true }).click();
  await expect(page.getByText(/2 líneas/).first()).toBeVisible({ timeout: 60_000 });
  // primero se calcula el Scheduling (para que haya un escenario anterior al cambio)
  await page.getByRole("button", { name: "Scheduling", exact: true }).first().click();
  await expect(page.getByText(/194 viajes/).first()).toBeVisible({ timeout: 60_000 });
  // Planning → Horarios de salida: la de las 06:00 de la ida de la L1 pasa a las 05:45, y se quita otra
  await page.getByRole("button", { name: "Planning", exact: true }).first().click();
  await page.getByRole("button", { name: "Horarios de salida" }).click();
  await page.getByTitle(/^06:00 · pincha/).first().click();
  const caja = page.locator("td input").first(); // la caja de la hora que se está cambiando
  await caja.fill("05:45");
  await caja.press("Enter");
  await expect(page.getByText(/Cambiado a mano en Planning/).first()).toBeVisible();
  await page.getByTitle(/^06:20 · pincha/).first().click();
  await page.getByRole("button", { name: "Quitar", exact: true }).click();
  await expect.poll(async () => Object.keys((await leer(`planning_settings/${pid}`))?.lineasCfg?.L1?.salidas || {}).length).toBe(1);
  // el tiempo de recorrido, pinchando en la columna RECORRIDO
  await page.getByTitle(/Pincha para cambiar el tiempo de recorrido de la franja 06–09/).first().click();
  const minutos = page.locator("td input").first();
  await minutos.fill("31");
  await minutos.press("Enter");
  await expect.poll(async () => (await leer(`planning_settings/${pid}`))?.lineasCfg?.L1?.tiempos?.["0|06-09"]).toBe(31);
  // puntos de relevo: sin relevo en la parada B
  await page.getByRole("button", { name: "Puntos de relevo" }).click();
  await expect(page.getByText(/Se puede relevar en 4 de 4 cabeceras/)).toBeVisible();
  await page.locator("label").filter({ hasText: "Parada B" }).locator("input").uncheck();
  await expect(page.getByText(/Se puede relevar en 3 de 4 cabeceras/)).toBeVisible();
  await expect.poll(async () => (await leer(`planning_settings/${pid}`))?.lineasCfg?._relevos?.no || []).toContain("B");
  // el Scheduling avisa y usa las horas nuevas (un viaje menos)
  await page.getByRole("button", { name: "Scheduling", exact: true }).first().click();
  await expect(page.getByText(/Se ha modificado el Planning/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/193 viajes/).first()).toBeVisible({ timeout: 60_000 });
  // y el escenario está recalculado de verdad (el indicador de viajes, no solo el rótulo de arriba)
  await expect(page.getByText("193", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Entendido" }).click();
  await expect(page.getByText(/Se ha modificado el Planning/)).toBeHidden();
  expect(errores).toEqual([]);
});


test("publicar a Control: la oficina lo sigue y el conductor coge y empieza su turno en el móvil", async ({ page, browser }) => {
  const errores = vigilarErrores(page);
  await entrarOficina(page);
  await page.getByText("Nuevo proyecto").first().click();
  await page.getByRole("button", { name: /^Líneas regulares/ }).click();
  await page.fill('input[placeholder="Nombre del proyecto *"]', "Bus e2e");
  await page.getByRole("button", { name: "Crear proyecto" }).click();
  await expect.poll(async () => (await listar("scheduling_projects")).filter(p => p.tipo === "lineas").length).toBe(1);
  const pid = (await listar("scheduling_projects")).find(p => p.tipo === "lineas")._id;
  await page.goto("/planning");
  const [elegir] = await Promise.all([page.waitForEvent("filechooser"), page.getByText("Importar red (GTFS .zip)").click()]);
  await elegir.setFiles({ name: "red-mini.zip", mimeType: "application/zip", buffer: gtfsMini() });
  await page.getByRole("button", { name: "Importar", exact: true }).click({ timeout: 60_000 });
  await expect(page.getByText(/2 líneas/).first()).toBeVisible({ timeout: 60_000 });

  // Control antes de publicar: explica qué hacer
  await page.getByRole("button", { name: "Control", exact: true }).first().click();
  await expect(page.getByText("Aún no hay ningún día publicado")).toBeVisible({ timeout: 30_000 });

  // Scheduling → paso 2 → Publicar a Control para hoy
  await page.getByRole("button", { name: "Scheduling", exact: true }).first().click();
  await page.getByRole("button", { name: /Trabajadores/ }).first().click();
  await expect(page.locator('.sched-block[draggable="true"]').first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Publicar a Control" }).click();
  const hoy = page.getByRole("button", { name: "Hoy", exact: true });
  if (await hoy.count()) await hoy.click();
  await page.getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(page.getByText(/✓ Publicado el/)).toBeVisible({ timeout: 30_000 });
  const servicios = (await listar("servicio_lineas")).filter(s => s.projectId === pid);
  expect(servicios).toHaveLength(1);
  const sid = servicios[0]._id;
  const turnos = await listar(`servicio_lineas/${sid}/turnos`);
  expect(turnos.length).toBe(servicios[0].resumen.turnos);
  await page.getByRole("button", { name: "Ver en Control" }).click();
  await expect(page.getByText("Turnos en marcha")).toBeVisible();
  await expect(page.getByText(new RegExp(`^0/${turnos.length}$`))).toBeVisible();

  // El conductor, en el móvil: «Mi turno», coge el T1 y lo empieza
  const movil = await browser.newContext({ viewport: { width: 400, height: 820 }, isMobile: true, permissions: ["geolocation"], geolocation: { latitude: 40.40, longitude: -3.70 } });
  const m = await movil.newPage();
  const erroresMovil = vigilarErrores(m);
  m.on("dialog", d => d.accept());
  await m.goto("/rutas");
  await m.fill('input[type="email"]', "cond1@demo.test");
  await m.fill('input[type="password"]', CLAVE);
  await m.keyboard.press("Enter");
  await expect(m.getByText("¿Qué turno haces hoy?")).toBeVisible({ timeout: 30_000 });
  await m.getByRole("button", { name: "Coger" }).first().click();
  await expect(m.getByRole("button", { name: "Empezar turno" })).toBeVisible();
  await m.getByRole("button", { name: "Empezar turno" }).click();
  await expect(m.getByRole("button", { name: "Terminar turno" })).toBeVisible();
  await expect.poll(async () => (await leer(`servicio_lineas/${sid}/turnos/T1`))?.inicioReal ?? null).not.toBe(null);
  expect(await leer(`servicio_lineas/${sid}/turnos/T1`)).toMatchObject({ conductorNombre: "Carlos Conductor", conductorUid: expect.any(String) });
  // manda su posición (el navegador de pruebas da una fija)
  await expect.poll(async () => (await listar("ubicaciones_lineas")).filter(u => u.turnoId === "T1" && u.activo).length, { timeout: 30_000 }).toBe(1);

  // y la oficina lo ve en marcha
  await expect(page.getByText(new RegExp(`^1/${turnos.length}$`))).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /^T1 Carlos Conductor/ }).click();
  await expect(page.getByText(/Empezó \d\d:\d\d/)).toBeVisible();
  await page.getByRole("button", { name: "Informe del día" }).click();
  await expect(page.getByRole("button", { name: "Descargar Excel" })).toBeVisible();

  await m.getByRole("button", { name: "Terminar turno" }).click();
  await expect(m.getByText(/Turno terminado/)).toBeVisible();
  await movil.close();
  expect(errores).toEqual([]);
  expect(erroresMovil).toEqual([]);
});
