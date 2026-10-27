// Capturas de las pantallas de demo (para revisar el aspecto visual).
// No es una prueba: se lanza a mano con
//   CAPTURAS=carpeta npx playwright test -c e2e/playwright.config.js capturas.spec.js
import { test } from "@playwright/test";
import { sembrar } from "./semilla.mjs";
import { entrarOficina, entrarCampo, gtfsMini } from "./ayudas.mjs";

const DIR = process.env.CAPTURAS;
test.skip(!DIR, "solo a mano, con CAPTURAS=carpeta");
test.setTimeout(300_000);

function csvPuntos(n = 90) {
  const barrios = ["Centro", "Chamberí", "Salamanca", "Retiro", "Arganzuela"];
  let s = "Nombre,Lat,Lng,Barrio,Contenedor,Fracción\n";
  for (let i = 0; i < n; i++) {
    const b = i % 5, lat = 40.405 + b * 0.008 + ((i * 37) % 17) / 2500, lng = -3.715 + b * 0.006 + ((i * 53) % 19) / 2500;
    s += `Calle ${i + 1},${lat.toFixed(5)},${lng.toFixed(5)},${barrios[b]},Carga lateral 3200L,${i % 3 ? "Resto" : "Envases"}\n`;
  }
  return Buffer.from(s);
}

test("capturas", async ({ browser }) => {
  await sembrar();
  const shot = async (p, nombre) => { await p.waitForTimeout(1200); await p.screenshot({ path: `${DIR}/${nombre}.png` }); };
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 860 } })).newPage();
  page.on("dialog", d => d.accept());
  await page.goto("/login"); await shot(page, "01-login");
  await entrarOficina(page); await shot(page, "02-proyectos");
  await page.getByText("Abrir proyecto").first().click();
  await page.waitForURL(/\/planning/);
  await page.locator('input[type="file"]').nth(1).setInputFiles({ name: "puntos.csv", mimeType: "text/csv", buffer: csvPuntos() });
  await page.waitForTimeout(4000); await shot(page, "03-planning");
  await page.getByRole("button", { name: "Rutas", exact: true }).first().click();
  await page.waitForURL(/\/scheduling/); await shot(page, "04-scheduling-vacio");
  try {
    await page.getByRole("button", { name: /Importar desde Planificación/ }).click();
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: /Generar escenario/ }).first().click();
    await page.waitForTimeout(12000);
  } catch (e) { console.log("scheduling:", e.message); }
  await shot(page, "05-scheduling");
  for (const [m, r, n] of [["Cuadrante", "/rostering", "06-rostering"], ["Control", "/control", "07-control"], ["Análisis", "/analytics", "08-analytics"]]) {
    await page.getByRole("button", { name: m, exact: true }).first().click();
    await page.waitForURL(new RegExp(r)); await shot(page, n);
  }
  const movil = await (await browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2 })).newPage();
  await entrarCampo(movil, "cond1@demo.test"); await shot(movil, "09-conductor-portada");
  try {
    await movil.getByText("Mantenimiento Preventivo").click();
    await shot(movil, "10-conductor-lista");
    await movil.getByText("Ruta de prueba").first().click(); await shot(movil, "11-conductor-ruta");
  } catch (e) { console.log("conductor:", e.message); }
});

// Todas las pantallas de la app del conductor (/rutas)
test("capturas rutas", async ({ browser }) => {
  await sembrar();
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on("dialog", d => d.accept());
  const shot = async n => { await p.waitForTimeout(900); await p.screenshot({ path: `${DIR}/r-${n}.png`, fullPage: true }); };
  const paso = async (n, f) => { try { await f(); await shot(n); } catch (e) { console.log(n, e.message.split("\n")[0]); } };
  await p.goto("/rutas"); await shot("00-login");
  await entrarCampo(p, "cond1@demo.test"); await shot("01-portada");
  await paso("02-lista", () => p.getByText("Mantenimiento Preventivo").click());
  await paso("03-ruta", () => p.getByText("Ruta de prueba").first().click());
  await paso("04-parte", async () => { await p.getByRole("button", { name: /Parte/ }).first().click(); });
  await p.goto("/rutas"); await p.waitForTimeout(1500);
  await paso("05-correctivo", () => p.getByText("Mantenimiento Correctivo").click());
  await p.goto("/rutas"); await p.waitForTimeout(1500);
  await paso("06-cuadrante", () => p.getByText("Mi cuadrante").first().click());
  await p.goto("/rutas"); await p.waitForTimeout(1500);
  await paso("07-incidencias", () => p.getByRole("button", { name: /incidencias/i }).click());
  await paso("08-incidencia", () => p.getByText("Pinchazo").first().click());
  await paso("09-inventario", () => p.getByRole("button", { name: /inventario/i }).click());
  await paso("10-producto", () => p.getByText("Filtro de aceite").first().click());
  // administrador en la app
  const a = await (await browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2 })).newPage();
  await entrarCampo(a, "admin@demo.test");
  await a.screenshot({ path: `${DIR}/r-11-portada-admin.png`, fullPage: true });
  try { await a.getByRole("button", { name: /admin/i }).last().click(); await a.waitForTimeout(1200); await a.screenshot({ path: `${DIR}/r-12-admin.png`, fullPage: true }); } catch (e) { console.log("admin", e.message); }
});

