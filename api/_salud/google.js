// Acceso del servidor a Google con la cuenta de servicio de Firebase
// (variable de entorno FIREBASE_CUENTA_SERVICIO: el JSON de la clave, en
// base64). Sin librerías de Google: un JWT firmado con jose → token OAuth, y
// las API REST de Firestore y Cloud Monitoring.
import { SignJWT, importPKCS8 } from "jose";

export function cuentaServicio(env = globalThis.process?.env || {}) {
  const raw = env.FIREBASE_CUENTA_SERVICIO;
  if (!raw) return null;
  try { return JSON.parse(raw.trim().startsWith("{") ? raw : globalThis.Buffer.from(raw, "base64").toString("utf8")); } catch { return null; }
}

const tokens = new Map(); // scope → { token, hasta }
export async function tokenGoogle(sa, scope = "https://www.googleapis.com/auth/cloud-platform", f = fetch) {
  const c = tokens.get(scope);
  if (c && c.hasta > Date.now() + 60_000) return c.token;
  const clave = await importPKCS8(sa.private_key, "RS256");
  const ahora = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({ scope }).setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email).setAudience("https://oauth2.googleapis.com/token").setIssuedAt(ahora).setExpirationTime(ahora + 3600).sign(clave);
  const r = await f("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}` });
  const j = await r.json();
  if (!r.ok) throw new Error(`token de Google: ${j.error_description || j.error || r.status}`);
  tokens.set(scope, { token: j.access_token, hasta: Date.now() + (j.expires_in || 3600) * 1000 });
  return j.access_token;
}

// ── Firestore REST: de/a sus «valores con tipo» ──────────────────────
export function desdeValor(v) {
  if (!v || typeof v !== "object") return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(desdeValor);
  if ("mapValue" in v) return desdeCampos(v.mapValue.fields || {});
  return null;
}
export const desdeCampos = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, desdeValor(v)]));
export function aValor(x) {
  if (x === null || x === undefined) return { nullValue: null };
  if (typeof x === "boolean") return { booleanValue: x };
  if (typeof x === "number") return Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x };
  if (Array.isArray(x)) return { arrayValue: { values: x.map(aValor) } };
  if (typeof x === "object") return { mapValue: { fields: Object.fromEntries(Object.entries(x).map(([k, v]) => [k, aValor(v)])) } };
  return { stringValue: String(x) };
}

export function firestore(sa, f = fetch) {
  const base = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents`;
  const cab = async () => ({ Authorization: `Bearer ${await tokenGoogle(sa, "https://www.googleapis.com/auth/datastore", f)}`, "Content-Type": "application/json" });
  return {
    async leer(ruta) {
      const r = await f(`${base}/${ruta}`, { headers: await cab() });
      if (r.status === 404) return null;
      const j = await r.json();
      if (!r.ok) throw new Error(`Firestore ${ruta}: ${j.error?.message || r.status}`);
      return desdeCampos(j.fields);
    },
    async escribir(ruta, datos) {
      const r = await f(`${base}/${ruta}`, { method: "PATCH", headers: await cab(), body: JSON.stringify({ fields: Object.fromEntries(Object.entries(datos).map(([k, v]) => [k, aValor(v)])) }) });
      if (!r.ok) throw new Error(`Firestore ${ruta}: ${(await r.json()).error?.message || r.status}`);
    },
    /** documentos de `coleccion` con campo == valor */
    async buscar(coleccion, campo, valor) {
      const r = await f(`${base}:runQuery`, { method: "POST", headers: await cab(), body: JSON.stringify({ structuredQuery: { from: [{ collectionId: coleccion }], where: { fieldFilter: { field: { fieldPath: campo }, op: "EQUAL", value: aValor(valor) } }, limit: 50 } }) });
      const j = await r.json();
      if (!r.ok) throw new Error(`Firestore ${coleccion}: ${j.error?.message || j[0]?.error?.message || r.status}`);
      return j.filter(x => x.document).map(x => ({ _id: x.document.name.split("/").pop(), ...desdeCampos(x.document.fields) }));
    },
  };
}

// ── Consumo de Firestore de hoy (Cloud Monitoring) ───────────────────
// El plan gratuito (Spark) da cada día 50.000 lecturas, 20.000 escrituras y
// 20.000 borrados; el contador vuelve a cero a medianoche de California
// (las 9:00 en España en verano, las 9:00 también en invierno).
export const LIMITES_SPARK = { lecturas: 50_000, escrituras: 20_000, borrados: 20_000 };

/** Inicio del «día de cuota» (medianoche de Los Ángeles) en ISO */
export function inicioDiaCuota(ahora = new Date()) {
  const la = new Date(ahora.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const desfase = ahora.getTime() - la.getTime();
  la.setHours(0, 0, 0, 0);
  return new Date(la.getTime() + desfase).toISOString();
}

export async function consumoHoy(sa, f = fetch, ahora = new Date()) {
  const token = await tokenGoogle(sa, "https://www.googleapis.com/auth/cloud-platform", f);
  const desde = inicioDiaCuota(ahora), hasta = ahora.toISOString();
  const metrica = async tipo => {
    const filtro = encodeURIComponent(`metric.type="firestore.googleapis.com/document/${tipo}"`);
    const url = `https://monitoring.googleapis.com/v3/projects/${sa.project_id}/timeSeries?filter=${filtro}&interval.startTime=${desde}&interval.endTime=${hasta}`
      + `&aggregation.alignmentPeriod=${Math.max(60, Math.ceil((ahora - new Date(desde)) / 1000))}s&aggregation.perSeriesAligner=ALIGN_SUM&aggregation.crossSeriesReducer=REDUCE_SUM`;
    const r = await f(url, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    if (!r.ok) throw Object.assign(new Error(j.error?.message || `Monitoring ${r.status}`), { status: r.status });
    return (j.timeSeries || []).reduce((s, t) => s + (t.points || []).reduce((a, p) => a + Number(p.value?.int64Value || 0), 0), 0);
  };
  const [lecturas, escrituras, borrados] = await Promise.all(["read_count", "write_count", "delete_count"].map(metrica));
  return { lecturas, escrituras, borrados, desde, limites: LIMITES_SPARK };
}
