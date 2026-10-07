// Medidor de lecturas y escrituras de Firestore por pantalla (npm run medir):
// con los datos de un cliente mediano (semilla grande), recorre lo que hace
// un administrador y un conductor en un día normal y anota cuánto lee cada
// paso. Escribe el informe en e2e/informe-lecturas.md.
import { test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { sembrarGrande } from "./semilla.mjs";
import { entrarOficina, entrarCampo } from "./ayudas.mjs";

const pasos = [];
async function anotar(page, nombre, esperaMs = 4000) {
  await page.waitForTimeout(esperaMs);
  const uso = await page.evaluate(() => globalThis.__firestoreUsoTomar?.() || null);
  if (!uso) throw new Error("La app no se ha compilado con el medidor (node e2e/compilar.mjs --medir)");
  const suma = o => Object.values(o).reduce((s, n) => s + n, 0);
  const porColeccion = {};
  for (const [k, n] of Object.entries(uso.lecturas)) { const col = k.split(" · ")[1]; porColeccion[col] = (porColeccion[col] || 0) + n; }
  pasos.push({ nombre, lecturas: suma(uso.lecturas), peticiones: suma(uso.peticiones), escrituras: suma(uso.escrituras), porColeccion });
}

test("lecturas por pantalla con los datos de un cliente mediano", async ({ browser }) => {
  const { documentos } = await sembrarGrande();

  // ── Oficina ──
  const oficina = await browser.newPage();
  await entrarOficina(oficina);
  await anotar(oficina, "Oficina · entrar y lista de proyectos");
  await oficina.getByText("Abrir proyecto").first().click();
  await anotar(oficina, "Oficina · abrir proyecto (Planning)");
  for (const m of ["Scheduling", "Rostering", "Control", "Analytics"]) {
    await oficina.getByRole("button", { name: m, exact: true }).first().click();
    await anotar(oficina, `Oficina · ${m}`);
  }
  await oficina.getByRole("button", { name: /Historial/ }).first().click();
  await anotar(oficina, "Oficina · Historial de cambios");
  await oficina.keyboard.press("Escape");
  await anotar(oficina, "Oficina · 30 s con todo abierto, sin tocar nada", 30_000);

  // ── App del conductor ──
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } });
  const campo = await ctx.newPage();
  await entrarCampo(campo, "cond1@demo.test");
  await anotar(campo, "Conductor · entrar (portada de rutas)");
  await campo.getByText("Mantenimiento Preventivo").click();
  await campo.getByText("Ruta de prueba").first().click();
  await anotar(campo, "Conductor · abrir una ruta");
  await campo.getByRole("button", { name: "Marcar", exact: true }).first().click();
  await anotar(campo, "Conductor · marcar una parada");
  await campo.getByRole("button", { name: /incidencias/i }).click();
  await anotar(campo, "Conductor · incidencias");
  await campo.getByRole("button", { name: /inventario/i }).click();
  await anotar(campo, "Conductor · inventario");

  // ── Informe ──
  const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, n]) => `${c} ${n}`).join(", ") || "—";
  const total = pasos.reduce((s, p) => s + p.lecturas, 0);
  const md = [
    "# Lecturas de Firestore por pantalla",
    "",
    `Medido con \`npm run medir\` el ${new Date().toISOString().slice(0, 10)}, contra los emuladores con los datos de un cliente mediano (${documentos.toLocaleString("es-ES")} documentos: 600 rutas en 3 meses, 40 trabajadores, 2.000 líneas de historial, 1.000 fichajes…).`,
    "",
    "«Lecturas» son los documentos que llegan del servidor (lo que cobra Firestore). Además, cada petición hace 1–2 lecturas en las reglas (`get()` del perfil y del proyecto).",
    "",
    "| Paso | Lecturas | Peticiones | Escrituras | Dónde lee más |",
    "|---|---:|---:|---:|---|",
    ...pasos.map(p => `| ${p.nombre} | ${p.lecturas.toLocaleString("es-ES")} | ${p.peticiones} | ${p.escrituras} | ${top(p.porColeccion)} |`),
    `| **Total del recorrido** | **${total.toLocaleString("es-ES")}** | | | |`,
    "",
    "Plan Spark: 50.000 lecturas al día para toda la aplicación.",
    "",
  ].join("\n");
  writeFileSync(new URL("./informe-lecturas.md", import.meta.url), md);
  console.log("\n" + md);
});
