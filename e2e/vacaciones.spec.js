// Vacaciones: el trabajador las pide desde la app (Mi cuadrante) y la oficina
// las aprueba en Cuadrante → Solicitudes; quedan como «V» en los dos cuadrantes.
import { test, expect } from "@playwright/test";
import { sembrar, escribir, leer, ORG } from "./semilla.mjs";
import { vigilarErrores, entrarOficina, entrarCampo } from "./ayudas.mjs";

test("pedir vacaciones en la app y aprobarlas en el Cuadrante", async ({ browser }) => {
  const { uids } = await sembrar();
  await escribir("scheduling_workers/w1", { org_id: ORG, nombre: "Carlos", apellidos: "Conductor", activo: true, uid: uids.cond1 });
  await escribir("scheduling_workers/w2", { org_id: ORG, nombre: "Lucía", apellidos: "Ruiz", activo: true });
  // dentro de unos días (siempre en el futuro), dos días seguidos
  const d0 = new Date(Date.now() + 5 * 86400000), d1 = new Date(Date.now() + 6 * 86400000);
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const y = d0.getFullYear(), m = d0.getMonth() + 1, mm = String(m).padStart(2, "0");
  await escribir(`rostering/${ORG}_${y}_${mm}/trabajadores/w2`, { org_id: ORG, year: y, month: m, grid: { [d0.getDate()]: "M", [d1.getDate()]: "M" } });

  // ── el trabajador, desde el móvil
  const movil = await (await browser.newContext({ viewport: { width: 400, height: 860 } })).newPage();
  const errMovil = vigilarErrores(movil);
  await entrarCampo(movil, "cond1@demo.test");
  await movil.getByText("Mi cuadrante").click();
  await movil.getByRole("button", { name: /Pedir días/ }).click();
  await movil.getByLabel("Desde").fill(iso(d0));
  await movil.getByLabel("Hasta").fill(iso(d1));
  await movil.getByLabel("Comentario").fill("Boda de mi hermana");
  await expect(movil.getByText("2 días", { exact: true })).toBeVisible();
  if (globalThis.process.env.CAPTURAS) await movil.screenshot({ path: `${globalThis.process.env.CAPTURAS}/vac1-pedir.png` });
  await movil.getByRole("button", { name: "Enviar solicitud" }).click();
  await expect(movil.getByText(/Solicitud enviada/)).toBeVisible();
  await expect(movil.getByText("Pendiente · 2 días")).toBeVisible();

  // ── la oficina
  const page = await (await browser.newContext()).newPage();
  const errores = vigilarErrores(page);
  await entrarOficina(page);
  await page.getByText("Abrir proyecto").first().click();
  await page.waitForURL(/\/planning/);
  await page.getByRole("button", { name: "Cuadrante", exact: true }).first().click();
  await page.getByRole("button", { name: /Solicitudes/ }).click();
  const v = page.getByRole("dialog", { name: "Solicitudes de vacaciones y permisos" });
  await expect(v.getByText("Carlos Conductor")).toBeVisible();
  await expect(v.getByText(/«Boda de mi hermana»/)).toBeVisible();
  await expect(v.getByText(/trabajan como mínimo/)).toContainText("1 compañero");
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/vac2-oficina.png` });
  await v.getByRole("button", { name: "Aprobar" }).click();
  await expect(v.getByText("No hay solicitudes pendientes.")).toBeVisible();

  await expect.poll(async () => (await leer(`rostering/${ORG}_${y}_${mm}/trabajadores/w1`))?.grid?.[d0.getDate()]).toBe("V");
  expect((await leer(`cuadrantes/${ORG}_${y}-${mm}_${uids.cond1}`))?.dias?.[d0.getDate()]).toEqual({ c: "V" });
  await expect(movil.getByText("Aprobada · 2 días")).toBeVisible();
  if (globalThis.process.env.CAPTURAS) await movil.screenshot({ path: `${globalThis.process.env.CAPTURAS}/vac3-aprobada.png` });
  const ruido = e => /Failed to load resource|ERR_|tile\.openstreetmap|api\/avisos/i.test(e);
  expect(errores.filter(e => !ruido(e))).toEqual([]);
  expect(errMovil.filter(e => !ruido(e))).toEqual([]);
});
