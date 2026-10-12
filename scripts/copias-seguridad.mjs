// Copias de seguridad de la base de datos de PRODUCCIÓN (fleetcomms-13d89).
// Se puede lanzar cuantas veces se quiera: cada vez hace solo lo que falta.
//
//   node scripts/copias-seguridad.mjs
//
// 1. Copia diaria (se guardan 14 días) y semanal, los domingos (12 semanas).
// 2. Vuelta atrás a cualquier minuto de los últimos 7 días (PITR) y
//    protección contra el borrado de la base de datos entera.
// 3. Ensayo de recuperación: en cuanto exista la primera copia, se recupera
//    en una base de datos aparte («prueba-restauracion»), se deja 2 días para
//    poder mirarla en la consola y se borra.
//
// Necesita el plan Blaze: mientras el proyecto siga en el gratuito, no hace
// nada (y lo dice). Usa la sesión de la CLI de Firebase de este ordenador.
// Deja un informe en el escritorio y, si se lanzó con la tarea programada de
// Windows («Operanzia - copias de seguridad»), la borra cuando ha terminado.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PROYECTO = "fleetcomms-13d89";
const PRUEBA = "prueba-restauracion";
const TAREA = "Operanzia - copias de seguridad";
const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const DIR = join(homedir(), ".operanzia");
const ESTADO = join(DIR, "copias-estado.json");
const LOG = join(DIR, "copias.log");
const INFORME = join(homedir(), "Desktop", "Copias de seguridad Operanzia.txt");
const CONSOLA = `https://console.cloud.google.com/firestore/databases?project=${PROYECTO}`;

mkdirSync(DIR, { recursive: true });
const ahora = () => new Date().toLocaleString("es-ES");
const log = t => appendFileSync(LOG, `[${ahora()}] ${t}\n`);
const estado = existsSync(ESTADO) ? JSON.parse(readFileSync(ESTADO, "utf8")) : {};
const guardar = () => writeFileSync(ESTADO, JSON.stringify(estado, null, 2));

// Una orden de la CLI de Firebase con salida JSON → { ok, result, error }
function firebase(args) {
  try {
    const out = execSync(`npx firebase ${args} --project ${PROYECTO} --json --non-interactive`, { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300000 });
    const j = JSON.parse(out.slice(out.indexOf("{")));
    return j.status === "success" ? { ok: true, result: j.result } : { ok: false, error: j.error || out };
  } catch (e) {
    const txt = String(e.stdout || "") + String(e.stderr || "") + String(e.message || "");
    try { const j = JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1)); return { ok: false, error: j.error || txt }; } catch { return { ok: false, error: txt }; }
  }
}
const sinPago = r => /billing to be enabled|enable billing/i.test(String(r.error));

function informe(lineas) {
  writeFileSync(INFORME, [
    "COPIAS DE SEGURIDAD DE OPERANZIA (producción)",
    `Actualizado: ${ahora()}`,
    "",
    ...lineas,
    "",
    `Consola de Google Cloud (bases de datos y copias): ${CONSOLA}`,
    "Qué hacer si hay que recuperar algo: docs/COPIAS-DE-SEGURIDAD.md en el proyecto.",
  ].join("\r\n"), "utf8");
}
function quitarTarea() {
  try { execSync(`schtasks /Delete /TN "${TAREA}" /F`, { stdio: "ignore" }); log("Tarea programada borrada: ya no hace falta."); } catch { /* no estaba */ }
}

// ── 1) copias programadas ──
const prog = firebase("firestore:backups:schedules:list");
const programas = prog.ok ? prog.result || [] : [];
const hay = rec => programas.some(p => (rec === "DAILY" ? p.dailyRecurrence : p.weeklyRecurrence));
if (!hay("DAILY")) {
  const r = firebase(`firestore:backups:schedules:create --database "(default)" --recurrence DAILY --retention 14d`);
  if (!r.ok) {
    if (sinPago(r)) {
      if (!estado.esperandoDesde) { estado.esperandoDesde = ahora(); guardar(); }
      log("Esperando: el proyecto sigue en el plan gratuito (Spark).");
      informe([
        "⏳ EN ESPERA: el proyecto sigue en el plan gratuito (Spark).",
        "Las copias se activan solas en cuanto cambies a Blaze (se mira cada hora).",
        "Cómo: https://console.firebase.google.com/project/fleetcomms-13d89/usage/details → Modificar plan → Blaze.",
      ]);
      process.exit(0);
    }
    log(`Error creando la copia diaria: ${String(r.error).slice(0, 400)}`);
    informe(["❌ No se pudo crear la copia diaria:", String(r.error).slice(0, 800), "", "Se volverá a intentar en la próxima hora."]);
    process.exit(1);
  }
  log("Copia diaria creada (14 días).");
}
if (!hay("WEEKLY")) {
  const r = firebase(`firestore:backups:schedules:create --database "(default)" --recurrence WEEKLY --day-of-week SUNDAY --retention 84d`);
  log(r.ok ? "Copia semanal creada (domingos, 12 semanas)." : `Error creando la copia semanal: ${String(r.error).slice(0, 300)}`);
}