// Fase 2: Rostering, Control, Analytics y las pantallas de líneas
test("capturas oficina", async ({ browser }) => {
  test.setTimeout(400_000);
  await sembrar();
  const p = await (await browser.newContext({ viewport: { width: 1440, height: 860 } })).newPage();
  p.setDefaultTimeout(10_000);
  p.on("dialog", d => d.accept());
  const shot = async n => { await p.waitForTimeout(1200); await p.screenshot({ path: `${DIR}/o-${n}.png` }); };
  const paso = async (n, f) => { try { await f(); await shot(n); } catch (e) { console.log(n, e.message.split("\n")[0]); } };
  const ir = async m => { await p.getByRole("button", { name: m, exact: true }).first().click(); await p.waitForTimeout(800); };
  await entrarOficina(p);
  await p.getByText("Abrir proyecto").first().click();
  await p.waitForURL(/\/planning/);
  await p.locator('input[type="file"]').nth(1).setInputFiles({ name: "puntos.csv", mimeType: "text/csv", buffer: csvPuntos() });
  await p.waitForTimeout(3000);
  await ir("Rutas");
  try { await p.getByRole("button", { name: /Importar desde Planificación/ }).click(); await p.waitForTimeout(2000); await p.getByRole("button", { name: /Generar escenario/ }).first().click(); await p.waitForTimeout(12000); } catch (e) { console.log(e.message); }
  await paso("01-restricciones", () => p.getByRole("button", { name: /Restricciones/ }).first().click());
  await p.keyboard.press("Escape"); await p.getByRole("button", { name: /Restricciones/ }).first().click().catch(() => {});
  await paso("02-indicadores", () => p.getByRole("button", { name: /Todos los indicadores/ }).first().click());
  await p.getByRole("button", { name: /Todos los indicadores/ }).first().click().catch(() => {});
  await paso("03-publicar", () => p.getByRole("button", { name: /Enviar a conductores/ }).first().click());
  await p.keyboard.press("Escape");
  await p.goto("/scheduling"); await p.waitForTimeout(2500);
  await paso("04-rostering", () => ir("Cuadrante"));
  await paso("05-rostering-vehiculos", () => p.getByRole("button", { name: "Vehículos", exact: true }).first().click());
  await paso("06-control", () => ir("Control"));
  await paso("07-control-flota", () => p.getByRole("button", { name: /flota/i }).first().click());
  await paso("08-analytics", () => ir("Análisis"));
  for (const [n, t] of [["09-an-pesadas", "Pesadas"], ["10-an-personal", "Personal"], ["11-an-varios", "Varios"]]) await paso(n, () => p.getByRole("button", { name: t, exact: true }).first().click());
  await paso("13-timetable", () => p.getByText("Horarios", { exact: true }).first().click());
  // líneas
  await p.goto("/projects"); await p.waitForTimeout(1500);
  await p.getByText("Nuevo proyecto").first().click();
  await shot("14-nuevo-proyecto");
  await p.getByRole("button", { name: /^Líneas regulares/ }).click();
  await p.fill('input[placeholder="Nombre del proyecto *"]', "Líneas demo");
  await p.getByRole("button", { name: "Crear proyecto" }).click();
  await p.waitForTimeout(2000);
  await p.goto("/planning"); await p.waitForTimeout(2500);
  await shot("15-lineas-vacio");
  const [elegir] = await Promise.all([p.waitForEvent("filechooser"), p.getByText("Importar red (GTFS .zip)").click()]);
  await elegir.setFiles({ name: "red-mini.zip", mimeType: "application/zip", buffer: gtfsMini() });
  await p.getByText(/Qué quieres importar/).waitFor({ timeout: 60_000 }); await shot("16-importar-gtfs");
  await p.getByRole("button", { name: "Importar", exact: true }).click();
  await p.getByText(/2 líneas/).first().waitFor({ timeout: 60_000 });
  await shot("17-lineas-red");
  await p.getByRole("button", { name: "+ Añadir" }).click().catch(() => {});
  const mapa = await p.locator(".leaflet-container").first().boundingBox();
  await p.mouse.click(mapa.x + mapa.width / 2, mapa.y + mapa.height / 2); await p.waitForTimeout(1500);
  for (const [n, t] of [["18-lin-horarios", "Horarios de salida"], ["19-lin-relevos", "Puntos de relevo"], ["20-lin-vacios", "Vacíos"], ["21-lin-flota", "Flota"]]) await paso(n, () => p.getByText(t, { exact: true }).first().click());
  await ir("Rutas");
  await p.getByText(/piezas de media|\d+ (partido|refuerzo|mañana|tarde|noche|sin tipo)/).first().waitFor({ timeout: 60_000 }).catch(() => {});
  await shot("22-lin-sched");
  await paso("23-lin-sched-turnos", () => p.getByRole("button", { name: /Trabajadores/ }).first().click());
  await paso("24-lin-restricciones", () => p.getByRole("button", { name: /Restricciones/ }).first().click());
  await p.getByRole("button", { name: /Restricciones/ }).first().click().catch(() => {});
  await paso("25-lin-calendarios", () => p.getByText("Calendarios", { exact: true }).first().click());
  await paso("26-lin-rostering", () => ir("Cuadrante"));
  await paso("27-lin-control", () => ir("Control"));
  await paso("28-lin-analytics", () => ir("Análisis"));
});
