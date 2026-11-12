// Prueba de carga de líneas (no va con las pruebas normales): la app entera en
// el navegador con una red real de ~465 autobuses (bench/red450.mjs), como lo
// haría un operador grande. Cronometra cada paso y anota memoria, lo que tarda
// la pantalla en responder y las lecturas/escrituras de Firestore. Informe en
// e2e/informe-carga-lineas.md.
//
//   node bench/red450.mjs
//   npx firebase emulators:exec --only auth,firestore --project demo-operanzia "node e2e/compilar.mjs --medir && npx playwright test -c e2e/carga.config.js"
//   LENTO=4 simula un portátil 4 veces más lento
/* global process */
import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { sembrar, listar } from "./semilla.mjs";
import { entrarOficina } from "./ayudas.mjs";

const pasos = [];
const LENTO = Number(process.env.LENTO || 1);

async function medir(page, nombre, accion) {
  await page.evaluate(() => { globalThis.__firestoreUsoTomar?.(); globalThis.__largas = 0; globalThis.__maxLarga = 0; });
  const t0 = Date.now();
  await accion();
  const seg = (Date.now() - t0) / 1000;
  await page.waitForTimeout(1500);
  const uso = await page.evaluate(() => globalThis.__firestoreUsoTomar?.() || null);
  const suma = o => Object.values(o || {}).reduce((s, n) => s + n, 0);
  const mem = await page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null));
  const congelada = await page.evaluate(() => ({ n: globalThis.__largas, max: globalThis.__maxLarga }));
  pasos.push({ nombre, seg: +seg.toFixed(1), memMB: mem, bloqueos: congelada.n, peorBloqueoSeg: +(congelada.max / 1000).toFixed(1), lecturas: suma(uso?.lecturas), escrituras: suma(uso?.escrituras) });
  console.log(JSON.stringify(pasos.at(-1)));
}

test("465 autobuses: importar, generar, turnos, publicar y Control", async ({ page }) => {
  test.setTimeout(30 * 60_000);
  await sembrar();
  if (LENTO > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: LENTO });
  }
  // las tareas largas: cuánto tiempo se queda la pantalla sin responder
  await page.addInitScript(() => {
    globalThis.__largas = 0; globalThis.__maxLarga = 0;
    try {
      new PerformanceObserver(l => { for (const e of l.getEntries()) { globalThis.__largas++; globalThis.__maxLarga = Math.max(globalThis.__maxLarga, e.duration); } }).observe({ type: "longtask", buffered: true });
    } catch { /* sin longtask */ }
  });
  const zip = readFileSync(new URL("../bench/resultados/red450.zip", import.meta.url));

  await medir(page, "Entrar en la oficina", () => entrarOficina(page));
  await medir(page, "Crear el proyecto de líneas", async () => {
    await page.getByText("Nuevo proyecto").first().click();
    await page.getByRole("button", { name: /^Líneas regulares/ }).click();
    await page.fill('input[placeholder="Nombre del proyecto *"]', "Operador grande");
    await page.getByRole("button", { name: "Crear proyecto" }).click();
    await expect.poll(async () => (await listar("scheduling_projects")).filter(p => p.tipo === "lineas").length).toBe(1);
    await page.goto("/planning");
  });
  await medir(page, "Leer el GTFS (21 MB, 93 líneas)", async () => {
    const [elegir] = await Promise.all([page.waitForEvent("filechooser"), page.getByText("Importar red (GTFS .zip)").click()]);
    await elegir.setFiles({ name: "red450.zip", mimeType: "application/zip", buffer: zip });
    await expect(page.getByText(/Qué quieres importar/)).toBeVisible({ timeout: 600_000 });
  });
  await medir(page, "Importar la red y verla en el mapa", async () => {
    await page.getByRole("button", { name: "Importar", exact: true }).click();
    await expect(page.getByText(/93 líneas/).first()).toBeVisible({ timeout: 600_000 });
  });
  await medir(page, "Rutas: generar los autobuses (paso 1)", async () => {
    await page.getByRole("button", { name: "Rutas", exact: true }).first().click();
    await expect(page.getByText(/piezas de media|\d+ (partido|refuerzo|mañana|tarde|noche|sin tipo)/).first()).toBeVisible({ timeout: 600_000 });
  });
  await page.screenshot({ path: "e2e/carga-lineas-1.png" });
  await medir(page, "Rutas: turnos de conductor (paso 2)", async () => {
    await page.getByRole("button", { name: /Trabajadores/ }).first().click();
    await expect(page.locator('.sched-block[draggable="true"]').first()).toBeVisible({ timeout: 600_000 });
  });
  await page.screenshot({ path: "e2e/carga-lineas-2.png" });
  await medir(page, "Rutas: desplazarse por el Gantt", async () => {
    for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 1500); await page.waitForTimeout(150); }
  });
  await medir(page, "Publicar a Control (hoy)", async () => {
    await page.getByRole("button", { name: "Publicar a Control" }).click();
    const hoy = page.getByRole("button", { name: "Hoy", exact: true });
    if (await hoy.count()) await hoy.click();
    await page.getByRole("button", { name: "Publicar", exact: true }).click();
    await expect(page.getByText(/✓ Publicado el/)).toBeVisible({ timeout: 600_000 });
  });
  const servicios = await listar("servicio_lineas");
  const turnosPublicados = servicios[0]?.resumen?.turnos ?? "?"; // (listar solo trae la primera página)
  await medir(page, "Control: ver el día en marcha", async () => {
    await page.getByRole("button", { name: "Ver en Control" }).click();
    await expect(page.getByText("Turnos en marcha")).toBeVisible({ timeout: 600_000 });
  });
  await page.screenshot({ path: "e2e/carga-lineas-3.png" });
  await medir(page, "Volver a abrir la app (recargar) y Rutas", async () => {
    await page.reload();
    await page.getByRole("button", { name: "Rutas", exact: true }).first().click();
    await expect(page.getByText(/piezas de media|\d+ (partido|refuerzo|mañana|tarde|noche|sin tipo)/).first()).toBeVisible({ timeout: 600_000 });
  });
  await medir(page, "Cuadrante", async () => {
    await page.getByRole("button", { name: "Cuadrante", exact: true }).first().click();
    await page.waitForTimeout(3000);
  });

  const total = pasos.reduce((s, p) => ({ l: s.l + p.lecturas, e: s.e + p.escrituras }), { l: 0, e: 0 });
  const filas = pasos.map(p => `| ${p.nombre} | ${p.seg} s | ${p.peorBloqueoSeg} s | ${p.lecturas} | ${p.escrituras} |`).join("\n");
  writeFileSync("e2e/informe-carga-lineas.md", `# Carga de líneas: ~465 autobuses${LENTO > 1 ? ` (CPU ${LENTO}× más lenta)` : ""}

Red: 93 líneas reales (corredores del GTFS interurbano de Madrid), ${turnosPublicados} turnos publicados.

| Paso | Tiempo | Peor bloqueo de la pantalla | Lecturas | Escrituras |
|---|---|---|---|---|
${filas}
| **Total** | | | **${total.l}** | **${total.e}** |
`);
});
