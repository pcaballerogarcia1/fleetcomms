// Análisis → Realizado: una ruta publicada con lo previsto, dos de tres
// paradas hechas y el fichaje del conductor.
import { test, expect } from "@playwright/test";
import { sembrar, escribir, ORG } from "./semilla.mjs";
import { vigilarErrores, entrarOficina } from "./ayudas.mjs";

test("realizado frente a planificado del mes", async ({ page }) => {
  const { uids } = await sembrar();
  const hoy = new Date(), y = hoy.getFullYear(), m = hoy.getMonth() + 1;
  const mes = `${y}-${String(m).padStart(2, "0")}`, fecha = `${mes}-03`;
  const a = (h, mi = 0) => new Date(y, m - 1, 3, h, mi).getTime();
  await escribir("planes/ruta-real", {
    org_id: ORG, tipo: "prev", nombre: "Camión 7 · Día 03", mes, diaNum: 3, diaServicio: "Día 03", vehiculoNombre: "Camión 7", conductorNombre: "Carlos Conductor", conductorUid: uids.cond1,
    plan: { inicio: 360, fin: 840, minutos: 480, km: 40 }, fechaSubida: Date.now(),
    ubicaciones: [
      { id: "u0", pa: "P1", calle: "Mayor", horaPlan: 400, realizado: true, realizadoPor: uids.cond1, realizadoEn: a(6, 50), elementos: [] },
      { id: "u1", pa: "P2", calle: "Sol", horaPlan: 420, realizado: true, realizadoPor: uids.cond1, realizadoEn: a(7, 20), elementos: [] },
      { id: "u2", pa: "P3", calle: "Luna", horaPlan: 450, realizado: false, elementos: [] },
    ],
  });
  await escribir("fichajes/f-real", { org_id: ORG, uid: uids.cond1, nombre: "Carlos", fecha, horaEntrada: a(6), horaSalida: a(14, 30), kmInicio: 1000, kmFin: 1046, kmRecorridos: 46, estado: "cerrado", matricula: "Camión 7" });

  const errores = vigilarErrores(page);
  await entrarOficina(page);
  await page.getByText("Abrir proyecto").first().click();
  await page.waitForURL(/\/planning/);
  await page.getByRole("button", { name: "Análisis", exact: true }).first().click();
  await page.getByRole("button", { name: "Realizado", exact: true }).click();
  await expect(page.getByText("Camión 7").first()).toBeVisible();
  await expect(page.getByText("2/3")).toBeVisible();
  await expect(page.getByText("06:00–14:30")).toBeVisible();
  await expect(page.getByText("+6,0 (+15 %)")).toBeVisible();
  await page.getByText("Camión 7").first().click();
  await expect(page.getByText(/Sin hacer \(1\)/)).toBeVisible();
  if (globalThis.process.env.CAPTURAS) await page.screenshot({ path: `${globalThis.process.env.CAPTURAS}/a1-realizado.png` });
  expect(errores.filter(e => !/Failed to load resource|ERR_/i.test(e))).toEqual([]);
});
