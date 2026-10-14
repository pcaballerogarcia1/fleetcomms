// Capturas de las pantallas de demo (para revisar el aspecto visual).
// No es una prueba: se lanza a mano con
//   CAPTURAS=carpeta npx playwright test -c e2e/playwright.config.js capturas.spec.js
import { test } from "@playwright/test";
import { sembrar } from "./semilla.mjs";
import { entrarOficina, entrarCampo } from "./ayudas.mjs";

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
  await page.getByRole("button", { name: "Scheduling", exact: true }).first().click();
  await page.waitForURL(/\/scheduling/); await shot(page, "04-scheduling-vacio");
  try {
    await page.getByRole("button", { name: /Importar desde Planning/ }).click();
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: /Generar escenario/ }).first().click();
    await page.waitForTimeout(12000);
  } catch (e) { console.log("scheduling:", e.message); }
  await shot(page, "05-scheduling");
  for (const [m, r, n] of [["Rostering", "/rostering", "06-rostering"], ["Control", "/control", "07-control"], ["Analytics", "/analytics", "08-analytics"]]) {
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
