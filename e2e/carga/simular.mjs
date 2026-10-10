/* global process */
// Prueba de carga contra los EMULADORES (nunca producción): N conductores a la
// vez en la app de Rutas (cada uno con su sesión, sus escuchas y su GPS cada
// 20 s, marcando paradas con la misma transacción que la app; parte de ellos
// en rutas compartidas, para que choquen) y varias personas con Control
// abierto (escuchas de Control en Node + Control en navegadores de verdad).
// Mide tiempos, choques, cuánto tarda en verse cada parada en Control, si la
// pantalla de Control va fluida, y cuenta lecturas y escrituras.
//
//   firebase emulators:exec --only auth,firestore --project demo-operanzia "node e2e/compilar.mjs && node e2e/carga/simular.mjs"
//   (CONDUCTORES=… SEGUNDOS=… para cambiarlo; por defecto 200 y 3 min)
// Ojo: cada conductor simulado es un cliente de Firebase completo (~20 MB);
// con 200 hacen falta unos 6 GB libres (simulador + emulador).

import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, initializeAuth, inMemoryPersistence } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, collection, query, where, onSnapshot, doc, runTransaction, setDoc, limit } from "firebase/firestore";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { valor } from "../semilla.mjs";

const N = Number(process.env.CONDUCTORES || 200);
const SEGUNDOS = Number(process.env.SEGUNDOS || 180);
const OBSERVADORES = 3;            // personas con Control abierto (escuchas en Node)
const NAVEGADORES = 2;             // Control en navegadores de verdad (fluidez)
const MARCA_CADA = [15, 30];       // s entre paradas marcadas (≈6 veces más rápido que en la calle)
const GPS_CADA = 20;               // s, como la app (MIN_INTERVAL_MS)
const COMPARTIDAS = 20;            // rutas compartidas; cada una la tocan varios conductores a la vez
const PARADAS = 40;
const PROYECTO = "demo-operanzia", ORG = "carga", CLAVE = "Carga-123";
const FS = `http://127.0.0.1:8080/v1/projects/${PROYECTO}/databases/(default)/documents`;
const owner = { Authorization: "Bearer owner", "Content-Type": "application/json" };
const mes = new Date().toISOString().slice(0, 7);
const config = { apiKey: "demo", projectId: PROYECTO, authDomain: `${PROYECTO}.firebaseapp.com` };

