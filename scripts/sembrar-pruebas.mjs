// Rellena el ENTORNO DE PRUEBAS (proyecto operanzia-pruebas, nunca el real)
// con una empresa de ejemplo: usuarios de cada tipo, flota, plantilla, rutas,
// incidencias e inventario. Se puede repetir: sobrescribe lo mismo.
//
//   node scripts/sembrar-pruebas.mjs
//
// Cómo entra: crea una cuenta temporal de siembra, despliega en pruebas unas
// reglas que solo la dejan escribir a ella (scripts/pruebas/siembra.rules),
// mete los datos, vuelve a desplegar las reglas de verdad (también si algo
// falla) y borra la cuenta temporal. Necesita la CLI de Firebase con sesión.

import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { valor } from "../e2e/semilla.mjs";

const PROYECTO = "operanzia-pruebas";            // fijo: este script no puede tocar producción
const CLAVE_WEB = "AIzaSyDfsCXOt8HZGZjdgEKl7b8oh_1frAwyFnk"; // pública (app web de pruebas)
const ORG = "pruebas";
export const CLAVE_USUARIOS = "Pruebas-2026";
const DOMINIO = "operanzia-pruebas.test";
const USUARIOS = {
  superadmin: { nombre: "Super", apellidos: "Admin", rol: "superadmin" },
  admin: { nombre: "Ana", apellidos: "Administradora", rol: "admin" },
  jefe: { nombre: "Iván", apellidos: "Jefe de tráfico", rol: "intermedio" },
  conductor1: { nombre: "Carlos", apellidos: "Conductor", rol: "conductor" },
  conductor2: { nombre: "Clara", apellidos: "Conductora", rol: "conductor" },
};

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const FS = `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`;
const ID = "https://identitytoolkit.googleapis.com/v1";

