// Contraseña: cambiarla desde el menú de la foto (la actual y la nueva) y
// ponerla nueva con el enlace del correo, en la página de Operanzia.
import { test, expect } from "@playwright/test";
import { sembrar, CLAVE } from "./semilla.mjs";
import { vigilarErrores, entrarOficina, entrarCampo } from "./ayudas.mjs";

const OOB = "http://127.0.0.1:9099/emulator/v1/projects/demo-operanzia/oobCodes";

test("desde el menú: la actual mal, una nueva floja y, al final, cambiada", async ({ page }) => {
  await sembrar();
  const errores = vigilarErrores(page);
  await entrarOficina(page);
  await page.getByRole("button", { name: "Tu perfil" }).click();
  await page.getByRole("menuitem", { name: "Cambiar mi contraseña" }).click();
  const v = page.getByRole("dialog", { name: "Cambiar mi contraseña" });
  await v.getByLabel("Contraseña actual").fill("no-es-esta-1");
  await v.getByLabel("Contraseña nueva", { exact: true }).fill("password1");
  await expect(v.getByText("Que no sea una de las típicas")).toBeVisible();
  await v.getByLabel("Contraseña nueva", { exact: true }).fill("Camion-azul-27");
  await expect(v.getByText(/Seguridad: (Buena|Muy buena)/)).toBeVisible();
  await v.getByLabel("Repite la contraseña nueva").fill("Camion-azul-2");
  await expect(v.getByText("No coinciden")).toBeVisible();
  await v.getByLabel("Repite la contraseña nueva").fill("Camion-azul-27");
  await v.getByRole("button", { name: "Cambiar contraseña" }).click();
  await expect(v.getByText("La contraseña actual no es correcta.")).toBeVisible();
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/clave-1-menu.png` });
  await v.getByLabel("Contraseña actual").fill(CLAVE);
  await v.getByRole("button", { name: "Cambiar contraseña" }).click();
  await expect(v.getByText("Listo: tu contraseña ha cambiado.")).toBeVisible();
  await v.getByRole("button", { name: "Cerrar", exact: true }).first().click();
  // sale y vuelve a entrar con la nueva
  await page.getByRole("button", { name: "Tu perfil" }).click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await page.waitForURL(/\/login/);
  await page.fill('input[autocomplete="username"]', "admin@demo.test");
  await page.fill('input[type="password"]', "Camion-azul-27");
  await page.getByRole("button", { name: "Acceder" }).click();
  await page.waitForURL(/\/projects/);
  expect(errores.filter(e => !/auth\/(invalid-credential|wrong-password)|400/.test(e))).toEqual([]);
});

test("con el enlace del correo: la página de Operanzia, y entra directamente en su app", async ({ page }) => {
  await sembrar();
  const errores = vigilarErrores(page);
  await page.goto("/rutas");
  await page.fill('input[autocomplete="username"]', "cond1@demo.test");
  await page.getByRole("button", { name: "¿Has olvidado tu contraseña?" }).click();
  await expect(page.getByText("le llegará un correo con un enlace")).toBeVisible();
  const codigos = (await (await fetch(OOB)).json()).oobCodes.filter(c => c.email === "cond1@demo.test" && c.requestType === "PASSWORD_RESET");
  const enlace = new URL(codigos.at(-1).oobLink);
  // el enlace del emulador va a su propia página; se abre la nuestra con lo mismo (como hará con la «URL de acción» puesta en Firebase)
  const continuar = enlace.searchParams.get("continueUrl") || "";
  await page.goto(`/cuenta/clave?mode=resetPassword&oobCode=${enlace.searchParams.get("oobCode")}&continueUrl=${encodeURIComponent(continuar)}`);
  await expect(page.getByRole("heading", { name: "Contraseña nueva" })).toBeVisible();
  await expect(page.getByText("cond1@demo.test")).toBeVisible();
  await page.getByLabel("Contraseña nueva", { exact: true }).fill("Ruta-larga-2027");
  await page.getByLabel("Repite la contraseña nueva").fill("Ruta-larga-2027");
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/clave-2-enlace.png` });
  await page.getByRole("button", { name: "Guardar y entrar" }).click();
  await page.waitForURL(/\/rutas/);
  await expect(page.getByText("Selecciona tipo de trabajo", { exact: false })).toBeVisible();
  // el mismo enlace ya no vale
  await page.goto(`/cuenta/clave?mode=resetPassword&oobCode=${enlace.searchParams.get("oobCode")}`);
  await expect(page.getByText(/ya se ha usado o no es válido|ha caducado/)).toBeVisible();
  expect(errores.filter(e => !/400|invalid-action-code|INVALID_OOB_CODE/.test(e))).toEqual([]);
});

test("la nueva también entra en la app del conductor", async ({ page }) => {
  await sembrar();
  await entrarCampo(page, "cond2@demo.test");
  await page.getByRole("button", { name: "Tu perfil" }).click();
  await page.getByRole("menuitem", { name: "Cambiar mi contraseña" }).click();
  const v = page.getByRole("dialog", { name: "Cambiar mi contraseña" });
  await v.getByLabel("Contraseña actual").fill(CLAVE);
  await v.getByLabel("Contraseña nueva", { exact: true }).fill("Bus-nocturno-44");
  await v.getByLabel("Repite la contraseña nueva").fill("Bus-nocturno-44");
  await v.getByRole("button", { name: "Cambiar contraseña" }).click();
  await expect(v.getByText("Listo: tu contraseña ha cambiado.")).toBeVisible();
});
