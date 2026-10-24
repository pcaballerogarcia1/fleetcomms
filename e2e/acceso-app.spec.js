// Recursos → Trabajadores: dar a un trabajador su usuario y contraseña de la
// app, que entre con su usuario (sin «@») y bloquearle el acceso.
import { test, expect } from "@playwright/test";
import { sembrar, listar } from "./semilla.mjs";
import { vigilarErrores, entrarOficina, entrarCampo } from "./ayudas.mjs";

test.beforeEach(async () => { await sembrar(); });

async function entrarConUsuario(page, usuario, clave) {
  await page.goto("/rutas");
  await page.fill('input[autocomplete="username"]', usuario);
  await page.fill('input[type="password"]', clave);
  await page.keyboard.press("Enter");
}

test("un trabajador recibe su usuario, entra con él y se le puede bloquear", async ({ page, browser }) => {
  const errores = vigilarErrores(page);
  await entrarOficina(page);
  await page.getByText("Abrir proyecto").first().click();
  await page.waitForURL(/\/planning/);
  await page.getByRole("button", { name: "Recursos", exact: true }).first().click();
  await page.getByRole("button", { name: /^Trabajadores/ }).first().click();
  await page.locator("div").filter({ hasText: /^Trabajador 1 Demo$/ }).first().locator("xpath=ancestor::div[.//button[@title='Editar']][1]").getByTitle("Editar").click();
  const acceso = page.getByTestId("acceso-app");
  await expect(acceso.getByText("Aún no puede entrar en la app")).toBeVisible();
  await expect(acceso.getByLabel(/Su correo/)).toHaveValue("trabajador.demo");
  await acceso.getByLabel("Contraseña").fill("Clave-2026");
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/a1-crear-acceso.png` });
  await acceso.getByRole("button", { name: "Crear su acceso" }).click();
  await expect(acceso.getByText("Dáselo a")).toBeVisible();
  await expect(acceso.getByText("puede entrar")).toBeVisible();
  if (globalThis.process.env.CAPTURAS) await page.getByText("Ficha de Trabajador 1").locator("xpath=../..").screenshot({ path: `${globalThis.process.env.CAPTURAS}/a2-acceso-creado.png` });

  const usuarios = await listar("usuarios");
  const nuevo = usuarios.find(u => u.email === "trabajador.demo@usuarios.operanzia.com");
  expect(nuevo).toMatchObject({ org_id: "demo", rol: "conductor", activo: true, nombre: "Trabajador 1" });
  const ficha = (await listar("scheduling_workers")).find(w => w.nombre === "Trabajador 1");
  expect(ficha).toMatchObject({ uid: nuevo._id, usuario: "trabajador.demo" });

  // entra en la app de campo con «trabajador.demo», sin @
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } });
  const m = await ctx.newPage();
  await entrarConUsuario(m, "trabajador.demo", "Clave-2026");
  await expect(m.getByText("Selecciona tipo de trabajo", { exact: false })).toBeVisible();
  await ctx.close();

  // se le bloquea: ya no entra y se le dice por qué
  await acceso.getByRole("button", { name: "Bloquear el acceso" }).click();
  await expect(acceso.getByText("bloqueado", { exact: true })).toBeVisible();
  await expect.poll(async () => (await listar("usuarios")).find(u => u._id === nuevo._id)?.activo).toBe(false);
  const ctx2 = await browser.newContext({ viewport: { width: 420, height: 860 } });
  const m2 = await ctx2.newPage();
  await entrarConUsuario(m2, "trabajador.demo", "Clave-2026");
  await expect(m2.getByText("Tu acceso a la app está bloqueado")).toBeVisible();
  await ctx2.close();
  expect(errores.filter(e => !/usuario-clave|404|Failed to load resource/.test(e))).toEqual([]);
});

test("cada uno puede pedir un correo para cambiar su contraseña", async ({ page }) => {
  const errores = vigilarErrores(page);
  await page.goto("/rutas");
  // sin escribir nada, o con un usuario sin correo, se le explica
  await page.getByRole("button", { name: "¿Has olvidado tu contraseña?" }).click();
  await expect(page.getByText("Escribe tu correo arriba")).toBeVisible();
  await page.fill('input[autocomplete="username"]', "trabajador.demo");
  await page.getByRole("button", { name: "¿Has olvidado tu contraseña?" }).click();
  await expect(page.getByText("Con un usuario sin correo no se puede")).toBeVisible();
  // con su correo, se manda el enlace (el emulador lo guarda)
  await page.fill('input[autocomplete="username"]', "cond1@demo.test");
  await page.getByRole("button", { name: "¿Has olvidado tu contraseña?" }).click();
  await expect(page.getByText("le llegará un correo con un enlace")).toBeVisible();
  const r = await fetch("http://127.0.0.1:9099/emulator/v1/projects/demo-operanzia/oobCodes");
  expect((await r.json()).oobCodes.some(c => c.email === "cond1@demo.test" && c.requestType === "PASSWORD_RESET")).toBe(true);
  // y desde dentro, en su menú
  await entrarCampo(page, "cond1@demo.test");
  await page.getByRole("button", { name: "Tu perfil" }).click();
  await page.getByRole("menuitem", { name: "Cambiar mi contraseña" }).click();
  await expect(page.getByText("Te hemos enviado un correo a cond1@demo.test")).toBeVisible();
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/a3-menu-cambiar.png` });
  expect(errores).toEqual([]);
});
