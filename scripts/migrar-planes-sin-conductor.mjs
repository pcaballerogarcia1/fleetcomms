// Migración: pone conductorUid: null en los planes que no tienen ese campo.
//
// Por qué: la app de Rutas ya no descarga los 300 planes más recientes de la
// organización para cada conductor; pide solo los suyos y los compartidos
// (where conductorUid == null). Firestore no encuentra con == null los
// documentos a los que les FALTA el campo, así que los planes antiguos sin él
// dejarían de verse. Hay que ejecutar esto ANTES de desplegar la app.
//
// Sin --aplicar solo cuenta (no escribe nada). Dos formas de entrar:
//
//  a) Con un usuario de la app (las reglas solo dejan ver la organización
//     propia: una vez por organización, con un administrador de cada una):
//       MIGRAR_CLAVE=... node scripts/migrar-planes-sin-conductor.mjs --proyecto <id> --email admin@empresa.com [--aplicar]
//
//  b) Con un token de Google de un propietario del proyecto (todas las
//     organizaciones de una vez), p. ej. `gcloud auth print-access-token`:
//       FIRESTORE_TOKEN=... node scripts/migrar-planes-sin-conductor.mjs --proyecto <id> [--aplicar]
//
//  Pruebas contra los emuladores: añade --emulador (proyecto demo-operanzia).
//
// Solo toca el campo conductorUid (updateMask) y solo si el documento sigue
// existiendo. Lee cada plan una vez (cuenta en las lecturas del día).

import { readFileSync } from "node:fs";

// Fallo de uso (falta un dato, no se pudo entrar…): se enseña solo el mensaje
class Aviso extends Error {}

const args = process.argv.slice(2);
const opcion = n => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const emulador = args.includes("--emulador");
const aplicar = args.includes("--aplicar");
const proyecto = emulador ? "demo-operanzia" : opcion("--proyecto");
const email = opcion("--email");

const FS = emulador ? "http://127.0.0.1:8080/v1" : "https://firestore.googleapis.com/v1";
const raiz = `projects/${proyecto}/databases/(default)/documents`;

async function pedir(url, opciones = {}, token) {
  const r = await fetch(url, { ...opciones, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

// La clave web de Firebase es pública (va en la app); se toma de la misma config
function claveWeb() {
  if (process.env.VITE_FIREBASE_API_KEY) return process.env.VITE_FIREBASE_API_KEY;
  const src = readFileSync(new URL("../src/firebase.js.js", import.meta.url), "utf8");
  return src.match(/apiKey:\s*env\.VITE_FIREBASE_API_KEY\s*\|\|\s*"([^"]+)"/)?.[1];
}

async function entrarConUsuario() {
  const clave = process.env.MIGRAR_CLAVE;
  if (!clave) throw new Aviso("Falta la contraseña en la variable MIGRAR_CLAVE");
  const base = emulador ? "http://127.0.0.1:9099/identitytoolkit.googleapis.com" : "https://identitytoolkit.googleapis.com";
  const r = await fetch(`${base}/v1/accounts:signInWithPassword?key=${emulador ? "demo" : claveWeb()}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: clave, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Aviso(`No se pudo entrar: ${j.error?.message || r.status}`);
  const perfil = await pedir(`${FS}/${raiz}/usuarios/${j.localId}`, {}, j.idToken);
  const org = perfil.fields?.org_id?.stringValue;
  if (!org) throw new Aviso("Ese usuario no tiene organización");
  return { token: j.idToken, org };
}

// Planes que no tienen el campo: [{ name, org }]
async function planesSinCampo(token, org) {
  const docs = [];
  if (org) {
    // Con usuario: consulta filtrada por su organización (lo único que dejan las reglas)
    const filas = await pedir(`${FS}/${raiz}:runQuery`, {
      method: "POST",
      body: JSON.stringify({ structuredQuery: {
        from: [{ collectionId: "planes" }],
        where: { fieldFilter: { field: { fieldPath: "org_id" }, op: "EQUAL", value: { stringValue: org } } },
        select: { fields: [{ fieldPath: "conductorUid" }, { fieldPath: "org_id" }] },
      } }),
    }, token);
    for (const f of filas) if (f.document) docs.push(f.document);
  } else {
    let pagina = "";
    do {
      const j = await pedir(`${FS}/${raiz}/planes?pageSize=300&mask.fieldPaths=conductorUid&mask.fieldPaths=org_id${pagina ? `&pageToken=${encodeURIComponent(pagina)}` : ""}`, {}, token);
      docs.push(...(j.documents || []));
      pagina = j.nextPageToken || "";
    } while (pagina);
  }
  return {
    total: docs.length,
    sinCampo: docs.filter(d => !("conductorUid" in (d.fields || {}))).map(d => ({ name: d.name, org: d.fields?.org_id?.stringValue || "(sin org)" })),
  };
}

async function main() {
  if (!proyecto || proyecto.startsWith("--")) throw new Aviso("Falta --proyecto <id> (o --emulador)");
  const { token, org } = email ? await entrarConUsuario()
    : { token: emulador ? "owner" : process.env.FIRESTORE_TOKEN, org: null };
  if (!token) throw new Aviso("Falta --email (con MIGRAR_CLAVE) o la variable FIRESTORE_TOKEN");

  const { total, sinCampo } = await planesSinCampo(token, org);
  console.log(`Proyecto ${proyecto}${org ? `, organización ${org}` : ""}: ${total} planes, ${sinCampo.length} sin conductorUid.`);
  const porOrg = {};
  for (const p of sinCampo) porOrg[p.org] = (porOrg[p.org] || 0) + 1;
  for (const [o, n] of Object.entries(porOrg).sort((a, b) => b[1] - a[1])) console.log(`  ${o}: ${n}`);

  if (!aplicar) {
    console.log(sinCampo.length ? "\nNo se ha escrito nada. Repite con --aplicar para migrarlos." : "\nNada que migrar.");
    return;
  }

  // Lotes de 400: solo el campo, y solo si el documento existe
  let hechos = 0;
  for (let i = 0; i < sinCampo.length; i += 400) {
    const writes = sinCampo.slice(i, i + 400).map(({ name }) => ({
      update: { name, fields: { conductorUid: { nullValue: null } } },
      updateMask: { fieldPaths: ["conductorUid"] },
      currentDocument: { exists: true },
    }));
    await pedir(`${FS}/${raiz}:commit`, { method: "POST", body: JSON.stringify({ writes }) }, token);
    hechos += writes.length;
    console.log(`  ${hechos}/${sinCampo.length}`);
  }
  console.log(`Hecho: ${hechos} planes con conductorUid: null.`);
}

// Sin process.exit(): en Windows rompe Node si quedan conexiones de fetch abiertas
main().catch(e => { console.error(e instanceof Aviso ? e.message : e); process.exitCode = 1; });
