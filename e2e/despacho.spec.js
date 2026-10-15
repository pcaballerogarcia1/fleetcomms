// Despacho del día contra los emuladores: un conductor no viene, se elige
// quién cubre y el turno, la ruta del día y «Mi cuadrante» pasan al otro.
/* global process */
import { test, expect } from "@playwright/test";
import { sembrar, leer, escribir, ORG } from "./semilla.mjs";
import { vigilarErrores, entrarOficina } from "./ayudas.mjs";

test("un conductor no viene y otro de guardia cubre su turno y su ruta", async ({ page }) => {
  const { uids } = await sembrar();
  const hoy = new Date(), y = hoy.getFullYear(), m = hoy.getMonth() + 1, d = hoy.getDate();
  const mes = `${y}-${String(m).padStart(2, "0")}`, id = `${ORG}_${y}_${String(m).padStart(2, "0")}`;
  await escribir(`scheduling_workers/w1`, { org_id: ORG, nombre: "Trabajador 1", apellidos: "Demo", activo: true, vehiculoId: "v1", uid: uids.cond1 });
  await escribir(`scheduling_workers/w2`, { org_id: ORG, nombre: "Trabajador 2", apellidos: "Demo", activo: true, uid: uids.cond2 });
  await escribir(`rostering/${id}`, { org_id: ORG, year: y, month: m, formato: 2 });
  await escribir(`rostering/${id}/trabajadores/w1`, { org_id: ORG, year: y, month: m, grid: { [d]: "M" } });
  await escribir(`rostering/${id}/trabajadores/w2`, { org_id: ORG, year: y, month: m, grid: { [d]: "G" } });
  await escribir(`planes/ruta-w1`, { org_id: ORG, tipo: "prev", nombre: "Ruta de W1", mes, diaNum: d, diaServicio: `Día ${d}`, workerId: "w1", conductorUid: uids.cond1, origenRostering: true,
    ubicaciones: [{ id: 1, calle: "Calle 1", lat: 40.41, lng: -3.7, elementos: [], realizado: false }], fechaSubida: Date.now() });

  const errores = vigilarErrores(page);
  await entrarOficina(page);
  await page.getByText("Abrir proyecto").first().click();
  await page.waitForURL(/\/planning/);
  await page.getByRole("button", { name: "Departure", exact: true }).first().click();
  await page.waitForURL(/\/departure/);
  await expect(page.getByText("Trabajador 1 Demo")).toBeVisible();
  await expect(page.getByText("Camión 1").first()).toBeVisible();
  const foto = async n => { if (process.env.CAPTURAS) await page.screenshot({ path: `${process.env.CAPTURAS}/despacho-${n}.png` }); };
  await foto(1);

  await page.getByRole("button", { name: /No viene/ }).first().click();
  await page.getByRole("button", { name: /Marcar y buscar/ }).click();
  await expect(page.getByText(/^De guardia/).first()).toBeVisible();
  await foto(2);
  await page.getByRole("button", { name: "Cubrir", exact: true }).first().click();
  await expect(page.getByText(/Trabajador 2 Demo cubre el turno/)).toBeVisible();

  await expect.poll(async () => (await leer(`rostering/${id}/trabajadores/w2`))?.grid?.[d]).toBe("M");
  expect((await leer(`rostering/${id}/trabajadores/w1`)).grid[d]).toBe("B");
  const plan = await leer("planes/ruta-w1");
  expect(plan.workerId).toBe("w2");
  expect(plan.conductorUid).toBe(uids.cond2);
  expect((await leer(`cuadrantes/${ORG}_${mes}_${uids.cond2}`)).dias[d].c).toBe("M");
  await expect(page.getByText(/cubre a Trabajador 1 Demo/)).toBeVisible();
  await foto(3);
  expect(errores.filter(e => !/avisos|api\/avisos|404/.test(e))).toEqual([]);
});
