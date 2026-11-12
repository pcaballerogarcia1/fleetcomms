// Panel del superadmin: ver el uso de una empresa, apagarle módulos y
// funciones (y que la empresa deje de verlos), suspenderla y eliminarla con
// todos sus datos (con copia antes).
import { test, expect } from "@playwright/test";
import { sembrar, crearSuperadmin, escribir, leer, listar, CLAVE, ORG } from "./semilla.mjs";
import { vigilarErrores, entrarOficina } from "./ayudas.mjs";

async function entrarSuper(page) {
  await page.goto("/superadmin");
  await page.fill('input[type="email"], input[autocomplete="username"]', "super@demo.test");
  await page.fill('input[type="password"]', CLAVE);
  await page.keyboard.press("Enter");
  await expect(page.getByText("Panel de Control")).toBeVisible();
}
const abrirEmpresa = (page, nombre) => page.getByText(nombre, { exact: true }).first().click();
const pestana = (page, nombre) => page.getByRole("button", { name: nombre, exact: true }).click();

test("uso y módulos: lo que se apaga desaparece para la empresa", async ({ page, browser }) => {
  await sembrar();
  await crearSuperadmin();
  await escribir("incidencias/i1", { org_id: ORG, titulo: "Rueda", estado: "abierta", fecha: Date.now() });
  const errores = vigilarErrores(page);
  await entrarSuper(page);
  await abrirEmpresa(page, "Demo");
  await pestana(page, "Uso");
  await expect(page.getByText("Incidencias abiertas")).toBeVisible();
  await expect(page.getByText("Usuarios activos", { exact: true })).toBeVisible();
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/sa-1-uso.png`, fullPage: true });
  await pestana(page, "Módulos");
  await page.getByLabel(/^Control/).uncheck();
  await page.getByLabel(/^Conectar con IA/).uncheck();
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/sa-2-modulos.png`, fullPage: true });
  await page.getByRole("button", { name: "Guardar módulos" }).click();
  await expect(page.getByText("Guardado.")).toBeVisible();
  expect((await leer(`orgs/${ORG}`)).modulos).toMatchObject({ control: false, ia: false, planning: true });

  // la oficina de la empresa ya no ve Control ni «Conectar con IA»
  const otra = await browser.newPage({ baseURL: page.url().split("/superadmin")[0] });
  await entrarOficina(otra);
  await otra.getByText("Abrir proyecto").first().click();
  await otra.waitForURL(/\/planning/);
  await expect(otra.getByRole("button", { name: "Rutas", exact: true })).toBeVisible();
  await expect(otra.getByRole("button", { name: "Control", exact: true })).toHaveCount(0);
  await otra.goto("/control");
  await otra.waitForURL(u => !u.pathname.startsWith("/control"));
  await otra.getByRole("button", { name: "Tu perfil" }).click();
  await expect(otra.getByRole("menuitem", { name: "Conectar con IA" })).toHaveCount(0);
  await otra.close();
  expect(errores).toEqual([]);
});

test("suspendida: nadie de la empresa entra (ni en la oficina ni en la app)", async ({ page, browser }) => {
  await sembrar();
  await crearSuperadmin();
  await entrarSuper(page);
  await abrirEmpresa(page, "Demo");
  await page.getByRole("button", { name: "Suspendida", exact: true }).click();
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect.poll(async () => (await leer(`orgs/${ORG}`)).activo).toBe(false);
  const base = page.url().split("/superadmin")[0];
  const oficina = await browser.newPage({ baseURL: base });
  await oficina.goto("/login");
  await oficina.fill('input[autocomplete="username"]', "admin@demo.test");
  await oficina.fill('input[type="password"]', CLAVE);
  await oficina.getByRole("button", { name: "Acceder" }).click();
  await expect(oficina.getByText("Acceso suspendido")).toBeVisible();
  const app = await browser.newPage({ baseURL: base });
  await app.goto("/rutas");
  await app.fill('input[autocomplete="username"]', "cond1@demo.test");
  await app.fill('input[type="password"]', CLAVE);
  await app.keyboard.press("Enter");
  await expect(app.getByText("Acceso suspendido")).toBeVisible();
});

