// Simulador de autobuses para el ENTORNO DE PRUEBAS (operanzia-pruebas, nunca
// el real): N conductores ficticios cogen turnos del servicio publicado de
// hoy de un proyecto de líneas y "conducen" en tiempo real sobre su recorrido,
// cada uno con su retraso, para ver Control en marcha en una demo.
//
//   node scripts/simular-autobuses.mjs <projectId> [conductores=25] [minutos=120]
//
// Entra como el superadministrador de pruebas. Escribe lo mismo que el móvil
// del conductor (lo real del turno y la posición cada 30 s), calculado con
// las mismas funciones (src/lineas-servicio.js). Con 25 conductores son unas
// 3.000 escrituras por hora: cabe de sobra en la cuota gratuita de pruebas.
// Al terminar (o con Ctrl+C) marca los autobuses como inactivos.

import { valor } from "../e2e/semilla.mjs";
import { fechaLocal, minutosDesde, servicioId, avanzar, retrasoActual, puntoEn, geoDe, hhmm } from "../src/lineas-servicio.js";

const PROYECTO = "operanzia-pruebas"; // fijo: no puede tocar producción
const CLAVE_WEB = "AIzaSyDfsCXOt8HZGZjdgEKl7b8oh_1frAwyFnk";
const ORG = "pruebas";
const FS = `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`;
const [projectId, nArg, minArg] = process.argv.slice(2);
if (!projectId) { console.error("Uso: node scripts/simular-autobuses.mjs <projectId> [conductores] [minutos]"); process.exit(1); }
const N = Number(nArg) || 25, DURA_MIN = Number(minArg) || 120;
const PASO_MS = 30000;

const desValor = v => {
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(desValor);
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, desValor(x)]));
  return null;
};
const docDe = d => Object.fromEntries(Object.entries(d.fields || {}).map(([k, x]) => [k, desValor(x)]));

