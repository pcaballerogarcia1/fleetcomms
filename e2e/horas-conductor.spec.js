// App del conductor: cada parada enseña su hora prevista (la del Scheduling) y,
// al hacerla, cuándo se hizo frente a la prevista.
import { test, expect } from "@playwright/test";
import { sembrar, escribir, ORG, mesActual } from "./semilla.mjs";
import { vigilarErrores, entrarCampo } from "./ayudas.mjs";

test("la hora prevista de cada parada", async ({ browser }) => {
  const { uids } = await sembrar();
  const parada = (i, horaPlan) => ({ id: i, orden: i, calle: `Calle ${i}`, num: String(i), barri: "Centro", lat: 40.41 + i / 500, lng: -3.70, elementos: [], realizado: false, horaPlan });
  await escribir("planes/plan-horas", {
    org_id: ORG, tipo: "prev", nombre: "Ruta con horas", mes: mesActual(), diaServicio: "Día 04", conductorUid: uids.cond1,
    fechaSubida: Date.now() + 1000, archivo: "vrp-generado", origenVRP: true,
    ubicaciones: [parada(1, 575), parada(2, 600), parada(3, null)],
  });
  const movil = await (await browser.newContext({ viewport: { width: 400, height: 860 } })).newPage();
  const errores = vigilarErrores(movil);
  await entrarCampo(movil, "cond1@demo.test");
  await movil.getByText("Mantenimiento Preventivo").click();
  await movil.getByText("Ruta con horas").first().click();
  await expect(movil.getByText("Prevista 09:35").first()).toBeVisible(); // en la parada (y en «Próxima parada»)
  await expect(movil.getByText("Prevista 10:00")).toBeVisible();
  await expect(movil.getByText(/Prevista 09:35 · Centro/)).toBeVisible(); // la próxima parada
  await movil.getByRole("button", { name: "Marcar", exact: true }).first().click();
  await expect(movil.getByText(/Prevista 09:35 · hecha \d\d:\d\d \(/)).toBeVisible();
  if (globalThis.process.env.CAPTURAS) await movil.screenshot({ path: `${globalThis.process.env.CAPTURAS}/horas.png` });
  expect(errores).toEqual([]);
});