test("eliminar una empresa: primero suspendida, copia y confirmación; se borra todo lo suyo y nada de las demás", async ({ page }) => {
  await sembrar();
  await crearSuperadmin();
  const B = "borrable";
  await escribir(`orgs/${B}`, { nombre: "Empresa Borrable", org_id: B, activo: true, max_usuarios: 5, plan: "basic" });
  await escribir("usuarios/ub1", { org_id: B, rol: "admin", nombre: "Bea", email: "bea@borrable.test", activo: true });
  await escribir("scheduling_projects/pb1", { org_id: B, nombre: "Proyecto B" });
  await escribir("planning_layers/lb1", { projectId: "pb1", orgId: B, name: "capa" });
  await escribir("planning_layers/lb1/trozos/0_0", { projectId: "pb1", v: 0, i: 0 });
  await escribir("planning_depots/pb1", { orgId: B, depots: [] });
  await escribir("planes/plb1", { org_id: B, nombre: "Ruta B", mes: "2026-11" });
  await escribir("ia_ajustes/borrable", { org_id: B, activa: true, nivel: "leer", roles: [] });
  await escribir("incidencias/demo1", { org_id: ORG, titulo: "De Demo", estado: "abierta" });

  await entrarSuper(page);
  await abrirEmpresa(page, "Empresa Borrable");
  await pestana(page, "Eliminar");
  await expect(page.getByText("Primero, suspéndela")).toBeVisible();
  await pestana(page, "Configuración");
  await page.getByRole("button", { name: "Suspendida", exact: true }).click();
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await pestana(page, "Eliminar");
  await page.getByRole("button", { name: "1. Buscar sus datos" }).click();
  await expect(page.getByText(/Encontrados \d+ documentos \(1 proyectos/)).toBeVisible();
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/sa-3-eliminar.png`, fullPage: true });
  const [descarga] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /2\. Descargar la copia/ }).click()]);
  expect(descarga.suggestedFilename()).toMatch(/^operanzia-copia-borrable-\d{4}-\d{2}-\d{2}\.json$/);
  const copia = JSON.parse(await (await descarga.createReadStream()).toArray().then(b => globalThis.Buffer.concat(b).toString("utf8")));
  expect(copia.documentos.map(d => d.ruta)).toEqual(expect.arrayContaining(["planning_layers/lb1/trozos/0_0", "planes/plb1", "usuarios/ub1", "orgs/borrable"]));
  const borrar = page.getByRole("button", { name: "Eliminar definitivamente" });
  await expect(borrar).toBeDisabled();
  await page.getByLabel(/escribe el identificador/).fill("borrable");
  await borrar.click();
  await expect(page.getByText(/Empresa eliminada: [0-9]+ documentos borrados/)).toBeVisible();
  await expect(page.locator("textarea")).toHaveValue(/bea@borrable.test/); // su cuenta de acceso, para borrarla en Firebase
  await page.getByRole("button", { name: "Volver a la lista" }).click();
  await expect(page.getByText("Panel de Control")).toBeVisible();
  await expect(page.getByText("Empresa Borrable")).toHaveCount(0);
  expect(await leer("orgs/borrable")).toBeNull();
  for (const r of ["usuarios/ub1", "scheduling_projects/pb1", "planning_layers/lb1", "planning_layers/lb1/trozos/0_0", "planning_depots/pb1", "planes/plb1", "ia_ajustes/borrable"]) expect(await leer(r), r).toBeNull();
  expect(await leer("incidencias/demo1")).not.toBeNull(); // lo de otras empresas, intacto
  expect((await listar("usuarios")).some(u => u.org_id === ORG)).toBe(true);
});

test("horas de uso: la oficina suma su tiempo y el superadmin lo ve por persona", async ({ page, browser }) => {
  const { uids } = await sembrar();
  await crearSuperadmin();
  // la oficina, con el reloj adelantado: 6 minutos usándola (ratón cada minuto)
  const oficina = await browser.newPage({ baseURL: "http://127.0.0.1:4317" }); // la de e2e/playwright.config.js
  await oficina.clock.install();
  await entrarOficina(oficina);
  for (let i = 0; i < 6; i++) { await oficina.mouse.move(100 + i * 10, 200); await oficina.clock.runFor(60_000); }
  const mes = new Date().toISOString().slice(0, 7);
  const id = `${ORG}_${uids.admin}_${mes}`;
  await expect.poll(async () => (await leer(`uso_mes/${id}`))?.minutos ?? 0, { timeout: 15000 }).toBeGreaterThanOrEqual(5);
  expect((await leer(`uso_mes/${id}`)).oficina).toBeGreaterThanOrEqual(5);
  await oficina.close();
  // un conductor con horas de este mes, para ver la tabla
  await escribir(`uso_mes/${ORG}_${uids.cond1}_${mes}`, { org_id: ORG, uid: uids.cond1, mes, nombre: "Carlos Conductor", rol: "conductor", minutos: 135, app: 135, oficina: 0, dias: { [String(new Date().getDate())]: 135 } });
  await entrarSuper(page);
  await abrirEmpresa(page, "Demo");
  await pestana(page, "Uso");
  await expect(page.getByText("Horas de uso por persona")).toBeVisible();
  const fila = page.getByRole("row", { name: /Carlos Conductor/ });
  await expect(fila).toContainText("2 h 15 min");
  await expect(page.getByRole("row", { name: /Ana Admin/ })).toContainText(/min/);
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/sa-4-horas.png`, fullPage: true });
});