let token = null, refresco = null, caduca = 0;
async function entrar() {
  const j = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${CLAVE_WEB}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "superadmin@operanzia-pruebas.test", password: "Pruebas-2026", returnSecureToken: true }),
  }).then(r => r.json());
  if (!j.idToken) throw new Error("No se pudo entrar: " + j.error?.message);
  token = j.idToken; refresco = j.refreshToken; caduca = Date.now() + 50 * 60000;
}
async function tok() {
  if (Date.now() < caduca) return token;
  const j = await fetch(`https://securetoken.googleapis.com/v1/token?key=${CLAVE_WEB}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `grant_type=refresh_token&refresh_token=${refresco}` }).then(r => r.json());
  token = j.id_token; refresco = j.refresh_token; caduca = Date.now() + 50 * 60000;
  return token;
}
const cab = async () => ({ Authorization: `Bearer ${await tok()}`, "Content-Type": "application/json" });
async function leer(ruta) {
  const r = await fetch(`${FS}/${ruta}`, { headers: await cab() });
  if (!r.ok) throw new Error(`leer ${ruta}: ${r.status} ${await r.text()}`);
  return docDe(await r.json());
}
async function listar(ruta) {
  const out = [];
  let page = "";
  do {
    const r = await fetch(`${FS}/${ruta}?pageSize=300${page ? `&pageToken=${page}` : ""}`, { headers: await cab() });
    if (!r.ok) throw new Error(`listar ${ruta}: ${r.status} ${await r.text()}`);
    const j = await r.json();
    for (const d of j.documents || []) out.push({ ...docDe(d), _id: d.name.split("/").pop() });
    page = j.nextPageToken || "";
  } while (page);
  return out;
}
async function parchear(ruta, datos) {
  const mask = Object.keys(datos).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  const r = await fetch(`${FS}/${ruta}?${mask}`, { method: "PATCH", headers: await cab(), body: JSON.stringify({ fields: valor(datos).mapValue.fields }) });
  if (!r.ok) throw new Error(`escribir ${ruta}: ${r.status} ${await r.text()}`);
}

// Dónde está el autobús a la hora `te` (hora "del horario" ya con su retraso)
function posicionEn(turno, te) {
  const vs = turno.viajes;
  for (let i = 0; i < vs.length; i++) {
    const v = vs[i], geo = geoDe(turno, v);
    if (!geo) continue;
    if (te < v.dep) return geo[0];                       // esperando en la cabecera
    if (te <= v.arr) return puntoEn(geo, (te - v.dep) / Math.max(1, v.arr - v.dep));
  }
  const ult = [...vs].reverse().find(v => geoDe(turno, v));
  return ult ? geoDe(turno, ult).at(-1) : null;
}
const ruido = (a = 1) => (Math.random() - 0.5) * 2 * a;
const PERFILES = [0, 0, 0, 1, 1, 2, 3, 4, 6, 8, 13, -3]; // retraso de base de cada conductor (min)

async function main() {
  await entrar();
  const fecha = fechaLocal(), sid = servicioId(projectId, fecha);
  const servicio = await leer(`servicio_lineas/${sid}`).catch(() => null);
  if (!servicio) throw new Error(`No hay servicio publicado hoy (${fecha}) para el proyecto ${projectId}: publícalo desde Scheduling → Publicar a Control.`);
  if (servicio.org_id !== ORG) throw new Error(`El servicio es de la empresa ${servicio.org_id}, no de «${ORG}».`);
  const ahora0 = minutosDesde(fecha);
  const todos = await listar(`servicio_lineas/${sid}/turnos`);
  // turnos en marcha ahora y que seguirán al menos 30 min, sin conductor de verdad
  const libres = todos.filter(t => (!t.conductorUid || String(t.conductorUid).startsWith("sim-")) && t.inicio <= ahora0 + 5 && t.fin >= ahora0 + 30).sort((a, b) => a.inicio - b.inicio);
  const elegidos = libres.slice(0, N);
  console.log(`${servicio.proyecto} · ${fecha} · ahora ${hhmm(ahora0)} · ${todos.length} turnos, ${libres.length} en marcha libres → simulo ${elegidos.length}`);
  if (!elegidos.length) throw new Error("No hay turnos en marcha ahora mismo para simular (prueba a otra hora o publica otro día).");

  const sims = elegidos.map((t, i) => {
    const uid = `sim-${String(i + 1).padStart(2, "0")}`;
    const base = PERFILES[i % PERFILES.length];
    // lo ya hecho antes de empezar la simulación, con su retraso
    const real = { salidas: {}, llegadas: {}, saltados: [] };
    for (const v of t.viajes) {
      if (v.v || v.arr + base > ahora0 - 1) continue;
      real.salidas[v.k] = Math.round(v.dep + Math.max(-1, base * 0.6 + ruido(1.5)));
      real.llegadas[v.k] = Math.round(v.arr + Math.max(-1, base * 0.6 + ruido(1.5)));
    }
    return { uid, nombre: `Conductor simulado ${i + 1}`, turno: t, base, deriva: 0, real, actual: -1 };
  });
  for (const s of sims) {
    await parchear(`servicio_lineas/${sid}/turnos/${s.turno.id}`, { conductorUid: s.uid, conductorNombre: s.nombre, inicioReal: Math.round(Math.min(ahora0, s.turno.inicio)), finReal: null, real: s.real, actualizado: Date.now() });
  }
  console.log("Turnos cogidos. Conduciendo… (Ctrl+C para parar)");

  let parar = false;
  const acabar = async () => {
    if (parar) return; parar = true;
    console.log("\nParando: marco los autobuses como inactivos…");
    for (const s of sims) await parchear(`ubicaciones_lineas/${s.uid}`, { activo: false, updatedAt: Date.now() }).catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", acabar);
  const fin = Date.now() + DURA_MIN * 60000;
  let vuelta = 0;
  while (!parar && Date.now() < fin) {
    const t0 = Date.now();
    for (const [i, s] of sims.entries()) {
      // reparte las escrituras a lo largo de los 30 s
      await new Promise(r => setTimeout(r, Math.max(0, t0 + (i * PASO_MS) / sims.length - Date.now())));
      const ahora = minutosDesde(fecha);
      s.deriva = Math.max(-4, Math.min(20, s.deriva + ruido(0.4) + (s.base > 6 ? 0.05 : 0)));
      const retrasoSim = s.base + s.deriva;
      const pos = posicionEn(s.turno, ahora - retrasoSim);
      if (!pos) continue;
      const p = [pos[0] + ruido(0.00008), pos[1] + ruido(0.00008)]; // ~10 m de error de GPS
      const r = avanzar(s.turno, s.real, p, ahora);
      s.real = r.real;
      const terminado = r.actual < 0 && ahora > s.turno.fin + Math.max(0, retrasoSim);
      try {
        if (r.cambios.length || terminado) await parchear(`servicio_lineas/${sid}/turnos/${s.turno.id}`, { real: s.real, ...(terminado ? { finReal: Math.round(ahora) } : {}), actualizado: Date.now() });
        const v = s.turno.viajes[r.actual];
        const retraso = r.actual >= 0 ? retrasoActual(s.turno, s.real, r.actual, r.frac, ahora) : 0;
        await parchear(`ubicaciones_lineas/${s.uid}`, {
          uid: s.uid, org_id: ORG, nombre: s.nombre, servicioId: sid, turnoId: s.turno.id, bus: v?.bus ?? null, linea: v && !v.v ? v.l : null,
          viaje: v ? `${v.v ? "Vacío" : `Línea ${v.l}`}: ${v.on} → ${v.dn} (${hhmm(v.dep)})` : "Fin de los viajes",
          lat: Math.round(p[0] * 1e5) / 1e5, lng: Math.round(p[1] * 1e5) / 1e5, retraso, activo: !terminado, updatedAt: Date.now(),
        });
        if (r.cambios.length) console.log(`${hhmm(ahora)} ${s.turno.id} ${r.cambios.map(c => `${c.tipo} ${c.k}${c.min != null ? ` ${hhmm(c.min)}` : ""}`).join(", ")} · ${retraso >= 0 ? "+" : ""}${retraso} min`);
      } catch (e) { console.error(`${s.turno.id}: ${e.message}`); }
    }
    vuelta++;
    if (vuelta % 10 === 0) console.log(`${hhmm(minutosDesde(fecha))} · ${vuelta} vueltas`);
  }
  await acabar();
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
