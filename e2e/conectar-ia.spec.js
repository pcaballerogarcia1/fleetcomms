// Conectar con IA: el admin lo activa desde el menú de su foto; luego, la
// página de permiso que abre la IA (/conectar-ia): entrar, ver qué podrá
// hacer y «Permitir» (el servidor de la IA se simula: aquí no hay /api).
import { test, expect } from "@playwright/test";
import { sembrar, leer, listar, escribir, CLAVE, ORG } from "./semilla.mjs";
import { vigilarErrores, entrarOficina } from "./ayudas.mjs";

const VUELTA = "https://ia.example/callback";
const PETICION = `/conectar-ia?response_type=code&client_id=cli-123&redirect_uri=${encodeURIComponent(VUELTA)}&code_challenge=reto&code_challenge_method=S256&state=xyz`;

async function simularServidor(page, pedidas) {
  await page.route("**/api/oauth?*", async route => {
    const u = new URL(route.request().url());
    if (u.searchParams.get("accion") === "cliente") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ nombre: "ChatGPT" }) });
    pedidas.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ redirect: `${VUELTA}?code=abc&state=xyz` }) });
  });
  await page.route("https://ia.example/**", route => route.fulfill({ status: 200, contentType: "text/html", body: "<h1>De vuelta en la IA</h1>" }));
}

test("el admin activa «Conectar con IA» y ve la dirección; un jefe lo conecta", async ({ page }) => {
  await sembrar();
  const errores = vigilarErrores(page);
  await entrarOficina(page);
  await page.getByRole("button", { name: "Tu perfil" }).click();
  await page.getByRole("menuitem", { name: "Conectar con IA" }).click();
  const ventana = page.getByRole("dialog", { name: "Conectar con IA" });
  await expect(ventana.getByText("Tu empresa no tiene activado")).toBeVisible();
  await ventana.getByLabel("Permitir conectar la IA con Operanzia").check();
  await ventana.getByLabel(/Consultar y hacer cambios/).check();
  await ventana.getByLabel(/Permitir preguntar dónde está/).check();
  await ventana.getByRole("button", { name: "Guardar" }).click();
  await expect(ventana.getByText(/Guardado/)).toBeVisible();
  await expect(ventana.getByLabel("Dirección MCP de Operanzia")).toHaveValue(/\/mcp$/);
  expect(await leer(`ia_ajustes/${ORG}`)).toMatchObject({ org_id: ORG, activa: true, nivel: "actuar", roles: ["admin", "intermedio"], ubicacion: true });
  await ventana.getByRole("button", { name: "Cerrar" }).click();
  await expect(ventana).toBeHidden();

  // la página de permiso, como la abriría ChatGPT: sin sesión, pide entrar
  await page.getByRole("button", { name: "Tu perfil" }).click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await page.waitForURL(/\/login/);
  const pedidas = [];
  await simularServidor(page, pedidas);
  await page.goto(PETICION);
  await expect(page.getByText("Entra con tu cuenta de Operanzia para conectar")).toBeVisible();
  await page.getByLabel("Email o usuario").fill("jefe@demo.test");
  await page.getByLabel("Contraseña").fill(CLAVE);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("ChatGPT quiere conectarse a Operanzia")).toBeVisible();
  await expect(page.getByText("Pasar los pedidos no entregados a otro día")).toBeVisible();
  await expect(page.getByText("Ver dónde está cada conductor y vehículo en jornada")).toBeVisible();
  await page.getByRole("button", { name: "Permitir" }).click();
  await expect(page.getByRole("heading", { name: "De vuelta en la IA" })).toBeVisible();
  expect(page.url()).toBe(`${VUELTA}?code=abc&state=xyz`);
  expect(pedidas[0]).toMatchObject({ client_id: "cli-123", redirect_uri: VUELTA, code_challenge: "reto", state: "xyz", sesion: expect.any(String) });
  expect(errores).toEqual([]);
});

test("un conductor, si su empresa no lo deja, ve el motivo y no puede permitir", async ({ page }) => {
  await sembrar();
  await escribir(`ia_ajustes/${ORG}`, { org_id: ORG, activa: true, nivel: "leer", roles: ["admin", "intermedio"] });
  await simularServidor(page, []);
  await page.goto(PETICION);
  await page.getByLabel("Email o usuario").fill("cond1@demo.test");
  await page.getByLabel("Contraseña").fill(CLAVE);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("Tu empresa no permite conectar la IA a tu tipo de usuario.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Permitir" })).toHaveCount(0);
  await page.getByRole("button", { name: "Volver a la IA" }).click();
  await page.waitForURL(/ia\.example/);
  expect(page.url()).toContain("error=access_denied");
});

test("las conexiones: el admin las ve todas y las desconecta", async ({ page }) => {
  await sembrar();
  await escribir(`ia_ajustes/${ORG}`, { org_id: ORG, activa: true, nivel: "leer", roles: ["admin", "intermedio"] });
  const ahora = new Date().toISOString();
  await escribir("ia_conexiones/c1", { org_id: ORG, uid: "otro", nombre: "Iván Intermedio", rol: "intermedio", cliente: "Claude", nivel: "leer", activa: true, creado: ahora, ultimoUso: ahora });
  await entrarOficina(page);
  await page.getByRole("button", { name: "Tu perfil" }).click();
  await page.getByRole("menuitem", { name: "Conectar con IA" }).click();
  const ventana = page.getByRole("dialog", { name: "Conectar con IA" });
  await expect(ventana.getByText("Claude", { exact: true })).toBeVisible();
  await expect(ventana.getByText("· Iván Intermedio")).toBeVisible();
  page.once("dialog", d => d.accept());
  await ventana.getByRole("button", { name: "Desconectar" }).click();
  await expect(ventana.getByText(/Desconectada/)).toBeVisible();
  await expect.poll(async () => (await listar("ia_conexiones")).find(c => c._id === "c1")?.activa).toBe(false);
});
