// Concursos contra los emuladores: se crea uno, se abre con sus módulos y
// trabaja en su espacio aislado (la plantilla y los proyectos de la
// operativa no se ven dentro, ni el concurso entre los proyectos).
/* global process, Buffer */
import { test, expect } from "@playwright/test";
import { sembrar, escribir, ORG, crearSuperadmin } from "./semilla.mjs";
import { vigilarErrores, entrarOficina, pdfMini } from "./ayudas.mjs";

test("un concurso se crea, se abre con sus módulos y no se mezcla con la operativa", async ({ page }) => {
  await sembrar();
  await escribir("scheduling_workers/w1", { org_id: ORG, nombre: "Plantilla", apellidos: "Real", activo: true });
  const errores = vigilarErrores(page);
  const foto = async n => { if (process.env.CAPTURAS) await page.screenshot({ path: `${process.env.CAPTURAS}/concursos-${n}.png` }); };
  await entrarOficina(page);

  await page.getByRole("button", { name: "Concursos", exact: true }).click();
  await page.waitForURL(/\/concursos/);
  await expect(page.getByText("Aún no hay concursos")).toBeVisible();
  await page.getByRole("button", { name: /Nuevo concurso/ }).click();
  await page.getByPlaceholder("Recogida de residuos de Salamanca").fill("RSU Salamanca 2027");
  await page.getByPlaceholder("Ayuntamiento de Salamanca").fill("Ayuntamiento de Salamanca");
  await foto(1);
  await page.getByRole("button", { name: /Crear y abrir/ }).click();
  // un concurso empieza por sus documentos: se sube el pliego y Operanzia lo lee
  await page.waitForURL(/\/documentos/);
  await page.locator('input[type="file"][accept="application/pdf,.pdf"]').setInputFiles({ name: "pliego-tecnico.pdf", mimeType: "application/pdf", buffer: pdfMini([
    ["PLIEGO DE PRESCRIPCIONES TECNICAS PARTICULARES", "1. OBJETO DEL CONTRATO", "El objeto del contrato es el servicio de lavado de contenedores en Salamanca.", "El total de contenedores alcanzan las 6.037 unidades.", "La duracion del contrato sera de tres anos (3), con una prorroga de un (1) ano.", "El presupuesto base de licitacion asciende a 1.800.000,00 euros."],
    ["ANEXO I - Unidades estimadas anuales", "LAVADO FRACCION 1r ANO 2ndo ANO 3r ANO", "SOTERRADO", "RSU 1.992 1.992 1.992", "PAPEL 230 230 230", "Los equipos deberan tener una antiguedad maxima de 15 anos."],
    ["CRITERIOS DE ADJUDICACION", "Oferta economica: hasta 60 puntos.", "Memoria tecnica del servicio: hasta 40 puntos.", "Se puntuara con la formula P = 60 x (Omin / Oi)."],
  ]) });
  await expect(page.getByText(/Leído: \d+ datos/)).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("Pliego de prescripciones técnicas").first()).toBeVisible();
  await expect(page.getByText("6.037", { exact: true })).toBeVisible();
  await expect(page.getByText("3 años", { exact: true })).toBeVisible();
  await expect(page.getByText(/Cantidades que trae el pliego/)).toBeVisible();
  await foto("pliego");
  // Ficha de requisitos: se confirma lo que vale y se añaden los servicios de las tablas
  await page.getByRole("button", { name: "Ficha de requisitos", exact: true }).click();
  await expect(page.getByText(/de \d+ datos revisados/)).toBeVisible();
  await page.locator("div", { hasText: "Duración" }).filter({ has: page.getByRole("button", { name: /Correcto/ }) }).last().getByRole("button", { name: /Correcto/ }).click();
  await expect(page.getByText("Confirmado").first()).toBeVisible();
  await page.locator("div", { hasText: "Presupuesto base de licitación" }).filter({ has: page.getByRole("button", { name: /Correcto/ }) }).last().getByRole("button", { name: /Correcto/ }).click();
  // criterios de adjudicación: los lee del pliego y se usan
  await expect(page.getByText("Oferta economica").first()).toBeVisible();
  await page.getByRole("button", { name: "Usar estos criterios" }).click();
  await expect(page.getByText(/Total 100 puntos · precio 60/)).toBeVisible();
  await expect(page.getByLabel("Fórmula del precio")).toHaveValue("proporcional");
  await page.getByRole("button", { name: /Añadir a la ficha las marcadas/ }).click();
  await expect(page.getByText(/Servicios añadidos a la ficha/)).toBeVisible();
  await expect(page.getByText(/Servicios y cantidades al año \(2\)/)).toBeVisible();
  await foto("ficha");
  // Planning del concurso: dimensionar por rendimientos con los servicios de la ficha
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await page.waitForURL(/\/planning/);
  await expect(page.getByText("Equipos por tipo de vehículo")).toBeVisible();
  // 1.992 + 230 lavados de soterrados a 25 por turno = 89 turnos al año → 1 vehículo
  await expect(page.locator(".op-tarjeta").filter({ hasText: "Vehículos" }).getByText("1", { exact: true })).toBeVisible();
  await expect(page.getByText("88,9", { exact: true }).first()).toBeVisible(); // en la tabla de servicios y en la de equipos
  await foto("planning");
  // inventario sin coordenadas: cualquier listado; dice cómo lo ha entendido antes de guardarlo
  await page.locator('input[type="file"][accept=".xlsx,.xls,.xlsm,.ods,.csv,.tsv,.txt"]').setInputFiles({ name: "contenedores.csv", mimeType: "text/csv",
    buffer: Buffer.from("Carrer;Num.;Fracció;Model\nMAJOR;1;RSU;Soterrado\nMAJOR;1;PAPEL;Soterrado\nSOL;7;RSU;Soterrado\n", "latin1") });
  await expect(page.getByText(/Así he entendido «contenedores\.csv»/)).toBeVisible();
  await expect(page.getByText("Salen 3 contenedores.")).toBeVisible();
  await page.getByRole("button", { name: /Usar este listado/ }).click();
  await expect(page.getByText(/3 contenedores en 2 puntos de aportación/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Usar los rendimientos del inventario/ })).toBeVisible();
  // sin coordenadas: se sitúa cada dirección (buscador de direcciones, aquí simulado) y pasa al mapa del Planning
  await page.route("**/cartociudad.es/**", ruta => {
    const q = decodeURIComponent(ruta.request().url().split("q=")[1] || "");
    const [calle, num] = [q.replace(/\s\d+,.*$/, "").replace(/,.*$/, ""), (q.match(/\s(\d+),/) || [])[1]];
    ruta.fulfill({ contentType: "application/json", body: JSON.stringify({ type: "portal", tip_via: "CALLE", address: calle, portalNumber: Number(num), muni: "Salamanca", lat: 40.96 + Number(num) / 1000, lng: -5.66, state: 0 }) });
  });
  await page.getByLabel("Municipio").fill("Salamanca");
  await page.getByRole("button", { name: /Situar y pasar al mapa/ }).click();
  await expect(page.getByRole("button", { name: /Mapa \(con coordenadas\)/ })).toHaveClass(/op-on/);
  await expect(page.getByText("Inventario · contenedores.csv")).toBeVisible();
  await page.getByRole("button", { name: "Por rendimientos" }).click();
  await expect(page.getByText(/2 direcciones en su portal/)).toBeVisible();

  // Cálculo: la cuenta de explotación con el presupuesto del pliego (600.000 € al año)
  await page.getByRole("button", { name: "Cálculo", exact: true }).click();
  await page.waitForURL(/\/calculo/);
  await expect(page.getByText("Cuenta de explotación", { exact: true })).toBeVisible();
  await expect(page.getByText("600.000 €", { exact: true })).toBeVisible();
  await foto("calculo");
  // Alternativas: qué baja presentar y escenarios
  await page.getByRole("button", { name: "Alternativas", exact: true }).click();
  await page.waitForURL(/\/alternativas/);
  await expect(page.getByText("Qué baja presentar", { exact: true })).toBeVisible();
  await expect(page.getByText(/Escenarios con/)).toBeVisible();
  await foto("alternativas");

  // sus módulos, y no los de la operativa diaria
  for (const m of ["Documentos", "Planning", "Scheduling", "Rostering", "Cálculo", "Alternativas", "Resumen"]) {
    await expect(page.getByRole("button", { name: m, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Departure", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Control", exact: true })).toHaveCount(0);

  // Rostering del concurso: la plantilla real no está
  await page.getByRole("button", { name: "Rostering", exact: true }).click();
  await page.waitForURL(/\/rostering/);
  await page.waitForTimeout(1500);
  await expect(page.getByText("Plantilla Real")).toHaveCount(0);

  await page.getByRole("button", { name: "Resumen", exact: true }).click();
  await page.waitForURL(/\/resumen/);
  await expect(page.getByText("Ayuntamiento de Salamanca")).toBeVisible();
  await expect(page.locator(".op-tarjeta").filter({ hasText: "Duración" }).getByText("3 años")).toBeVisible();
  await expect(page.getByText("Comprobaciones")).toBeVisible();
  await expect(page.getByText("Criterios: 60 puntos de precio y 40 del resto")).toBeVisible();
  await foto(2);

  // la lista de concursos lo tiene; la de proyectos, no
  await page.getByRole("button", { name: "Concursos", exact: true }).click();
  await expect(page.locator(".op-tarjeta").filter({ hasText: "RSU Salamanca 2027" })).toBeVisible();
  await foto(3);
  await page.getByRole("button", { name: "Proyectos", exact: true }).click();
  await page.waitForURL(/\/projects/);
  await expect(page.getByText("Proyecto de puntos").first()).toBeVisible();
  await expect(page.getByText("Abrir proyecto")).toHaveCount(1); // solo el de la operativa
  expect(errores).toEqual([]);
});

test("el superadmin elige la organización y crea el concurso en ella", async ({ page }) => {
  await sembrar();
  await crearSuperadmin();
  const errores = vigilarErrores(page);
  await entrarOficina(page, "super@demo.test");
  await page.getByRole("button", { name: "Concursos", exact: true }).click();
  await page.waitForURL(/\/concursos/);
  await expect(page.getByLabel("Organización")).toHaveValue(ORG);
  await page.getByRole("button", { name: /Nuevo concurso/ }).click();
  await page.getByPlaceholder("Recogida de residuos de Salamanca").fill("Gozón");
  await page.getByRole("button", { name: /Crear y abrir/ }).click();
  await page.waitForURL(/\/documentos/);
  await page.getByRole("button", { name: "Concursos", exact: true }).click();
  await expect(page.locator(".op-tarjeta").filter({ hasText: "Gozón" })).toBeVisible();
  expect(errores).toEqual([]);
});