// ── 2) vuelta atrás a cualquier minuto (7 días) y protección contra borrado ──
const db = firebase(`firestore:databases:get "(default)"`);
if (db.ok && (db.result.pointInTimeRecoveryEnablement !== "POINT_IN_TIME_RECOVERY_ENABLED" || db.result.deleteProtectionState !== "DELETE_PROTECTION_ENABLED")) {
  const r = firebase(`firestore:databases:update "(default)" --point-in-time-recovery ENABLED --delete-protection ENABLED`);
  log(r.ok ? "Vuelta atrás (7 días) y protección contra borrado activadas." : `Error activando la vuelta atrás: ${String(r.error).slice(0, 300)}`);
}
if (!estado.activadas) { estado.activadas = ahora(); guardar(); }

// ── 3) ensayo de recuperación ──
const lineasEnsayo = [];
if (!estado.ensayo) {
  const l = firebase("firestore:backups:list");
  const copias = (l.ok ? l.result?.backups || [] : []).filter(b => b.state === "READY" && b.database?.endsWith("/(default)"));
  if (!copias.length) {
    lineasEnsayo.push("⏳ Ensayo de recuperación: esperando a que se haga la primera copia (en menos de 24 horas).");
  } else {
    const ultima = copias.sort((a, b) => String(b.snapshotTime).localeCompare(String(a.snapshotTime)))[0];
    const r = firebase(`firestore:databases:restore --database ${PRUEBA} --backup "${ultima.name}"`);
    if (r.ok) {
      estado.ensayo = { inicio: Date.now(), copia: ultima.snapshotTime };
      guardar();
      log(`Ensayo de recuperación lanzado desde la copia de ${ultima.snapshotTime}.`);
      lineasEnsayo.push(`⏳ Ensayo de recuperación en marcha: recuperando la copia de ${new Date(ultima.snapshotTime).toLocaleString("es-ES")} en una base de datos aparte («${PRUEBA}»).`);
    } else {
      log(`Error en el ensayo de recuperación: ${String(r.error).slice(0, 300)}`);
      lineasEnsayo.push(`❌ El ensayo de recuperación falló: ${String(r.error).slice(0, 400)} (se reintentará).`);
    }
  }
} else if (!estado.ensayo.comprobado) {
  const g = firebase(`firestore:databases:get ${PRUEBA}`);
  if (g.ok) {
    estado.ensayo.comprobado = Date.now();
    guardar();
    log("Ensayo de recuperación: la copia se ha recuperado bien.");
  }
  lineasEnsayo.push(g.ok
    ? `✅ Ensayo de recuperación: la copia de ${new Date(estado.ensayo.copia).toLocaleString("es-ES")} se ha recuperado bien como base de datos aparte («${PRUEBA}»). Puedes mirarla en la consola durante 2 días; luego se borra sola.`
    : "⏳ Ensayo de recuperación en marcha…");
} else if (!estado.ensayo.borrado && Date.now() - estado.ensayo.comprobado > 2 * 86400000) {
  const r = firebase(`firestore:databases:delete ${PRUEBA} --force`);
  if (r.ok || /not found|NOT_FOUND/i.test(String(r.error))) { estado.ensayo.borrado = Date.now(); guardar(); log("Base de datos del ensayo borrada."); }
}
if (estado.ensayo?.comprobado) lineasEnsayo.splice(0, lineasEnsayo.length, `✅ Ensayo de recuperación hecho: la copia de ${new Date(estado.ensayo.copia).toLocaleString("es-ES")} se recuperó bien${estado.ensayo.borrado ? " (la base de datos del ensayo ya se ha borrado)" : ` como «${PRUEBA}»; se borra sola 2 días después`}.`);

informe([
  `✅ ACTIVADAS desde el ${estado.activadas}.`,
  "",
  "• Copia diaria de toda la base de datos (se guardan las de los últimos 14 días).",
  "• Copia semanal, los domingos (se guardan 12 semanas).",
  "• Vuelta atrás a cualquier minuto de los últimos 7 días.",
  "• Protección contra el borrado de la base de datos entera.",
  "",
  ...lineasEnsayo,
]);
if (estado.ensayo?.borrado) quitarTarea();
