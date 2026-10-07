// Arreglo automático de planes antiguos (sustituye a ejecutar a mano
// scripts/migrar-planes-sin-conductor.mjs).
//
// La app de Rutas pide a cada conductor los planes compartidos con
// where("conductorUid", "==", null), y Firestore no encuentra así los
// documentos a los que les FALTA el campo. Los planes creados antes de este
// cambio no lo tienen: cuando entra alguien que gestiona rutas (admin,
// intermedio o superadmin), se miran los 300 planes más recientes de su
// organización y se les pone conductorUid: null a los que no lo tienen.
//
// Una vez por organización y navegador (se recuerda en localStorage); si
// falla, se reintenta en la siguiente entrada. Los planes nuevos ya se crean
// con el campo, así que no vuelve a hacer falta.

import { db } from "./firebase.js";
import { collection, query, where, orderBy, limit, getDocs, writeBatch } from "firebase/firestore";
import { puedeGestionarRutas } from "./roles.js";

export const CLAVE_HECHO = "planes-conductorUid-v1:";
const N = 300;

const yaHecho = org => { try { return localStorage.getItem(CLAVE_HECHO + org) === "1"; } catch { return false; } };
const marcarHecho = org => { try { localStorage.setItem(CLAVE_HECHO + org, "1"); } catch { /* sin almacenamiento: se repetirá */ } };

/** Devuelve cuántos planes ha arreglado (0 si no tocaba o ya estaba hecho). */
export async function repararPlanesSinConductor(sesion) {
  const org = sesion?.org_id;
  if (!org || !puedeGestionarRutas(sesion?.rol) || yaHecho(org)) return 0;
  const snap = await getDocs(query(collection(db, "planes"), where("org_id", "==", org), orderBy("fechaSubida", "desc"), limit(N)));
  const sinCampo = snap.docs.filter(d => !("conductorUid" in d.data()));
  for (let i = 0; i < sinCampo.length; i += 400) {
    const lote = writeBatch(db);
    for (const d of sinCampo.slice(i, i + 400)) lote.update(d.ref, { conductorUid: null });
    await lote.commit();
  }
  marcarHecho(org);
  if (sinCampo.length) console.info(`[planes] ${sinCampo.length} planes antiguos marcados como compartidos (conductorUid: null)`);
  return sinCampo.length;
}
