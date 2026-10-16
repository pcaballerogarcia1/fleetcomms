// Foto de perfil: el conductor (móvil) y la oficina se ponen foto desde su
// círculo de la cabecera; se guarda en su perfil y sigue al volver a entrar.
/* global Buffer, process */
import { test, expect } from "@playwright/test";
import { sembrar } from "./semilla.mjs";
import { entrarCampo, entrarOficina, vigilarErrores } from "./ayudas.mjs";

// PNG de 1 × 1 rojo
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

test("el conductor se pone foto en el móvil, sigue al volver y se puede quitar", async ({ browser }) => {
  await sembrar();
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 } });
  const page = await ctx.newPage();
  const errores = vigilarErrores(page);
  await entrarCampo(page, "cond1@demo.test");
  const circulo = page.getByRole("button", { name: "Tu perfil" });
  await expect(circulo).toHaveText("CC");
  await circulo.click();
  await expect(page.getByRole("menuitem", { name: "Poner foto" })).toBeVisible();
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: "yo.png", mimeType: "image/png", buffer: PNG });
  await expect(circulo.locator("img")).toHaveAttribute("src", /^data:image\/jpeg/);
  if (process.env.CAPTURAS) { await circulo.click(); await page.screenshot({ path: `${process.env.CAPTURAS}/foto-movil.png` }); await page.keyboard.press("Escape"); }
  await page.reload();
  await expect(page.getByRole("button", { name: "Tu perfil" }).locator("img")).toBeVisible();
  await page.getByRole("button", { name: "Tu perfil" }).click();
  await page.getByRole("menuitem", { name: "Quitar foto" }).click();
  await expect(page.getByRole("button", { name: "Tu perfil" })).toHaveText("CC");
  expect(errores).toEqual([]);
});

test("en la oficina, el círculo abre el menú con la foto y cerrar sesión", async ({ page }) => {
  await sembrar();
  await entrarOficina(page);
  await page.getByRole("button", { name: "Tu perfil" }).click();
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: "yo.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByRole("button", { name: "Tu perfil" }).locator("img")).toBeVisible();
  await page.getByRole("button", { name: "Tu perfil" }).click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await page.waitForURL(/\/login/);
});