test("logo: el superadmin lo sube y sale arriba a la derecha en la oficina de la empresa", async ({ page, browser }) => {
  await sembrar();
  await crearSuperadmin();
  // un logo de ejemplo en SVG (se guarda reducido como PNG)
  const svg = globalThis.Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100"><rect x="0" y="10" width="80" height="80" rx="16" fill="#c8102e"/><text x="100" y="68" font-family="Arial" font-size="52" font-weight="700" fill="#1a1a1a">DEMO S.A.</text></svg>');
  await entrarSuper(page);
  await abrirEmpresa(page, "Demo");
  await expect(page.getByText("Sin logo")).toBeVisible();
  await page.getByLabel("Archivo del logo").setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: svg });
  await expect(page.getByRole("img", { name: "Logo de Demo" })).toBeVisible();
  await expect.poll(async () => (await leer(`orgs/${ORG}`)).logo || "").toMatch(/^data:image\/png;base64,/);
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/sa-5-logo.png` });
  const oficina = await browser.newPage({ baseURL: "http://127.0.0.1:4317" });
  await entrarOficina(oficina);
  await expect(oficina.getByRole("img", { name: "Logo de Demo" })).toBeVisible();
  if (globalThis.process.env.CAPTURAS) { await oficina.getByText("Abrir proyecto").first().click(); await oficina.waitForURL(/planning/); await oficina.screenshot({ path: `${globalThis.process.env.CAPTURAS}/sa-6-logo-oficina.png`, clip: { x: 0, y: 0, width: 1280, height: 120 } }); }
  // quitarlo
  await page.getByRole("button", { name: "Quitar" }).click();
  await expect(page.getByText("Sin logo")).toBeVisible();
  await expect(oficina.getByRole("img", { name: "Logo de Demo" })).toHaveCount(0);
});

test("con la oficina abierta, abrir el panel de superadmin en otra pestaña no echa a nadie", async ({ page }) => {
  await sembrar();
  await crearSuperadmin();
  await entrarOficina(page); // admin de la empresa
  const otra = await page.context().newPage(); // otra pestaña del mismo navegador (misma sesión)
  await otra.goto("/superadmin");
  await expect(otra.getByText("Esta cuenta no es de superadmin")).toBeVisible();
  await expect(otra.getByText("admin@demo.test")).toBeVisible();
  await page.waitForTimeout(3000);
  await page.reload();
  await page.waitForURL(/\/projects/); // sigue dentro
  await expect(page.getByRole("button", { name: "Tu perfil" })).toBeVisible();
});

test("el superadmin ve en la oficina lo mismo que la empresa con la que trabaja", async ({ page }) => {
  await sembrar();
  await crearSuperadmin();
  await escribir(`orgs/${ORG}`, { nombre: "Demo", org_id: ORG, activo: true, max_usuarios: 50, plan: "pro", modulos: { concursos: false, control: false } });
  await page.goto("/login");
  await page.fill('input[autocomplete="username"]', "super@demo.test");
  await page.fill('input[type="password"]', CLAVE);
  await page.getByRole("button", { name: "Acceder" }).click();
  await page.waitForURL(/\/projects/);
  await page.getByText("Abrir proyecto").first().click(); // un proyecto de Demo
  await page.waitForURL(/\/planning/);
  await expect(page.getByRole("button", { name: "Rutas", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Concursos", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Control", exact: true })).toHaveCount(0);
});
