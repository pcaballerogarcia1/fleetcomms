// Panel del superadmin · eliminar una empresa con todos sus datos.
//  1) recorrer: encuentra todo lo suyo (también lo de sus concursos y de sus
//     proyectos, con sus «trozos» y subcolecciones) y lo lee para la copia;
//  2) la copia se descarga (JSON) antes de borrar nada;
//  3) borrar: en tandas, de dentro afuera (primero los trozos, al final la
//     ficha de la empresa). Si se corta, se vuelve a recorrer y sigue.
// Las cuentas de acceso (Firebase Authentication) no se pueden borrar desde
// el navegador: se dan sus correos para borrarlas a mano.
import { Bytes, GeoPoint, Timestamp, collection, doc, getDoc, getDocs, query, where, writeBatch } from "firebase/firestore";
import { db } from "../firebase.js";

// colecciones con el campo org_id, y sus subcolecciones (nombre o [nombre, sus subcolecciones])
export const POR_EMPRESA = [
  ["planes"], ["incidencias"], ["inventario"], ["movimientos"], ["avisos_suscripciones"], ["pedidos"], ["pedidos_fijos"],
  ["ia_conexiones"], ["entregas_pruebas"], ["pesadas"], ["scheduling_vehicles"], ["scheduling_workers"], ["scheduling_constraint_templates"],
  ["documentos", ["trozos"]], ["documentos_lecturas"], ["solicitudes_ausencia"], ["cuadrantes"], ["rostering", ["trabajadores", "versiones"]],
  ["rostering_vehicles"], ["auditoria"], ["presencia"], ["ubicaciones_activas"], ["servicio_lineas", ["turnos"]], ["ubicaciones_lineas"],
  ["fichajes"], ["errores"], ["concursos", ["requisitos", ["documentos", ["texto", "pdf"]]]],
];
// colecciones de un proyecto: por su campo projectId, o con el id del proyecto como id del documento
export const POR_PROYECTO_CAMPO = [["planning_layers", ["trozos"]]];
export const POR_PROYECTO_ID = [["planning_depots"], ["planning_settings"], ["scheduling_scenarios", ["trozos"]], ["planning_inventario", ["trozos"]], ["scheduling_roster", ["partes"]], ["precios", ["trozos"]]];
export const SUB_PROYECTO = ["timetable", "scenario_history", "analytics"];
// fichas con el id de la empresa
export const POR_ID_EMPRESA = ["ia_ajustes", "concursos_vigilancia", "gps_conexiones", "depots_fichaje"];

const subsDe = spec => (spec || []).map(s => (Array.isArray(s) ? s : [s, []]));

/**
 * Recorre todo lo de la empresa. → { docs: [{ ruta, datos }] (de dentro afuera), porColeccion, correos }
 * @param alAvanzar (texto, encontrados) para enseñar por dónde va
 */
