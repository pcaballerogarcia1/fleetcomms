// Superadmin → Salud: cómo está Operanzia ahora mismo.
//  · Avisos de errores en este móvil (llegan solos: api/alerta-error.js).
//  · Consumo de Firestore de hoy frente al límite diario del plan gratuito.
//  · Errores de los últimos días: por cliente, por versión y los más repetidos.
//  · Pantallas lentas (congeladas o que tardan en cargar).
import { useEffect, useMemo, useState } from "react";
import { activarAvisos, estadoAvisos } from "./avisos.js";
import { watchErrors } from "./error-report.js";
import { auth } from "./firebase.js";
import { resumenSalud } from "./salud.js";
import { C } from "./tema.js";
import { Bell, BellOff } from "lucide-react";


const card = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14 };
const titulo = { fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 };
/* global __APP_VERSION__ */
const VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
const hace = ms => { const m = Math.round((Date.now() - ms) / 60000); return m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`; };

function Barra({ etiqueta, valor, limite }) {
  const pct = Math.min(100, Math.round((valor / limite) * 100));
  const color = pct >= 80 ? C.red : pct >= 50 ? C.amber : C.green;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.muted, marginBottom: 4 }}>
        <span>{etiqueta}</span><span style={{ color }}>{valor.toLocaleString("es-ES")} de {limite.toLocaleString("es-ES")} · {pct}%</span>
      </div>
      <div style={{ height: 8, background: C.surface2, borderRadius: 4, overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: color }} /></div>
    </div>
  );
}

export function PanelSalud({ sesion, orgs }) {
  const [lista, setLista] = useState(null);
  const [errLista, setErrLista] = useState(null);
  const [salud, setSalud] = useState(null);
  const [avisos, setAvisos] = useState(null);
  const [msgAvisos, setMsgAvisos] = useState(null);
  const [abierto, setAbierto] = useState(null);

  useEffect(() => watchErrors(300, (l, e) => { if (e) setErrLista(e.message); else setLista(l); }), []);
  useEffect(() => { estadoAvisos().then(setAvisos, () => setAvisos("no-soportado")); }, []);
  useEffect(() => {
    let vivo = true;
    const cargar = async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        const r = await fetch("/api/salud", { headers: { Authorization: `Bearer ${token}` } });
        const j = await r.json();
        if (vivo) setSalud(r.ok ? j : { error: j.error || `respuesta ${r.status}` });
      } catch (e) { if (vivo) setSalud({ error: e.message }); }
    };
    cargar();
    const t = setInterval(cargar, 5 * 60_000);
    return () => { vivo = false; clearInterval(t); };
  }, []);

  const res = useMemo(() => (lista ? resumenSalud(lista) : null), [lista]);
  const nombreOrg = id => orgs.find(o => o.org_id === id)?.nombre || id;

  async function activar() {
    setMsgAvisos(null);
    try { setAvisos(await activarAvisos({ ...sesion, id: sesion.uid })); setMsgAvisos("Activados: te llegará un aviso cuando aparezca un error nuevo."); }
    catch (e) { setMsgAvisos(e.message); }
  }

  const c = salud?.consumo;
  return (
    <div>
      <div style={{ ...card, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 22 }}>{avisos === "activos" ? <Bell size={22} /> : <BellOff size={22} />}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Avisos de errores en este dispositivo</div>
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>
            {avisos === "activos" ? "Cuando a un usuario le salte un error nuevo, te llega un aviso (el mismo error, como mucho cada 6 h)."
              : avisos === "bloqueados" ? "Bloqueados en este navegador: actívalos en los permisos del sitio."
              : avisos === "no-soportado" ? "Este navegador no admite avisos (en iPhone, abre Operanzia desde la pantalla de inicio)."
              : "Actívalos aquí y en tu móvil (entra en app.operanzia.com/superadmin desde el móvil) para enterarte al momento."}
          </div>
          {msgAvisos && <div style={{ fontSize: 11.5, color: C.blueText, marginTop: 4 }}>{msgAvisos}</div>}
        </div>
        {avisos === "sin-activar" && <button onClick={activar} style={{ background: C.blue, border: "none", color: "#fff", borderRadius: 8, padding: "8px 14px", fontWeight: 600, cursor: "pointer" }}>Activar</button>}
      </div>

      <div style={card}>
        <div style={titulo}>Consumo de la base de datos hoy {salud?.proyecto ? <span style={{ fontWeight: 400, color: C.dim }}>· {salud.proyecto}</span> : null}</div>
        {!salud ? <div style={{ fontSize: 12, color: C.muted }}>Cargando…</div>
          : salud.error ? <div style={{ fontSize: 12, color: C.red }}>{salud.error}</div>
          : !salud.configurado ? <div style={{ fontSize: 12, color: C.amber }}>Falta la cuenta de servicio en el servidor (FIREBASE_CUENTA_SERVICIO): sin ella no se puede leer el consumo ni enviar las alertas de errores.</div>
          : !c ? <div style={{ fontSize: 12, color: C.amber }}>{salud.errorConsumo}</div>
          : <>
            <Barra etiqueta="Lecturas" valor={c.lecturas} limite={c.limites.lecturas} />
            <Barra etiqueta="Escrituras" valor={c.escrituras} limite={c.limites.escrituras} />
            <Barra etiqueta="Borrados" valor={c.borrados} limite={c.limites.borrados} />
            <div style={{ fontSize: 11, color: C.dim }}>Límites diarios del plan gratuito de Firebase; el contador vuelve a cero a las 9:00 (hora de España). Si se llega al 100 %, la app deja de cargar datos hasta entonces. Se actualiza cada 5 min (Google tarda unos minutos en contarlo).</div>
          </>}
      </div>

      <div style={card}>
        <div style={titulo}>Errores</div>
        {errLista ? <div style={{ fontSize: 12, color: C.red }}>{errLista}</div> : !res ? <div style={{ fontSize: 12, color: C.muted }}>Cargando…</div> : <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
            {[["Últimas 24 h", res.h24, res.h24 ? C.red : C.green], ["Últimos 7 días", res.d7, res.d7 ? C.amber : C.green], ["Pantallas lentas (7 d)", res.lentos7, res.lentos7 ? C.amber : C.green], ["Versión publicada", VERSION, C.blueText]].map(([l, v, col]) => (
              <div key={l} style={{ background: C.surface2, borderRadius: 8, padding: "10px 8px", textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: col }}>{v}</div>
                <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>{l}</div>
              </div>
            ))}
          </div>
          {res.porOrg.length > 0 && <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>
            <b style={{ color: C.text }}>Por cliente (7 d):</b> {res.porOrg.map(([o, n]) => `${nombreOrg(o)} ${n}`).join(" · ")}
          </div>}
          {res.porVersion.length > 0 && <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
            <b style={{ color: C.text }}>Por versión (7 d):</b> {res.porVersion.map(([v, n]) => `${v}${v === VERSION ? " (actual)" : ""} ${n}`).join(" · ")}
          </div>}
          {!res.grupos.length && <div style={{ fontSize: 12, color: C.green }}>Ningún error en los últimos 7 días.</div>}
          {res.grupos.map(g => (
            <div key={g.key} onClick={() => setAbierto(abierto === g.key ? null : g.key)} style={{ borderTop: `1px solid ${C.border}`, padding: "8px 0", cursor: "pointer" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <span style={{ fontSize: 11, color: C.red, fontWeight: 700, minWidth: 34 }}>×{g.veces}</span>
                <span style={{ fontSize: 12, color: C.text, flex: 1, wordBreak: "break-word" }}>{String(g.mensaje).slice(0, 160)}</span>
                <span style={{ fontSize: 10.5, color: C.dim, whiteSpace: "nowrap" }}>{hace(g.ultimo)}</span>
              </div>
              <div style={{ fontSize: 10.5, color: C.muted, marginLeft: 42 }}>{[...g.usuarios].slice(0, 4).join(", ")}{g.usuarios.size > 4 ? "…" : ""} · {[...g.paginas].join(", ")} · {nombreOrg(g.ejemplo.org_id)} · v{g.ejemplo.version}</div>
              {abierto === g.key && <pre style={{ fontSize: 10, color: C.muted, background: C.bg, borderRadius: 6, padding: 8, marginTop: 6, whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto" }}>{g.ejemplo.mensaje}{"\n\n"}{g.ejemplo.stack}{"\n\n"}{g.ejemplo.navegador}</pre>}
            </div>
          ))}
        </>}
      </div>

      {res?.lentas.length > 0 && (
        <div style={card}>
          <div style={titulo}>Pantallas lentas (7 días)</div>
          {res.lentas.map(g => (
            <div key={g.key} style={{ borderTop: `1px solid ${C.border}`, padding: "7px 0", fontSize: 12, color: C.text, display: "flex", gap: 8 }}>
              <span style={{ color: C.amber, fontWeight: 700, minWidth: 34 }}>×{g.veces}</span>
              <span style={{ flex: 1 }}>{g.ejemplo.mensaje} <span style={{ color: C.dim }}>· {[...g.usuarios].slice(0, 3).join(", ")} · {nombreOrg(g.ejemplo.org_id)}</span></span>
              <span style={{ fontSize: 10.5, color: C.dim }}>{hace(g.ultimo)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
