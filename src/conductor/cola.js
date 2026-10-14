// App del conductor · cola de cambios sin cobertura.
// Cada parada que marca el conductor se guarda primero EN EL MÓVIL (como un
// cambio pequeño: «parada 12 → hecha a las 10:41») y después se envía al
// servidor aplicada sobre lo que haya allí (transacción), para no pisar lo
// que marquen otros. Sin cobertura, o con una cobertura que no llega, los
// cambios esperan en el móvil, se ven en pantalla igualmente, aguantan que
// se cierre la app y se envían solos, en orden, al volver la conexión.
// Volver a enviar un cambio no estropea nada: pone los mismos valores.
import { doc, runTransaction } from "firebase/firestore";
import { db } from "../firebase.js";

const ESPERA_MS = 12_000;      // una transacción que tarda más: «no hay cobertura de verdad»
const REINTENTO_MS = 15_000;   // con cambios pendientes, se reintenta cada 15 s (y al volver la red)
const GRACIA_MS = 2_000;       // lo ya enviado se sigue pintando hasta que llega la versión del servidor

/** Lo que cambia `cambio` en la parada (solo los campos distintos) — se puede guardar y reenviar */
export function camposCambiados(antes, despues) {
  const out = {};
  for (const [k, v] of Object.entries(despues || {})) if (JSON.stringify(v ?? null) !== JSON.stringify(antes?.[k] ?? null)) out[k] = v;
  return out;
}
/** Aplica a la lista de paradas los cambios (en orden) de un plan */
export function aplicarCambios(ubicaciones, ops) {
  let l = ubicaciones || [];
  for (const op of ops) l = l.map(u => (String(u.id) === String(op.ubicId) ? { ...u, ...op.campos } : u));
  return l;
}

/**
 * La cola de un usuario. `guardar` y `enviar` se pueden cambiar (pruebas).
 * @returns { encolar, pendientesDe, estado, suscribir, intentar }
 */
export function crearCola(uid, {
  almacen = typeof localStorage !== "undefined" ? localStorage : null,
  enviar = enviarAFirestore,
  enLinea = () => typeof navigator === "undefined" || navigator.onLine !== false,
  ahora = () => Date.now(),
} = {}) {
  const clave = `operanzia_cola_paradas_${uid}`;
  let ops = [];
  try { ops = JSON.parse(almacen?.getItem(clave) || "[]"); } catch { ops = []; }
  let recientes = []; // enviados hace poco: { op, hasta }
  let enviando = false, ultimoError = null, ultimoEnvio = null, timer = null;
  const oyentes = new Set();
  const guardar = () => { try { almacen?.setItem(clave, JSON.stringify(ops)); } catch { /* sin espacio: siguen en memoria */ } };
  const avisar = () => { const e = estado(); oyentes.forEach(f => f(e)); };
  function estado() {
    return { pendientes: ops.length, enviando, enLinea: enLinea(), ultimoError, ultimoEnvio };
  }
  function programar() {
    clearTimeout(timer);
    if (ops.length) timer = setTimeout(intentar, REINTENTO_MS);
  }
  async function intentar() {
    if (enviando || !ops.length) return;
    if (!enLinea()) { avisar(); programar(); return; }
    enviando = true; avisar();
    try {
      while (ops.length) {
        const op = ops[0];
        try {
          await enviar(op);
        } catch (e) {
          // el plan ya no existe o no es suyo: ese cambio no se puede enviar nunca
          if (e?.code === "not-found" || e?.code === "permission-denied") {
            ultimoError = `Un cambio no se pudo guardar (${e.code === "not-found" ? "la ruta ya no existe" : "sin permiso"})`;
            setTimeout(() => { ultimoError = null; avisar(); }, 20_000); // el aviso se quita solo
          }
          else throw e;
        }
        ops.shift(); guardar();
        recientes.push({ op, hasta: ahora() + GRACIA_MS });
        ultimoEnvio = ahora();
        setTimeout(() => { recientes = recientes.filter(r => r.hasta > ahora()); avisar(); }, GRACIA_MS + 50);
        avisar();
      }
    } catch {
      // sin cobertura de verdad: se reintenta más tarde
    } finally {
      enviando = false; avisar(); programar();
    }
  }
  if (typeof window !== "undefined") window.addEventListener("online", () => intentar());
  if (ops.length) setTimeout(intentar, 0);
  return {
    encolar(planId, ubicId, campos) {
      if (!Object.keys(campos).length) return;
      ops.push({ id: `${ahora().toString(36)}${Math.random().toString(36).slice(2, 6)}`, planId, ubicId, campos, t: ahora() });
      guardar(); avisar(); intentar();
    },
    /** Los cambios de un plan que aún no se ven en la versión del servidor */
    pendientesDe(planId) {
      const t = ahora();
      return [...recientes.filter(r => r.hasta > t).map(r => r.op), ...ops].filter(o => o.planId === planId);
    },
    estado,
    suscribir(f) { oyentes.add(f); f(estado()); return () => oyentes.delete(f); },
    intentar,
  };
}

/** Envía un cambio aplicado sobre la versión del servidor (con tiempo máximo) */
export async function enviarAFirestore(op) {
  const ref = doc(db, "planes", op.planId);
  const tx = runTransaction(db, async t => {
    const s = await t.get(ref);
    if (!s.exists()) throw Object.assign(new Error("el plan ya no existe"), { code: "not-found" });
    t.update(ref, { ubicaciones: aplicarCambios(s.data().ubicaciones || [], [op]) });
  }, { maxAttempts: 3 });
  let reloj;
  const tope = new Promise((_, no) => { reloj = setTimeout(() => no(Object.assign(new Error("sin cobertura"), { code: "unavailable" })), ESPERA_MS); });
  try { return await Promise.race([tx, tope]); } finally { clearTimeout(reloj); }
}

// Una cola por usuario en toda la app
const colas = new Map();
export const colaDe = uid => { if (!colas.has(uid)) colas.set(uid, crearCola(uid)); return colas.get(uid); };