export async function recorrerEmpresa(org, alAvanzar = () => {}) {
  const docs = [];
  const porColeccion = {};
  const vistos = new Set();
  const apuntar = (ref, datos) => {
    if (vistos.has(ref.path)) return;
    vistos.add(ref.path);
    docs.push({ ruta: ref.path, datos });
    const col = ref.path.split("/").filter((_, i) => i % 2 === 0).join("/");
    porColeccion[col] = (porColeccion[col] || 0) + 1;
  };
  // un documento y, antes, sus subcolecciones
  async function conSubs(ref, datos, subs) {
    for (const [nombre, dentro] of subsDe(subs)) {
      const s = await getDocs(collection(ref, nombre));
      for (const d of s.docs) await conSubs(d.ref, d.data(), dentro);
    }
    apuntar(ref, datos);
  }

  // la empresa y los espacios de sus concursos (llevan su propio org_id)
  alAvanzar("concursos", docs.length);
  const concursos = await getDocs(query(collection(db, "concursos"), where("org_id", "==", org)));
  const espacios = [org, ...concursos.docs.map(d => d.data().espacio).filter(Boolean)];

  // los proyectos (de la empresa y de sus concursos), con todo lo suyo
  const proyectos = [];
  for (const e of espacios) proyectos.push(...(await getDocs(query(collection(db, "scheduling_projects"), where("org_id", "==", e)))).docs);
  for (const [i, p] of proyectos.entries()) {
    alAvanzar(`proyecto ${i + 1} de ${proyectos.length}`, docs.length);
    for (const [col, subs] of POR_PROYECTO_CAMPO) {
      for (const d of (await getDocs(query(collection(db, col), where("projectId", "==", p.id)))).docs) await conSubs(d.ref, d.data(), subs);
    }
    for (const [col, subs] of POR_PROYECTO_ID) {
      const ref = doc(db, col, p.id);
      const s = await getDoc(ref);
      if (s.exists()) await conSubs(ref, s.data(), subs);
      else for (const [nombre] of subsDe(subs)) for (const d of (await getDocs(collection(ref, nombre))).docs) apuntar(d.ref, d.data()); // trozos sueltos
    }
    await conSubs(p.ref, p.data(), SUB_PROYECTO);
  }

  // lo que lleva org_id (de la empresa y de sus concursos)
  for (const [col, subs] of POR_EMPRESA) {
    alAvanzar(col, docs.length);
    for (const e of espacios) {
      for (const d of (await getDocs(query(collection(db, col), where("org_id", "==", e)))).docs) await conSubs(d.ref, d.data(), subs);
    }
  }
  for (const col of POR_ID_EMPRESA) {
    const s = await getDoc(doc(db, col, org));
    if (s.exists()) apuntar(s.ref, s.data());
  }
  // al final: los usuarios y la ficha de la empresa
  alAvanzar("usuarios", docs.length);
  const usuarios = (await getDocs(query(collection(db, "usuarios"), where("org_id", "==", org)))).docs;
  for (const u of usuarios) apuntar(u.ref, u.data());
  const ficha = await getDoc(doc(db, "orgs", org));
  if (ficha.exists()) apuntar(ficha.ref, ficha.data());
  return { docs, porColeccion, correos: usuarios.map(u => u.data().email).filter(Boolean), proyectos: proyectos.length, concursos: concursos.size };
}

/** Un valor de Firestore, para guardarlo en JSON (y poder recuperarlo) */
export function aJson(v) {
  if (v instanceof Timestamp) return { __fecha: v.toDate().toISOString() };
  if (v instanceof Bytes) return { __bytes: v.toBase64() };
  if (v instanceof GeoPoint) return { __geo: [v.latitude, v.longitude] };
  if (v?.path && v?.firestore) return { __ref: v.path };
  if (Array.isArray(v)) return v.map(aJson);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, aJson(x)]));
  return v;
}

/** La copia de todo, como un archivo para descargar */
export function copiaDeEmpresa(org, recorrido, ahora = new Date()) {
  const contenido = JSON.stringify({ empresa: org, hecha: ahora.toISOString(), documentos: recorrido.docs.map(d => ({ ruta: d.ruta, datos: aJson(d.datos) })) });
  return { nombre: `operanzia-copia-${org}-${ahora.toISOString().slice(0, 10)}.json`, blob: new Blob([contenido], { type: "application/json" }) };
}

/**
 * Borra lo recorrido en tandas de 400 (en el orden del recorrido: de dentro afuera).
 * Como mucho `maximo` (la cuota del día); el resto, otro día volviendo a recorrer. → cuántos borró
 */
export async function borrarRecorrido(recorrido, alAvanzar = () => {}, maximo = LIMITE_DIARIO) {
  const docs = recorrido.docs.slice(0, maximo);
  for (let i = 0; i < docs.length; i += 400) {
    const b = writeBatch(db);
    for (const d of docs.slice(i, i + 400)) b.delete(doc(db, d.ruta));
    await b.commit();
    alAvanzar(Math.min(i + 400, docs.length), docs.length);
  }
  return docs.length;
}

// la cuota gratuita de Firestore (plan Spark) es de 20.000 escrituras al día
export const LIMITE_DIARIO = 18000;