async function cuenta(email, password) {
  const pedir = accion => fetch(`${ID}/accounts:${accion}?key=${CLAVE_WEB}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  }).then(r => r.json());
  let j = await pedir("signUp");
  if (j.error?.message === "EMAIL_EXISTS") j = await pedir("signInWithPassword");
  if (!j.idToken) throw new Error(`cuenta ${email}: ${j.error?.message}`);
  return j;
}

function firebase(args) {
  execSync(`npx firebase ${args} --project ${PROYECTO} --non-interactive`, { cwd: RAIZ, stdio: "inherit" });
}

async function escribirLote(token, docs) {
  for (let i = 0; i < docs.length; i += 400) {
    const writes = docs.slice(i, i + 400).map(([ruta, datos]) => ({
      update: { name: `projects/${PROYECTO}/databases/(default)/documents/${ruta}`, fields: valor(datos).mapValue.fields },
    }));
    const r = await fetch(`${FS}:commit`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ writes }) });
    if (!r.ok) throw new Error(`escribir: ${r.status} ${await r.text()}`);
  }
}

function datos(uids) {
  const docs = [];
  const hoy = new Date();
  const mes = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const mesActual = mes(hoy);
  docs.push([`orgs/${ORG}`, { nombre: "Empresa de pruebas", org_id: ORG, activo: true, max_usuarios: 50, plan: "pro" }]);
  for (const [k, u] of Object.entries(USUARIOS)) {
    docs.push([`usuarios/${uids[k]}`, { ...u, email: `${k}@${DOMINIO}`, org_id: ORG, activo: true }]);
  }
  for (let i = 1; i <= 8; i++) {
    docs.push([`scheduling_vehicles/v${i}`, { org_id: ORG, nombre: `Vehículo ${i}`, matricula: `${1000 + i}PRB`, tipo: i % 2 ? "Camión lateral" : "Furgón", activo: true }]);
  }
  for (let i = 1; i <= 12; i++) {
    docs.push([`scheduling_workers/w${i}`, { org_id: ORG, nombre: `Trabajador ${i}`, apellidos: "De Pruebas", activo: true }]);
  }
  const paradas = n => Array.from({ length: n }, (_, k) => ({
    id: k + 1, nombre: `Parada ${k + 1}`, calle: `Calle Ejemplo ${k + 1}`, num: String(k + 1), barri: ["Centro", "Norte", "Sur"][k % 3],
    lat: 40.41 + k * 0.003, lng: -3.70 + (k % 5) * 0.004, elementos: [], realizado: false, orden: k + 1,
  }));
  const conductores = [[uids.conductor1, "Carlos Conductor"], [uids.conductor2, "Clara Conductora"]];
  for (let d = 1; d <= 10; d++) {
    const [uid, nombre] = conductores[d % 2];
    const dia = `Día ${String(d).padStart(2, "0")}`;
    docs.push([`planes/ruta-${d}`, {
      org_id: ORG, tipo: ["prev", "ext", "int"][d % 3], nombre: `Ruta de ejemplo ${d}`, mes: mesActual, diaServicio: dia,
      conductorUid: d % 4 === 0 ? null : uid, ...(d % 4 === 0 ? {} : { conductorNombre: nombre }),
      ubicaciones: paradas(12), fechaSubida: Date.now() - d * 60000, archivo: "datos de pruebas",
    }]);
  }
  docs.push(["planes/tarea-1", { org_id: ORG, tipo: "corr", titulo: "Revisar frenos del vehículo 3", descripcion: "Hace ruido al frenar", estado: "pendiente", conductorUid: null, fecha: new Date() }]);
  docs.push(["incidencias/inc-1", { org_id: ORG, titulo: "Contenedor roto", descripcion: "Tapa partida en Calle Ejemplo 4", categoria: 0, prioridad: "media", estado: "abierta", comentarios: [], usuarioId: uids.conductor1, fecha: new Date() }]);
  docs.push(["incidencias/inc-2", { org_id: ORG, titulo: "Calle cortada por obras", descripcion: "Desvío por la calle paralela", categoria: 0, prioridad: "alta", estado: "abierta", comentarios: [], usuarioId: uids.conductor2, fecha: new Date(Date.now() - 86400000) }]);
  for (const [i, [nombre, cat]] of [["Filtro de aceite", "Filtros"], ["Pastillas de freno", "Frenos"], ["Bombilla H7", "Eléctrico"], ["Escobilla", "Varios"]].entries()) {
    docs.push([`inventario/prod-${i + 1}`, { org_id: ORG, nombre, referencia: `REF-${i + 1}`, categoria: cat, unidad: "ud", stock: 10 + i * 5, stockMin: 3, ubicacion: `A${i + 1}` }]);
  }
  docs.push(["scheduling_projects/proyecto-ejemplo", { org_id: ORG, nombre: "Proyecto de ejemplo", tipo: "puntos", mes: mesActual, createdAt: Date.now(), status: "borrador" }]);
  return docs;
}

async function main() {
  const siembra = { email: `siembra@${DOMINIO}`, clave: randomBytes(12).toString("hex") };
  console.log(`Entorno de pruebas (${PROYECTO}): creando usuarios…`);
  const uids = {};
  for (const k of Object.keys(USUARIOS)) uids[k] = (await cuenta(`${k}@${DOMINIO}`, CLAVE_USUARIOS)).localId;
  const s = await cuenta(siembra.email, siembra.clave);
  try {
    console.log("Reglas temporales de siembra…");
    firebase("deploy --only firestore:rules --config scripts/pruebas/firebase.siembra.json");
    const docs = datos(uids);
    await escribirLote(s.idToken, docs);
    console.log(`${docs.length} documentos de ejemplo escritos.`);
  } finally {
    console.log("Volviendo a poner las reglas de verdad…");
    firebase("deploy --only firestore:rules");
    await fetch(`${ID}/accounts:delete?key=${CLAVE_WEB}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: s.idToken }) });
  }
  console.log(`\nListo. Usuarios (contraseña ${CLAVE_USUARIOS}):`);
  for (const [k, u] of Object.entries(USUARIOS)) console.log(`  ${k}@${DOMINIO}  (${u.rol})`);
}

main().catch(e => { console.error(e.message || e); process.exitCode = 1; });
