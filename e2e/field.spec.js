// App de conductores (/rutas) contra los emuladores: entrar, ver sus rutas,
// marcar paradas (también dos personas a la vez en el mismo plan) y
// comentar una incidencia.
import { test, expect } from "@playwright/test";
import { sembrar, leer, listar, escribir, ORG, mesActual } from "./semilla.mjs";
import { vigilarErrores, entrarCampo as entrar, entrarOficina } from "./ayudas.mjs";

async function abrirPlan(page, nombre) {
  await page.getByText("Mantenimiento Preventivo").click();
  await page.getByText(nombre).first().click();
  await expect(page.getByText("PRÓXIMA PARADA", { exact: false })).toBeVisible();
}
const hechas = async id => (await leer(`planes/${id}`)).ubicaciones.filter(u => u.realizado).map(u => u.id).sort();

test.beforeEach(async () => { await sembrar(); });

test("un conductor entra, ve sus rutas y marca una parada", async ({ page }) => {
  const errores = vigilarErrores(page);
  await entrar(page, "cond1@demo.test");
  // la suya y la compartida (conductorUid: null), y la tarea correctiva
  await expect(page.getByText("2 planes", { exact: false })).toBeVisible();
  await expect(page.getByText("1 tareas", { exact: false })).toBeVisible();
  await abrirPlan(page, "Ruta de prueba");
  await page.getByRole("button", { name: "Marcar", exact: true }).first().click();
  await expect.poll(() => hechas("plan-cond1")).toEqual([1]);
  expect(errores).toEqual([]);
});

test("dos conductores marcan paradas del mismo plan a la vez y no se pierde ninguna", async ({ browser }) => {
  const [a, b] = await Promise.all([browser.newContext({ viewport: { width: 420, height: 860 } }), browser.newContext({ viewport: { width: 420, height: 860 } })]);
  const [pa, pb] = await Promise.all([a.newPage(), b.newPage()]);
  await Promise.all([entrar(pa, "cond1@demo.test"), entrar(pb, "cond2@demo.test")]);
  await Promise.all([abrirPlan(pa, "Ruta compartida"), abrirPlan(pb, "Ruta compartida")]);
  // cada uno, una parada distinta, al mismo tiempo (y luego otra cada uno)
  await Promise.all([
    pa.getByRole("button", { name: "Marcar", exact: true }).nth(0).click(),
    pb.getByRole("button", { name: "Marcar", exact: true }).nth(1).click(),
  ]);
  await expect.poll(() => hechas("plan-compartido")).toEqual([1, 2]);
  // cada uno ve ya lo que marcó el otro (si no, los dos podrían ir a la misma)
  await Promise.all([expect(pa.getByText("2/5", { exact: true })).toBeVisible(), expect(pb.getByText("2/5", { exact: true })).toBeVisible()]);
  await Promise.all([
    pa.getByRole("button", { name: "Marcar", exact: true }).last().click(),
    pb.getByRole("button", { name: "Marcar", exact: true }).first().click(),
  ]);
  await expect.poll(async () => (await hechas("plan-compartido")).length).toBe(4);
  await Promise.all([a.close(), b.close()]);
});

test("un comentario en una incidencia se guarda", async ({ page }) => {
  const errores = vigilarErrores(page);
  await entrar(page, "cond1@demo.test");
  await page.getByRole("button", { name: /incidencias/i }).click();
  await page.getByText("Pinchazo").first().click();
  await page.getByPlaceholder("Añadir comentario...").fill("Cambiada la rueda");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await leer("incidencias/inc-1")).comentarios.map(c => c.texto)).toEqual(["Cambiada la rueda"]);
  expect(errores).toEqual([]);
});

async function salida(page, cantidad) {
  await page.getByRole("button", { name: /inventario/i }).click();
  await page.getByText("Filtro de aceite").first().click();
  await page.getByRole("button", { name: /Salida/ }).first().click();
  await page.locator('input[type="number"]').first().fill(String(cantidad));
  return () => page.getByRole("button", { name: /REGISTRAR SALIDA/i }).click();
}

test("dos salidas de stock a la vez: el stock cuadra y quedan los dos movimientos", async ({ browser }) => {
  const [a, b] = await Promise.all([browser.newContext({ viewport: { width: 420, height: 860 } }), browser.newContext({ viewport: { width: 420, height: 860 } })]);
  const [pa, pb] = await Promise.all([a.newPage(), b.newPage()]);
  await Promise.all([entrar(pa, "cond1@demo.test"), entrar(pb, "cond2@demo.test")]);
  const [registrarA, registrarB] = await Promise.all([salida(pa, 3), salida(pb, 2)]);
  await Promise.all([registrarA(), registrarB()]); // los dos ven «stock 10» y registran a la vez
  await expect.poll(async () => (await leer("inventario/prod-1")).stock).toBe(5);
  const movs = (await listar("movimientos")).map(m => [m.stockAntes, m.stockDespues]).sort((x, y) => y[0] - x[0]);
  expect(movs).toHaveLength(2);
  expect(movs[1][0]).toBe(movs[0][1]); // el segundo parte de donde dejó el primero
  await Promise.all([a.close(), b.close()]);
});

test("una ruta antigua sin conductorUid aparece al conductor en cuanto entra un administrador", async ({ browser }) => {
  // como las de antes de este cambio: sin el campo conductorUid
  await escribir("planes/plan-antiguo", { org_id: ORG, tipo: "prev", nombre: "Ruta antigua", mes: mesActual(), diaServicio: "Día 03",
    ubicaciones: [{ id: 1, calle: "Calle 1", lat: 40.41, lng: -3.7, elementos: [], realizado: false }], fechaSubida: Date.now() - 5000, archivo: "antiguo" });
  const conductor = await (await browser.newContext({ viewport: { width: 420, height: 860 } })).newPage();
  await entrar(conductor, "cond1@demo.test");
  await expect(conductor.getByText("2 planes", { exact: false })).toBeVisible(); // la antigua aún no sale

  const oficina = await (await browser.newContext()).newPage();
  const errores = vigilarErrores(oficina);
  await entrarOficina(oficina);
  await expect.poll(async () => { const p = await leer("planes/plan-antiguo"); return p && "conductorUid" in p ? p.conductorUid : "sin campo"; }).toBe(null);
  expect((await leer("planes/plan-antiguo")).nombre).toBe("Ruta antigua"); // solo se toca ese campo

  await expect(conductor.getByText("3 planes", { exact: false })).toBeVisible();
  expect(errores).toEqual([]);
});
