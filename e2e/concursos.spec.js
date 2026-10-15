// Concursos contra los emuladores: se crea uno, se abre con sus módulos y
// trabaja en su espacio aislado (la plantilla y los proyectos de la
// operativa no se ven dentro, ni el concurso entre los proyectos).
/* global process */
import { test, expect } from "@playwright/test";
import { sembrar, escribir, ORG } from "./semilla.mjs";
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
    ["PLIEGO DE PRESCRIPCIONES TECNICAS PARTICULARES", "1. OBJETO DEL CONTRATO", "El objeto del contrato es el servicio de lavado de contenedores en Salamanca.", "El total de contenedores alcanzan las 6.037 unidades.", "La duracion del contrato sera de tres anos (3), con una prorroga de un (1) ano."],
    ["ANEXO I - Unidades estimadas anuales", "LAVADO FRACCION 1r ANO 2ndo ANO 3r ANO", "SOTERRADO", "RSU 1.992 1.992 1.992", "PAPEL 230 230 230", "Los equipos deberan tener una antiguedad maxima de 15 anos."],
  ]) });
  await expect(page.getByText(/Leído: \d+ datos/)).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("Pliego de prescripciones técnicas").first()).toBeVisible();
  await expect(page.getByText("6.037", { exact: true })).toBeVisible();
  await expect(page.getByText("3 años", { exact: true })).toBeVisible();
  await expect(page.getByText(/Cantidades que trae el pliego/)).toBeVisible();
  await foto("pliego");
  // lo que interesa pasa a la ficha del concurso
  page.once("dialog", d => d.accept());
  await page.getByRole("button", { name: /Pasar a la ficha/ }).click();
  await expect(page.getByText(/Datos pasados a la ficha/)).toBeVisible();
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  await page.waitForURL(/\/planning/);

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
