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