const ahora = () => Date.now();
const pausa = ms => new Promise(r => setTimeout(r, ms));
const azar = ([a, b]) => (a + Math.random() * (b - a)) * 1000;
const pct = (l, p) => { if (!l.length) return null; const s = [...l].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const resumen = l => ({ n: l.length, p50: pct(l, 0.5), p95: pct(l, 0.95), p99: pct(l, 0.99), max: l.length ? Math.max(...l) : null });

// ── 1) Datos ────────────────────────────────────────────────────────────
async function lote(docs) {
  for (let i = 0; i < docs.length; i += 400) {
    const writes = docs.slice(i, i + 400).map(([ruta, datos]) => ({ update: { name: `projects/${PROYECTO}/databases/(default)/documents/${ruta}`, fields: valor(datos).mapValue.fields } }));
    const r = await fetch(`${FS}:commit`, { method: "POST", headers: owner, body: JSON.stringify({ writes }) });
    if (!r.ok) throw new Error(`lote: ${r.status} ${await r.text()}`);
  }
}
async function cuenta(email) {
  const r = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: CLAVE, returnSecureToken: true }) });
  const j = await r.json();
  if (!j.localId) throw new Error(`cuenta ${email}: ${JSON.stringify(j)}`);
  return j.localId;
}
async function sembrar() {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROYECTO}/accounts`, { method: "DELETE" });
  const emails = [...Array.from({ length: N }, (_, i) => `conductor${i}@carga.test`), ...Array.from({ length: Math.max(OBSERVADORES, NAVEGADORES) }, (_, i) => `jefe${i}@carga.test`)];
  const uids = [];
  for (let i = 0; i < emails.length; i += 25) uids.push(...await Promise.all(emails.slice(i, i + 25).map(cuenta)));
  const docs = [[`orgs/${ORG}`, { nombre: "Carga", org_id: ORG, activo: true, max_usuarios: 1000, plan: "pro" }],
    ["scheduling_projects/p-carga", { org_id: ORG, nombre: "Proyecto de carga", tipo: "puntos", mes, createdAt: ahora(), status: "borrador" }]];
  emails.forEach((e, i) => docs.push([`usuarios/${uids[i]}`, { email: e, nombre: i < N ? `Conductor ${i}` : `Jefe ${i - N}`, apellidos: "Carga", rol: i < N ? "conductor" : "admin", org_id: ORG, activo: true }]));
  const paradas = k => Array.from({ length: PARADAS }, (_, j) => ({ id: j + 1, nombre: `Parada ${j + 1}`, calle: `Calle ${j}`, lat: 40.4 + (k % 20) / 100 + j / 2000, lng: -3.7 + Math.floor(k / 20) / 100, elementos: [], realizado: false, realizadoPor: null, realizadoEn: null, orden: j + 1 }));
  for (let i = 0; i < N; i++) docs.push([`planes/propio-${i}`, { org_id: ORG, tipo: "prev", nombre: `Ruta ${i}`, mes, diaServicio: "Día 01", conductorUid: uids[i], conductorNombre: `Conductor ${i}`, ubicaciones: paradas(i), fechaSubida: ahora() - i, archivo: "carga" }]);
  for (let c = 0; c < COMPARTIDAS; c++) docs.push([`planes/compartido-${c}`, { org_id: ORG, tipo: "prev", nombre: `Compartida ${c}`, mes, diaServicio: "Día 02", conductorUid: null, ubicaciones: paradas(1000 + c), fechaSubida: ahora() - N - c, archivo: "carga" }]);
  await lote(docs);
  return { uids, emails };
}

// ── 2) Conductores simulados ────────────────────────────────────────────
const m = { marcar: [], intentos: [], fallos: 0, gps: [], gpsFallos: 0, lecturasConductores: 0, escrituras: 0, choques: 0 };
const mc = { marcas: [], gps: [], lecturas: 0, eventos: 0 }; // en Control (Node)
let corriendo = true;

async function abrir(nombre, email) {
  const app = initializeApp(config, nombre);
  const auth = initializeAuth(app, { persistence: inMemoryPersistence });
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const cred = await signInWithEmailAndPassword(auth, email, CLAVE);
  return { app, db, uid: cred.user.uid };
}

async function conductor(i, email, compartida) {
  const { app, db, uid } = await abrir(`c${i}`, email);
  // lo mismo que escucha la app de Rutas: sus planes y los compartidos del mes
  const fuera = [
    onSnapshot(query(collection(db, "planes"), where("org_id", "==", ORG), where("conductorUid", "==", uid), where("mes", "in", [mes])), s => { m.lecturasConductores += s.docChanges().length; }),
    onSnapshot(query(collection(db, "planes"), where("org_id", "==", ORG), where("conductorUid", "==", null), where("mes", "in", [mes])), s => { m.lecturasConductores += s.docChanges().length; }),
  ];
  let siguiente = 1, siguienteComp = 1 + (i % PARADAS);
  const gps = async () => {
    const t0 = ahora();
    try {
      await setDoc(doc(db, "ubicaciones_activas", uid), { uid, org_id: ORG, nombre: `Conductor ${i}`, lat: 40.4 + Math.random() / 10, lng: -3.7 + Math.random() / 10, planId: `propio-${i}`, activo: true, updatedAt: ahora(), lastMovedAt: ahora() }, { merge: true });
      m.gps.push(ahora() - t0); m.escrituras++;
    } catch { m.gpsFallos++; }
  };
  const marcar = async () => {
    // 1 de cada 3 conductores también trabaja una ruta compartida (con otros a la vez)
    const enCompartida = compartida != null && Math.random() < 0.5;
    const ref = doc(db, "planes", enCompartida ? `compartido-${compartida}` : `propio-${i}`);
    const id = enCompartida ? siguienteComp : siguiente;
    if (id > PARADAS) return;
    const t0 = ahora();
    let intentos = 0;
    try {
      await runTransaction(db, async tx => {
        intentos++;
        const s = await tx.get(ref);
        tx.update(ref, { ubicaciones: (s.data().ubicaciones || []).map(u => (u.id === id ? { ...u, realizado: true, realizadoPor: uid, realizadoEn: ahora() } : u)) });
      });
      m.marcar.push(ahora() - t0); m.intentos.push(intentos); m.escrituras++;
      if (intentos > 1) m.choques++;
      if (enCompartida) siguienteComp = siguienteComp % PARADAS + 1; else siguiente++;
    } catch { m.fallos++; }
  };
  await pausa(Math.random() * GPS_CADA * 1000);
  const tg = setInterval(gps, GPS_CADA * 1000);
  gps();
  while (corriendo) { await pausa(azar(MARCA_CADA)); if (corriendo) await marcar(); }
  clearInterval(tg);
  fuera.forEach(f => f());
  await deleteApp(app);
}

// ── 3) Control en Node (lo que escucha Control: planes y posiciones) ─────
async function observador(k, email) {
  const { app, db } = await abrir(`o${k}`, email);
  const vistas = new Map(); // plan → realizadoEn ya visto por parada
  const fuera = [
    onSnapshot(query(collection(db, "planes"), where("org_id", "==", ORG), where("mes", "==", mes), limit(300)), s => {
      const t = ahora();
      for (const c of s.docChanges()) {
        mc.lecturas++;
        const antes = vistas.get(c.doc.id) || {};
        const now = {};
        for (const u of c.doc.data().ubicaciones || []) if (u.realizadoEn) { now[u.id] = u.realizadoEn; if (!antes[u.id] && c.type === "modified") mc.marcas.push(t - u.realizadoEn); }
        vistas.set(c.doc.id, now);
      }
    }),
    onSnapshot(query(collection(db, "ubicaciones_activas"), where("org_id", "==", ORG)), s => {
      const t = ahora();
      for (const c of s.docChanges()) { mc.lecturas++; if (c.type === "modified") mc.gps.push(t - c.doc.data().updatedAt); }
    }),
  ];
  while (corriendo) await pausa(500);
  fuera.forEach(f => f());
  await deleteApp(app);
}

// ── 4) Control en navegadores de verdad (fluidez de la pantalla) ─────────
async function navegadores(emails) {
  const srv = spawn("npx", ["vite", "preview", "--outDir", "dist-e2e", "--port", "4318", "--strictPort", "--host", "127.0.0.1"], { shell: true });
  await pausa(4000);
  const b = await chromium.launch({ channel: process.env.CI ? undefined : "chrome" });
  const paginas = [];
  for (const [k, email] of emails.entries()) {
    const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
    await p.addInitScript(() => {
      window.__largas = [];
      new PerformanceObserver(l => { for (const e of l.getEntries()) window.__largas.push(e.duration); }).observe({ type: "longtask", buffered: true });
    });
    await p.goto("http://127.0.0.1:4318/login");
    await p.fill('input[type="email"]', email);
    await p.fill('input[type="password"]', CLAVE);
    await p.getByRole("button", { name: "Acceder" }).click();
    await p.waitForURL(/\/projects/, { timeout: 30000 });
    // Control se abre desde un proyecto, como lo haría una persona
    await p.getByText("Abrir proyecto").first().click();
    await p.getByRole("button", { name: "Control", exact: true }).first().click();
    await p.getByText(/Ruta \d+/).first().waitFor({ timeout: 60000 });
    // el segundo, en el mapa de flota (las posiciones GPS moviéndose)
    if (k === 1) await p.getByRole("button", { name: "Mapa de flota" }).click();
    await pausa(3000);
    await p.evaluate(() => { window.__largas = []; });
    paginas.push(p);
  }
  return { b, srv, paginas };
}

// ── 5) Correr y medir ───────────────────────────────────────────────────
const t0 = ahora();
console.log(`Sembrando ${N} conductores…`);
const { emails } = await sembrar();
const nav = NAVEGADORES ? await navegadores(emails.slice(N, N + NAVEGADORES)) : null;
console.log(`Entrando ${N} conductores y ${OBSERVADORES} personas en Control…`);
const tareas = [];
for (let k = 0; k < OBSERVADORES; k++) tareas.push(observador(k, emails[N + k]));
for (let i = 0; i < N; i++) {
  tareas.push(conductor(i, emails[i], i % 3 === 0 ? (i / 3) % COMPARTIDAS : null));
  if (i % 20 === 19) await pausa(500); // entran poco a poco, como al empezar el turno
}
const inicio = ahora();
console.log(`En marcha ${SEGUNDOS} s…`);
const memoria = [];
const tm = setInterval(() => memoria.push(process.memoryUsage().rss / 1e6), 5000);
await pausa(SEGUNDOS * 1000);
let pantalla = [];
if (nav) {
  pantalla = await Promise.all(nav.paginas.map(async p => {
    const largas = await p.evaluate(() => window.__largas);
    const heap = await p.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize / 1e6 : null));
    // ¿responde? tiempo de un clic en el selector de vista
    const c0 = Date.now();
    await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    return { largas, heap, frame: Date.now() - c0 };
  }));
}
const fin = ahora();
if (nav) await nav.paginas[0].screenshot({ path: new URL("./control.png", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1") });
corriendo = false;
clearInterval(tm);
await Promise.allSettled(tareas);
if (nav) { await nav.b.close(); nav.srv.kill(); spawn("taskkill", ["/pid", String(nav.srv.pid), "/T", "/F"], { shell: true }); }
const dur = (fin - inicio) / 1000;

const informe = {
  conductores: N, segundos: Math.round(dur), personasEnControl: OBSERVADORES + NAVEGADORES,
  marcarParada_ms: resumen(m.marcar), reintentosPorChoque: m.choques, fallosMarcar: m.fallos,
  gps_ms: resumen(m.gps), fallosGps: m.gpsFallos,
  verEnControl_marca_ms: resumen(mc.marcas), verEnControl_gps_ms: resumen(mc.gps),
  escrituras: m.escrituras, escriturasPorSegundo: +(m.escrituras / dur).toFixed(1),
  lecturasConductores: m.lecturasConductores, lecturasPorPersonaEnControl: Math.round(mc.lecturas / OBSERVADORES),
  pantallaControl: pantalla.map(x => ({ tareasLargas: x.largas.length, msBloqueado: Math.round(x.largas.reduce((s, d) => s + d, 0)), peorBloqueo_ms: Math.round(Math.max(0, ...x.largas)), memoriaMB: x.heap && Math.round(x.heap), respuesta_ms: x.frame })),
  memoriaSimuladorMB: Math.round(Math.max(...memoria, 0)),
  totalMin: +((ahora() - t0) / 60000).toFixed(1),
};
writeFileSync(new URL("./resultado.json", import.meta.url), JSON.stringify(informe, null, 2));
console.log(JSON.stringify(informe, null, 2));
process.exit(0);
