// Planning de rutas por puntos: la pestaña de horarios (timetable).
import { useState, useRef, useEffect, useMemo, Fragment } from "react";
import { db } from "../firebase.js";
import { collection, onSnapshot, doc, setDoc, deleteDoc, updateDoc, serverTimestamp, getDoc, writeBatch, getDocs } from "firebase/firestore";
import { listenPrices, saveDefaultPrice, savePointPrices, effectivePrice, fmtEur } from "../price-store.js";
import { logAudit, logAuditGrouped } from "../audit.js";
import { TT_PAGINA, getBarrio, loadXLSX, normTxt } from "./datos.js";
import { C, font, mono } from "./estilo.js";

// ── TIMETABLE ROW ─────────────────────────────────────────────────
function TimetableRow({ entry, onUpdate, onDelete, canPrice = false, price = null, defaultPrice = null, onPrice }) {
  const [localPrice, setLocalPrice] = useState(price != null ? String(price) : "");
  // Si el precio cambia desde fuera (otro admin, o "aplicar al barrio"), se
  // refleja en el campo (ajuste durante el render, sin efecto).
  const [syncedPrice, setSyncedPrice] = useState(price);
  if (price !== syncedPrice) {
    setSyncedPrice(price);
    setLocalPrice(price != null ? String(price) : "");
  }
  const [localStart, setLocalStart] = useState(entry.horaInicio || "");
  const [localDur,   setLocalDur]   = useState(entry.duracion != null ? String(entry.duracion) : "");
  const [franjaIni,  setFranjaIni]  = useState(entry.franjaInicio || "");
  const [franjaFin,  setFranjaFin]  = useState(entry.franjaFin || "");
  // Nombre mostrado si no hay uno explícito guardado — mismo fallback de
  // siempre (código SAP/calle/coordenadas), solo para que el input no
  // aparezca vacío la primera vez que se edita un punto sin nombre propio.
  const fallbackNombre =
    Object.entries(entry.campos || {}).find(([k]) => ["pa","idsap","id_sap","codigopoint","codigo"].includes(k.toLowerCase()))?.[1]
    || Object.entries(entry.campos || {}).find(([k]) => k.toLowerCase() === "calle")?.[1]
    || `${entry.lat?.toFixed(4)}, ${entry.lng?.toFixed(4)}`;
  const [localNombre, setLocalNombre] = useState(entry.nombre || "");

  useEffect(() => { setLocalStart(entry.horaInicio || ""); },                          [entry.horaInicio]);
  useEffect(() => { setLocalDur(entry.duracion != null ? String(entry.duracion) : ""); }, [entry.duracion]);
  useEffect(() => { setFranjaIni(entry.franjaInicio || ""); },                          [entry.franjaInicio]);
  useEffect(() => { setFranjaFin(entry.franjaFin || ""); },                             [entry.franjaFin]);
  useEffect(() => { setLocalNombre(entry.nombre || ""); },                              [entry.nombre]);

  const camposRows = Object.entries(entry.campos || {})
    .filter(([k, v]) => k.toLowerCase() !== "barrio" && v !== "" && v != null);

  return (
    <tr style={{ borderBottom: `1px solid ${C.border}`, animation: "planning-fadein .15s ease both" }}>
      {/* Punto */}
      <td style={{ padding: "10px 14px", verticalAlign: "top" }}>
        <input
          value={localNombre}
          placeholder={fallbackNombre}
          onChange={e => setLocalNombre(e.target.value)}
          onBlur={e => {
            const v = e.target.value.trim();
            // Guarda siempre algo mostrable: si lo dejan vacío, cae de nuevo
            // al nombre calculado (código SAP/calle/coordenadas) en vez de
            // guardar una cadena vacía que se vería en blanco en todas partes.
            onUpdate({ nombre: v || fallbackNombre });
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.borderColor = "transparent";
          }}
          title="Nombre del punto — se sincroniza con el mapa y con Scheduling"
          style={{
            width: "100%", fontWeight: 500, fontSize: 12, color: C.text, marginBottom: 2,
            background: "transparent", border: "1px solid transparent", borderRadius: 4,
            padding: "2px 4px", marginLeft: -4, outline: "none", fontFamily: font,
          }}
          onFocus={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.borderColor = C.border2; }}
        />
        <div style={{ fontSize: 10, color: C.muted, marginBottom: 3 }}>
          {(() => {
            const calle = Object.entries(entry.campos || {}).find(([k]) => k.toLowerCase() === "calle")?.[1];
            const num   = Object.entries(entry.campos || {}).find(([k]) => ["num","num.","número","numero"].includes(k.toLowerCase()))?.[1];
            if (calle) return num ? `${calle} ${num}` : calle;
            return <span style={{ fontFamily: mono }}>{entry.lat?.toFixed(5)}, {entry.lng?.toFixed(5)}</span>;
          })()}
        </div>
        {camposRows.slice(0, 3).map(([k, v]) => (
          <div key={k} style={{ fontSize: 10, color: C.dim, lineHeight: 1.5 }}>
            <span style={{ color: C.muted }}>{k}:</span> {v}
          </div>
        ))}
        {camposRows.length > 3 && (
          <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>+{camposRows.length - 3} más</div>
        )}
      </td>

      {/* Hora inicio */}
      <td style={{ padding: "10px 8px", verticalAlign: "middle", width: 116 }}>
        <input
          type="time"
          value={localStart}
          onChange={e => setLocalStart(e.target.value)}
          onBlur={e => onUpdate({ horaInicio: e.target.value || null })}
          title="Hora exacta obligatoria — si además hay franja horaria, la franja manda"
          style={{
            width: "100%", background: "rgba(255,255,255,0.04)",
            border: `1px solid ${localStart ? C.blue + "55" : C.border}`,
            color: localStart ? C.blueText : C.muted,
            padding: "6px 8px", borderRadius: 6, fontSize: 12,
            fontFamily: mono, outline: "none", cursor: "pointer",
          }}
        />
      </td>

      {/* Franja horaria */}
      <td style={{ padding: "10px 8px", verticalAlign: "middle", width: 148 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input
            type="time"
            value={franjaIni}
            onChange={e => setFranjaIni(e.target.value)}
            onBlur={e => onUpdate({ franjaInicio: e.target.value || null })}
            title="Franja horaria: la parada solo puede hacerse dentro de este rango — el vehículo espera si llega antes, y no se asigna ese día si llegaría tarde"
            style={{
              width: "100%", background: "rgba(255,255,255,0.04)",
              border: `1px solid ${franjaIni ? C.green + "55" : C.border}`,
              color: franjaIni ? C.green : C.muted,
              padding: "6px 6px", borderRadius: 6, fontSize: 11,
              fontFamily: mono, outline: "none", cursor: "pointer",
            }}
          />
          <span style={{ color: C.dim, fontSize: 10, flexShrink: 0 }}>–</span>
          <input
            type="time"
            value={franjaFin}
            onChange={e => setFranjaFin(e.target.value)}
            onBlur={e => onUpdate({ franjaFin: e.target.value || null })}
            title="Fin de la franja horaria"
            style={{
              width: "100%", background: "rgba(255,255,255,0.04)",
              border: `1px solid ${franjaFin ? C.green + "55" : C.border}`,
              color: franjaFin ? C.green : C.muted,
              padding: "6px 6px", borderRadius: 6, fontSize: 11,
              fontFamily: mono, outline: "none", cursor: "pointer",
            }}
          />
        </div>
      </td>

      {/* Duración */}
      <td style={{ padding: "10px 8px", verticalAlign: "middle", width: 106 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <input
            type="number" min="1" max="1440"
            value={localDur}
            onChange={e => setLocalDur(e.target.value)}
            onBlur={e => {
              const n = parseInt(e.target.value);
              onUpdate({ duracion: isNaN(n) ? null : Math.max(1, n) });
            }}
            placeholder="—"
            style={{
              width: 56, background: "rgba(255,255,255,0.04)",
              border: `1px solid ${localDur ? C.amber + "55" : C.border}`,
              color: localDur ? C.amber : C.muted,
              padding: "6px 8px", borderRadius: 6, fontSize: 12,
              fontFamily: mono, outline: "none", textAlign: "right",
            }}
          />
          <span style={{ fontSize: 10, color: C.dim, flexShrink: 0 }}>min</span>
        </div>
      </td>

      {/* Precio — solo administradores (ver price-store.js) */}
      {canPrice && (
        <td style={{ padding: "10px 8px", verticalAlign: "middle", width: 100 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <input
              type="number" min="0" step="0.01"
              value={localPrice}
              onChange={e => setLocalPrice(e.target.value)}
              onBlur={e => {
                const n = parseFloat(String(e.target.value).replace(",", "."));
                const next = isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
                if (next !== price) onPrice?.(next);
              }}
              placeholder={defaultPrice != null ? String(defaultPrice) : "—"}
              title={defaultPrice != null ? `Vacío = precio por defecto (${fmtEur(defaultPrice)})` : "Precio de este punto"}
              style={{
                width: 64, background: "rgba(255,255,255,0.04)",
                border: `1px solid ${localPrice ? C.green + "55" : C.border}`,
                color: localPrice ? C.green : C.muted,
                padding: "6px 8px", borderRadius: 6, fontSize: 12,
                fontFamily: mono, outline: "none", textAlign: "right",
              }}
            />
            <span style={{ fontSize: 10, color: C.dim, flexShrink: 0 }}>€</span>
          </div>
        </td>
      )}

      {/* Acciones */}
      <td style={{ padding: "10px 12px 10px 4px", verticalAlign: "middle", width: 36 }}>
        <button onClick={onDelete} title="Eliminar" style={{
          width: 26, height: 26, borderRadius: 6,
          background: "none", border: `1px solid ${C.border}`,
          color: C.dim, cursor: "pointer", fontSize: 14,
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all .15s", fontFamily: font,
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}
        >×</button>
      </td>
    </tr>
  );
}

export function TabTimetable({ layers, projectId: ttProjectId, canPrice = false, orgId = null }) {
  // ── Precios por punto (solo administradores) ──
  const [prices, setPrices] = useState({ defaultPrecio: null, byKey: new Map(), ready: false });
  const [showPricePanel, setShowPricePanel] = useState(false);
  const [priceInput, setPriceInput] = useState("");
  const [barrioPriceInput, setBarrioPriceInput] = useState("");
  const [savingPrice, setSavingPrice] = useState(false);
  useEffect(() => {
    if (!canPrice || !ttProjectId) return;
    return listenPrices(ttProjectId, p => {
      setPrices(p);
      if (p.ready) setPriceInput(prev => prev || (p.defaultPrecio != null ? String(p.defaultPrecio) : ""));
    });
  }, [canPrice, ttProjectId]);
  const parsePrice = v => { const n = parseFloat(String(v).replace(",", ".")); return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null; };
  async function withSaving(fn) {
    setSavingPrice(true);
    try { await fn(); } catch (e) { alert("No se pudo guardar el precio: " + (e.message || e)); }
    setSavingPrice(false);
  }
  const [firestoreEntries, setFirestoreEntries] = useState([]);
  const [loading,          setLoading]          = useState(true);
  const [barrioFiltro,     setBarrioFiltro]     = useState(null);
  // Buscador de puntos y filas pintadas: con miles de puntos sin barrio (un
  // GTFS, 8.302 paradas en "Sin barrio") pintar todas las filas editables a
  // la vez congelaba la página. Se pintan de TT_PAGINA en TT_PAGINA.
  const [busqueda,         setBusqueda]         = useState("");
  const [paginas,          setPaginas]          = useState({ clave: "", n: 1 });
  const [defaultDur,       setDefaultDur]       = useState(null);
  const [durInput,         setDurInput]         = useState("");
  const [showDurPanel,     setShowDurPanel]     = useState(false);
  const [applyingDur,      setApplyingDur]      = useState(false);
  const [importing,        setImporting]        = useState(false);
  const importInputRef = useRef(null);

  const totalMarkers = layers.reduce((s, l) => s + (l.markers?.length ?? 0), 0);
  const isLarge = totalMarkers > 2000;

  // For large datasets: derive entries directly from layers in memory (no Firestore round-trip)
  const effectiveEntries = useMemo(() => {
    if (!isLarge) return firestoreEntries;
    return layers.flatMap(l => (l.markers ?? []).map(m => {
      const lat = parseFloat(m.lat), lng = parseFloat(m.lng);
      if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
      const campos = {};
      for (const [k, v] of Object.entries(m)) {
        // _r: ids internos de las líneas de un GTFS (ya están en "lineas")
        if (k !== 'lat' && k !== 'lng' && !k.startsWith('_')) campos[k] = String(v ?? '');
      }
      const barrio  = getBarrio(m);
      const nombre  = m.nombre || m.name || m["Dirección"] || m["Direccion"] || "";
      const puntoKey = `${lat.toFixed(5)}_${lng.toFixed(5)}`;
      return { _id: puntoKey, puntoKey, lat, lng, campos, nombre, barrio, layerColor: l.color };
    }).filter(Boolean));
  }, [isLarge, layers, firestoreEntries]);

  const timetableCol = ttProjectId
    ? collection(db, "scheduling_projects", ttProjectId, "timetable")
    : collection(db, "planning_timetable");

  // Real-time listener
  useEffect(() => {
    const unsub = onSnapshot(
      timetableCol,
      snap => { setFirestoreEntries(snap.docs.map(d => ({ _id: d.id, ...d.data() }))); setLoading(false); },
      () => setLoading(false)
    );
    return () => unsub();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttProjectId]);

  // Load default duration from project settings
  useEffect(() => {
    if (!ttProjectId) return;
    getDoc(doc(db, "planning_settings", ttProjectId)).then(snap => {
      if (snap.exists() && snap.data().defaultDuracion != null) {
        const v = snap.data().defaultDuracion;
        setDefaultDur(v);
        setDurInput(String(v));
      }
    }).catch(() => {});
  }, [ttProjectId]);

  async function applyDefaultDuration() {
    const minutes = parseInt(durInput, 10);
    if (!isFinite(minutes) || minutes < 1 || minutes > 999) return;
    if (!ttProjectId) return;
    setApplyingDur(true);
    try {
      // Save to planning_settings
      await setDoc(doc(db, "planning_settings", ttProjectId),
        { defaultDuracion: minutes, updatedAt: serverTimestamp() }, { merge: true });
      setDefaultDur(minutes);

      // For small datasets: also batch-write to every timetable entry
      if (!isLarge) {
        const snap = await getDocs(timetableCol);
        const BATCH = 499;
        for (let i = 0; i < snap.docs.length; i += BATCH) {
          const b = writeBatch(db);
          snap.docs.slice(i, i + BATCH).forEach(d =>
            b.update(d.ref, { duracion: minutes, updatedAt: serverTimestamp() })
          );
          await b.commit();
        }
      }
      setShowDurPanel(false);
    } catch (e) {
      alert("Error al guardar la duración: " + e.message);
    }
    setApplyingDur(false);
  }

  // Sync newly uploaded layers → Firebase timetable in batches of 499
  useEffect(() => {
    const total = layers.reduce((s, l) => s + (l.markers?.length ?? 0), 0);
    if (total === 0) return;

    if (total > 2000) {
      // Large dataset: delete any stale timetable entries (e.g. from a previous smaller upload)
      if (!ttProjectId) return;
      getDocs(timetableCol).then(snap => {
        if (snap.empty) return;
        const b = writeBatch(db);
        snap.docs.forEach(d => b.delete(d.ref));
        b.commit().catch(() => {});
      }).catch(() => {});
      return;
    }
    const allMarkers = layers.flatMap(l => l.markers.map(m => ({ ...m, layerColor: l.color })));
    if (allMarkers.length === 0) return;

    const entries = allMarkers.map(m => {
      const { lat: rawLat, lng: rawLng, layerColor, nombre: _n, name: _nm, ...campos } = m;
      const lat = parseFloat(rawLat), lng = parseFloat(rawLng);
      if (!isFinite(lat) || !isFinite(lng)) return null; // skip invalid coords
      const nombre  = m.nombre || m.name || m.id || m.pa
        || Object.entries(campos).find(([k]) => ["pa","idsap","id_sap","codigopoint","codigo"].includes(k.toLowerCase()))?.[1]
        || Object.entries(campos).find(([k]) => k.toLowerCase() === "calle")?.[1]
        || "";
      const barrio  = Object.entries(campos).find(([k]) => k.toLowerCase() === "barrio")?.[1] || "";
      const puntoKey = `${lat.toFixed(5)}_${lng.toFixed(5)}`;
      return { puntoKey, lat, lng, campos, nombre, barrio, layerColor };
    }).filter(Boolean);

    // Write in batches of 499 sequentially to avoid overwhelming Firestore
    (async () => {
      // Puntos que ya tienen una fila en el timetable — no les tocamos el
      // nombre aquí. Si no se excluyera, cada vez que `layers` cambia de
      // referencia (recarga de página, nueva importación...) este efecto
      // volvería a escribir el nombre recalculado desde el layer original,
      // borrando en silencio cualquier renombrado hecho a mano en el
      // Timetable (ver TimetableRow). El resto de campos sí se resincroniza.
      const existingKeys = new Set((await getDocs(timetableCol)).docs.map(d => d.id));
      const BATCH_SIZE = 499;
      for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        entries.slice(i, i + BATCH_SIZE).forEach(e => {
          const payload = existingKeys.has(e.puntoKey)
            ? { lat: e.lat, lng: e.lng, campos: e.campos, barrio: e.barrio, layerColor: e.layerColor, updatedAt: serverTimestamp() }
            : { ...e, updatedAt: serverTimestamp() };
          batch.set(doc(timetableCol, e.puntoKey), payload, { merge: true });
        });
        await batch.commit();
      }
    })();
  }, [layers]);

  async function updateEntry(id, changes) {
    await updateDoc(doc(timetableCol, id), { ...changes, updatedAt: serverTimestamp() });
  }
  async function deleteEntry(id) {
    await deleteDoc(doc(timetableCol, id));
  }

  // Sort within a group: scheduled by time first, then unscheduled
  const sortFn = (a, b) => {
    if (!a.horaInicio && !b.horaInicio) return 0;
    if (!a.horaInicio) return 1;
    if (!b.horaInicio) return -1;
    return a.horaInicio.localeCompare(b.horaInicio);
  };

  // Barrios y paradas agrupadas por barrio, en UNA pasada y solo cuando
  // cambian las paradas. Antes, en cada repintado, se recorrían todas las
  // paradas una vez por barrio (MADRID: 131 × 44.249 ≈ 5,8 millones de
  // comparaciones) — era lo que más tardaba al abrir el Timetable (medido:
  // bloqueos de 0,5–0,8 s seguidos en un PC normal).
  const { barrios, grouped } = useMemo(() => {
    const g = new Map();
    for (const e of effectiveEntries) {
      const b = e.barrio || "Sin barrio";
      let arr = g.get(b);
      if (!arr) g.set(b, (arr = []));
      arr.push(e);
    }
    const barrios = [...g.keys()].sort();
    const grouped = {};
    for (const b of barrios) grouped[b] = g.get(b).sort(sortFn);
    return { barrios, grouped };
  }, [effectiveEntries]);

  // Importe de todos los puntos (precio propio o por defecto) — solo admins
  const importeTotal = useMemo(() => {
    if (!canPrice) return { total: 0, count: 0, sinPrecio: 0 };
    let total = 0, count = 0, sinPrecio = 0;
    for (const e of effectiveEntries) {
      const p = effectivePrice(prices, e.puntoKey || e._id);
      if (p == null) sinPrecio++; else { total += p; count++; }
    }
    return { total, count, sinPrecio };
  }, [canPrice, effectiveEntries, prices]);

  // Which barrios to render (after filter)
  const renderBarrios = barrioFiltro ? [barrioFiltro] : barrios;

  const qNorm = normTxt(busqueda.trim());
  const claveLista = `${barrioFiltro ?? ""}|${qNorm}`;
  const nPaginas = paginas.clave === claveLista ? paginas.n : 1;
  const tope = nPaginas * TT_PAGINA;
  const bloques = useMemo(() => {
    const out = [];
    for (const b of renderBarrios) {
      const lista = grouped[b] ?? [];
      const filtrada = qNorm ? lista.filter(e => normTxt(`${e.nombre} ${Object.values(e.campos || {}).join(" ")}`).includes(qNorm)) : lista;
      if (filtrada.length) out.push({ barrio: b, lista: filtrada });
    }
    return out;
  }, [renderBarrios, grouped, qNorm]);
  const totalFiltradas = bloques.reduce((s, x) => s + x.lista.length, 0);

  const withTime = effectiveEntries.filter(e => e.horaInicio);

  async function exportToExcel() {
    const XLSX = await loadXLSX();
    const source = barrioFiltro
      ? effectiveEntries.filter(e => (e.barrio || "Sin barrio") === barrioFiltro)
      : [...effectiveEntries];

    const sorted = source.sort((a, b) => {
      const ba = a.barrio || "Sin barrio", bb = b.barrio || "Sin barrio";
      if (ba !== bb) return ba.localeCompare(bb);
      return sortFn(a, b);
    });

    const campoKeys = [...new Set(
      sorted.flatMap(e => Object.keys(e.campos || {}).filter(k => k.toLowerCase() !== "barrio"))
    )];

    const rows = sorted.map(e => {
      const row = {
        "Nombre":         e.nombre || "",
        "Barrio":         e.barrio || "",
        "Coordenadas":    `${e.lat?.toFixed(5)},${e.lng?.toFixed(5)}`,
        "Hora inicio":    e.horaInicio || "",
        "Franja inicio":  e.franjaInicio || "",
        "Franja fin":     e.franjaFin || "",
        "Duración (min)": e.duracion ?? "",
      };
      campoKeys.forEach(k => { row[k] = e.campos?.[k] ?? ""; });
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(rows);

    const colWidths = Object.keys(rows[0] || {}).map(k => ({
      wch: Math.max(k.length, ...rows.map(r => String(r[k] ?? "").length), 8),
    }));
    ws["!cols"] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Timetable");
    XLSX.writeFile(wb, barrioFiltro ? `timetable_${barrioFiltro.replace(/\s+/g, "_")}.xlsx` : "timetable.xlsx");
  }

  // Importa un Excel con el mismo formato que exportToExcel (editado fuera y
  // vuelto a subir). Empareja cada fila con su parada por la columna
  // "Coordenadas" (mismo puntoKey que usa el resto de la app,
  // lat/lng con 5 decimales) y solo toca los 4 campos editables del
  // Timetable — Nombre/Barrio/Coordenadas se ignoran al importar porque
  // vienen del layer original, no son campos que este formulario edite.
  async function importFromExcel(file) {
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const XLSX = await loadXLSX();
      const wb = XLSX.read(buf, { type: "array" });
      // raw:false — sin esto, una celda de Excel con formato de hora (p.ej.
      // "10:00") se lee como el número de serie interno de Excel (fracción
      // del día, 0.41666...) en vez del texto formateado. Sale de aquí como
      // texto plausible ("0.4166666666666667"), así que no salta ningún
      // error, pero produce franjas horarias sin sentido al interpretarse
      // más tarde como "0.41 minutos" en vez de las 10:00 reales.
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null, raw: false });

      const validKeys = new Set(effectiveEntries.map(e => e._id));
      const updates = [];
      let notFound = 0, invalid = 0;

      for (const r of rows) {
        const coord = r["Coordenadas"];
        const [latStr, lngStr] = coord ? String(coord).split(",") : [];
        const lat = parseFloat(latStr), lng = parseFloat(lngStr);
        if (!isFinite(lat) || !isFinite(lng)) { invalid++; continue; }
        const puntoKey = `${lat.toFixed(5)}_${lng.toFixed(5)}`;
        if (!validKeys.has(puntoKey)) { notFound++; continue; }

        const horaInicio   = r["Hora inicio"]   != null ? String(r["Hora inicio"]).trim()   : "";
        const franjaInicio = r["Franja inicio"] != null ? String(r["Franja inicio"]).trim() : "";
        const franjaFin    = r["Franja fin"]    != null ? String(r["Franja fin"]).trim()    : "";
        const changes = {
          horaInicio: horaInicio || null,
          franjaInicio: franjaInicio || null,
          franjaFin: franjaFin || null,
          updatedAt: serverTimestamp(),
        };
        const durRaw = r["Duración (min)"];
        if (durRaw != null && String(durRaw).trim() !== "") {
          const d = parseInt(durRaw, 10);
          changes.duracion = isFinite(d) && d > 0 ? d : null;
        }
        updates.push({ puntoKey, changes });
      }

      if (updates.length === 0) {
        alert(`No se importó ninguna fila.${invalid ? ` ${invalid} sin coordenadas válidas.` : ""}${notFound ? ` ${notFound} no coinciden con ninguna parada de este proyecto.` : ""}`);
        return;
      }

      const BATCH = 499;
      for (let i = 0; i < updates.length; i += BATCH) {
        const batch = writeBatch(db);
        updates.slice(i, i + BATCH).forEach(u => batch.set(doc(timetableCol, u.puntoKey), u.changes, { merge: true }));
        await batch.commit();
      }

      alert(`${updates.length} paradas actualizadas.`
        + (notFound ? ` ${notFound} filas no coincidían con ninguna parada de este proyecto.` : "")
        + (invalid ? ` ${invalid} filas sin coordenadas válidas.` : ""));
    } catch (e) {
      alert("Error al importar: " + e.message);
    }
    setImporting(false);
  }

  const thS = {
    padding: "8px 14px", fontSize: 10, color: C.dim, fontWeight: 600,
    letterSpacing: 1, textTransform: "uppercase",
    borderBottom: `1px solid ${C.border}`, textAlign: "left",
    background: C.card, position: "sticky", top: 0, zIndex: 5,
  };

  if (loading && !isLarge) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ color: C.dim, fontSize: 13 }}>Cargando…</span>
    </div>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: font }}>

      {/* Stats bar */}
      <div style={{
        padding: "10px 20px", borderBottom: `1px solid ${C.border}`,
        background: C.card, flexShrink: 0,
        display: "flex", alignItems: "center", gap: 28,
      }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{effectiveEntries.length.toLocaleString()}</span>
          <span style={{ fontSize: 11, color: C.muted }}>puntos</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{withTime.length}</span>
          <span style={{ fontSize: 11, color: C.muted }}>programados</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{effectiveEntries.length - withTime.length}</span>
          <span style={{ fontSize: 11, color: C.muted }}>sin hora</span>
        </div>
        {barrios.length > 0 && (
          <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{barrios.length}</span>
            <span style={{ fontSize: 11, color: C.muted }}>barrios</span>
          </div>
        )}
        {canPrice && importeTotal.count > 0 && (
          <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}
            title={`${importeTotal.count.toLocaleString()} puntos con precio${importeTotal.sinPrecio ? ` · ${importeTotal.sinPrecio.toLocaleString()} sin precio` : ""}`}>
            <span style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{fmtEur(importeTotal.total)}</span>
            <span style={{ fontSize: 11, color: C.muted }}>importe total</span>
          </div>
        )}
        {effectiveEntries.length === 0 && (
          <span style={{ fontSize: 11, color: C.dim }}>
            Ve a Mapa y sube un Excel para añadir puntos
          </span>
        )}

        {effectiveEntries.length > 0 && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            {/* Price button — solo administradores */}
            {canPrice && (
              <button
                onClick={() => setShowPricePanel(v => !v)}
                title="Precio por punto: por defecto y por barrio (solo administradores)"
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 12px", borderRadius: 7, cursor: "pointer",
                  background: showPricePanel ? "rgba(52,211,153,0.15)" : "rgba(52,211,153,0.07)",
                  border: `1px solid ${showPricePanel ? "rgba(52,211,153,0.5)" : "rgba(52,211,153,0.22)"}`,
                  color: C.green, fontSize: 12, fontWeight: 500, fontFamily: font, transition: "all .15s",
                }}
              >
                €&nbsp;{prices.defaultPrecio != null ? `${fmtEur(prices.defaultPrecio)}/punto` : "Precio"}
              </button>
            )}
            {/* Duration button */}
            <button
              onClick={() => setShowDurPanel(v => !v)}
              title="Fijar duración por defecto para todas las paradas"
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 7, cursor: "pointer",
                background: showDurPanel ? "rgba(251,191,36,0.15)" : "rgba(251,191,36,0.07)",
                border: `1px solid ${showDurPanel ? "rgba(251,191,36,0.5)" : "rgba(251,191,36,0.22)"}`,
                color: "#fbbf24", fontSize: 12, fontWeight: 500,
                fontFamily: font, transition: "all .15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(251,191,36,0.15)"; }}
              onMouseLeave={e => { if (!showDurPanel) e.currentTarget.style.background = "rgba(251,191,36,0.07)"; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              {defaultDur != null ? `${defaultDur} min` : "Duración"}
            </button>
            <button
              onClick={exportToExcel}
              title={barrioFiltro ? `Exportar barrio "${barrioFiltro}"` : "Exportar todo el timetable"}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 7, cursor: "pointer",
                background: "rgba(52,211,153,0.08)", border: `1px solid rgba(52,211,153,0.25)`,
                color: C.green, fontSize: 12, fontWeight: 500,
                fontFamily: font, transition: "all .15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(52,211,153,0.14)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(52,211,153,0.08)"; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Excel
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".xlsx,.xls"
              style={{ display: "none" }}
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) importFromExcel(file);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => importInputRef.current?.click()}
              disabled={importing}
              title="Importar Excel con el mismo formato que se descarga (empareja por Coordenadas)"
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 7, cursor: importing ? "default" : "pointer",
                background: "rgba(79,142,247,0.08)", border: `1px solid rgba(79,142,247,0.25)`,
                color: C.blueText, fontSize: 12, fontWeight: 500,
                fontFamily: font, transition: "all .15s", opacity: importing ? 0.6 : 1,
              }}
              onMouseEnter={e => { if (!importing) e.currentTarget.style.background = "rgba(79,142,247,0.14)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(79,142,247,0.08)"; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              {importing ? "Importando…" : "Importar"}
            </button>
            <a href="/scheduling" style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 12px", borderRadius: 7, cursor: "pointer",
              background: C.blueDim, border: `1px solid ${C.blue}44`,
              color: C.blueText, fontSize: 12, fontWeight: 500,
              fontFamily: font, transition: "all .15s", textDecoration: "none",
            }}
              onMouseEnter={e => { e.currentTarget.style.background = "#1a3570"; }}
              onMouseLeave={e => { e.currentTarget.style.background = C.blueDim; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              Scheduling
            </a>
          </div>
        )}
      </div>

      {/* Duration panel */}
      {canPrice && showPricePanel && (
        <div style={{
          padding: "14px 20px", borderBottom: `1px solid ${C.border}`,
          background: "rgba(52,211,153,0.05)", flexShrink: 0,
          display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
        }}>
          <span style={{ fontSize: 13, color: C.green, fontWeight: 600 }}>€ Precio por punto</span>
          <span style={{ fontSize: 12, color: C.muted }}>Solo lo ven los administradores. Los puntos sin precio propio usan el de por defecto.</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: C.muted }}>Por defecto</span>
            <input type="number" min="0" step="0.01" value={priceInput}
              onChange={e => setPriceInput(e.target.value)} placeholder="€"
              style={{ width: 80, background: C.surface2, border: "1px solid rgba(52,211,153,0.35)", color: C.text, borderRadius: 7, padding: "7px 10px", fontSize: 13, fontFamily: font, outline: "none", textAlign: "center" }} />
            <button disabled={savingPrice}
              onClick={() => withSaving(async () => {
                await saveDefaultPrice(ttProjectId, orgId, parsePrice(priceInput));
                logAudit({ modulo: "Planning", accion: "Cambió el precio por defecto", detalle: parsePrice(priceInput) == null ? "sin precio" : fmtEur(parsePrice(priceInput)) });
              })}
              style={{ padding: "7px 14px", borderRadius: 7, cursor: "pointer", background: "rgba(52,211,153,0.15)", border: "1px solid rgba(52,211,153,0.4)", color: C.green, fontSize: 12, fontWeight: 600, fontFamily: font }}>
              {savingPrice ? "Guardando…" : "Guardar"}
            </button>
            {barrioFiltro && (
              <>
                <span style={{ width: 1, height: 22, background: C.border, margin: "0 4px" }} />
                <span style={{ fontSize: 12, color: C.muted }}>Todos los de {barrioFiltro}</span>
                <input type="number" min="0" step="0.01" value={barrioPriceInput}
                  onChange={e => setBarrioPriceInput(e.target.value)} placeholder="€ (vacío = quitar)"
                  style={{ width: 120, background: C.surface2, border: "1px solid rgba(52,211,153,0.35)", color: C.text, borderRadius: 7, padding: "7px 10px", fontSize: 13, fontFamily: font, outline: "none", textAlign: "center" }} />
                <button disabled={savingPrice}
                  onClick={() => {
                    const p = parsePrice(barrioPriceInput);
                    const list = grouped[barrioFiltro] || [];
                    if (!confirm(p == null
                      ? `¿Quitar el precio propio de los ${list.length} puntos de ${barrioFiltro}? Pasarán a usar el precio por defecto.`
                      : `¿Poner ${fmtEur(p)} a los ${list.length} puntos de ${barrioFiltro}?`)) return;
                    withSaving(async () => {
                      await savePointPrices(ttProjectId, orgId, Object.fromEntries(list.map(e => [e.puntoKey || e._id, p])));
                      logAudit({ modulo: "Planning", accion: "Cambió el precio de un barrio", detalle: `${barrioFiltro} · ${list.length} puntos · ${p == null ? "precio por defecto" : fmtEur(p)}` });
                    });
                  }}
                  style={{ padding: "7px 14px", borderRadius: 7, cursor: "pointer", background: "rgba(52,211,153,0.15)", border: "1px solid rgba(52,211,153,0.4)", color: C.green, fontSize: 12, fontWeight: 600, fontFamily: font }}>
                  Aplicar a {(grouped[barrioFiltro] || []).length} puntos
                </button>
              </>
            )}
            {!barrioFiltro && <span style={{ fontSize: 11, color: C.dim }}>Elige un barrio a la izquierda para poner precio a todos sus puntos.</span>}
          </div>
        </div>
      )}

      {showDurPanel && (
        <div style={{
          padding: "14px 20px", borderBottom: `1px solid ${C.border}`,
          background: "rgba(251,191,36,0.05)", flexShrink: 0,
          display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
        }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          <span style={{ fontSize: 13, color: "#fbbf24", fontWeight: 600 }}>
            Duración por parada
          </span>
          <span style={{ fontSize: 12, color: C.muted }}>
            Aplica a todas las paradas
            {isLarge ? " (se guarda como duración global del proyecto)" : " (actualiza todas las entradas del timetable)"}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
            <input
              type="number" min="1" max="999"
              value={durInput}
              onChange={e => setDurInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && applyDefaultDuration()}
              placeholder="min"
              style={{
                width: 72, background: C.surface2,
                border: `1px solid rgba(251,191,36,0.35)`,
                color: C.text, borderRadius: 7, padding: "7px 10px",
                fontSize: 13, fontFamily: font, outline: "none",
                textAlign: "center",
              }}
            />
            <span style={{ fontSize: 12, color: C.muted }}>min</span>
            <button
              onClick={applyDefaultDuration}
              disabled={applyingDur || !durInput || parseInt(durInput, 10) < 1}
              style={{
                padding: "7px 16px", borderRadius: 7, cursor: "pointer",
                background: applyingDur ? C.surface2 : "rgba(251,191,36,0.15)",
                border: `1px solid rgba(251,191,36,0.4)`,
                color: "#fbbf24", fontSize: 12, fontWeight: 600,
                fontFamily: font, transition: "all .15s",
                opacity: applyingDur ? 0.6 : 1,
              }}
            >
              {applyingDur ? "Aplicando…" : "Aplicar a todos"}
            </button>
            <button
              onClick={() => setShowDurPanel(false)}
              style={{
                background: "none", border: "none", color: C.dim,
                cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 4px",
              }}
            >×</button>
          </div>
        </div>
      )}

      {/* Body: sidebar + table */}
      {effectiveEntries.length === 0 ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <div style={{ fontSize: 13, color: C.muted }}>No hay puntos en el timetable</div>
          <div style={{ fontSize: 11, color: C.dim }}>Sube un Excel con columnas Latitud/Longitud en la pestaña Mapa</div>
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

          {/* Barrio sidebar */}
          {barrios.length > 0 && (
            <div style={{
              width: 192, flexShrink: 0,
              borderRight: `1px solid ${C.border}`,
              background: C.card,
              display: "flex", flexDirection: "column",
              overflowY: "auto",
            }}>
              <div style={{
                padding: "10px 14px 6px",
                fontSize: 9, color: C.dim, letterSpacing: 1.5,
                textTransform: "uppercase", fontWeight: 600, flexShrink: 0,
              }}>
                Barrios
              </div>

              {/* "Todos" item */}
              <button onClick={() => setBarrioFiltro(null)} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "7px 14px",
                background: barrioFiltro === null ? C.blueDim : "none",
                border: "none", borderLeft: `2px solid ${barrioFiltro === null ? C.blue : "transparent"}`,
                color: barrioFiltro === null ? C.blueText : C.muted,
                cursor: "pointer", fontFamily: font, fontSize: 12, fontWeight: 500,
                textAlign: "left", width: "100%", transition: "all .12s",
              }}
                onMouseEnter={e => { if (barrioFiltro !== null) e.currentTarget.style.background = C.surface2; }}
                onMouseLeave={e => { if (barrioFiltro !== null) e.currentTarget.style.background = "none"; }}
              >
                <span>Todos</span>
                <span style={{
                  fontSize: 10, fontWeight: 600, fontFamily: mono,
                  background: barrioFiltro === null ? "rgba(79,142,247,0.15)" : C.surface2,
                  color: barrioFiltro === null ? C.blueText : C.dim,
                  padding: "1px 6px", borderRadius: 4,
                }}>
                  {effectiveEntries.length.toLocaleString()}
                </span>
              </button>

              <div style={{ height: 1, background: C.border, margin: "3px 14px" }} />

              {barrios.map(b => {
                const active = barrioFiltro === b;
                const count  = grouped[b]?.length ?? 0;
                const prog   = grouped[b]?.filter(e => e.horaInicio).length ?? 0;
                return (
                  <button key={b} onClick={() => setBarrioFiltro(active ? null : b)} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "7px 14px",
                    background: active ? C.blueDim : "none",
                    border: "none", borderLeft: `2px solid ${active ? C.blue : "transparent"}`,
                    color: active ? C.blueText : C.muted,
                    cursor: "pointer", fontFamily: font, fontSize: 12, fontWeight: active ? 500 : 400,
                    textAlign: "left", width: "100%", transition: "all .12s",
                  }}
                    onMouseEnter={e => { if (!active) e.currentTarget.style.background = C.surface2; }}
                    onMouseLeave={e => { if (!active) e.currentTarget.style.background = "none"; }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, marginRight: 6 }}>
                      {b}
                    </span>
                    <span style={{
                      fontSize: 10, fontWeight: 600, fontFamily: mono, flexShrink: 0,
                      background: active ? "rgba(79,142,247,0.15)" : C.surface2,
                      color: active ? C.blueText : C.dim,
                      padding: "1px 6px", borderRadius: 4,
                    }}>
                      {prog}/{count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Table */}
          <div style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>
            <div style={{ position: "sticky", top: 0, left: 0, zIndex: 3, background: C.bg, padding: "8px 12px", borderBottom: `1px solid ${C.border}` }}>
              <input value={busqueda} onChange={e => setBusqueda(e.target.value)}
                placeholder="Buscar punto por nombre, código, línea…"
                style={{ width: "100%", maxWidth: 420, boxSizing: "border-box", background: C.surface2, border: `1px solid ${C.border}`,
                  color: C.text, borderRadius: 7, padding: "6px 10px", fontSize: 12, fontFamily: font, outline: "none" }} />
              {qNorm && <span style={{ marginLeft: 10, fontSize: 11, color: C.dim }}>{totalFiltradas.toLocaleString()} coincidencias</span>}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thS}>Punto</th>
                  <th style={{ ...thS, width: 116 }}>Hora inicio</th>
                  <th style={{ ...thS, width: 148 }}>Franja horaria</th>
                  <th style={{ ...thS, width: 106 }}>Duración</th>
                  {canPrice && <th style={{ ...thS, width: 100 }}>Precio</th>}
                  <th style={{ ...thS, width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {isLarge && !barrioFiltro && !qNorm ? (
                  <tr>
                    <td colSpan={canPrice ? 6 : 5} style={{ padding: "40px 20px", textAlign: "center" }}>
                      <div style={{ fontSize: 13, color: C.muted, marginBottom: 6 }}>
                        {effectiveEntries.length.toLocaleString()} puntos cargados
                      </div>
                      <div style={{ fontSize: 11, color: C.dim }}>
                        Selecciona un barrio en el panel izquierdo o busca un punto arriba para ver sus filas
                      </div>
                    </td>
                  </tr>
                ) : bloques.map(({ barrio, lista }, bi) => {
                  const antes = bloques.slice(0, bi).reduce((s, x) => s + x.lista.length, 0);
                  if (antes >= tope) return null;
                  return (
                  <Fragment key={barrio}>
                    {barrioFiltro === null && (
                      <tr>
                        <td colSpan={canPrice ? 6 : 5} style={{
                          padding: "8px 14px 7px",
                          background: C.surface2,
                          borderTop: `1px solid ${C.border2}`,
                          borderBottom: `1px solid ${C.border}`,
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ width: 5, height: 5, borderRadius: "50%", background: C.muted, flexShrink: 0 }} />
                            <span style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>{barrio}</span>
                            <span style={{ fontSize: 10, color: C.dim }}>
                              {lista.length} punto{lista.length !== 1 ? "s" : ""}
                              {" · "}{lista.filter(e => e.horaInicio).length} programados
                            </span>
                          </div>
                        </td>
                      </tr>
                    )}
                    {lista.slice(0, tope - antes).map(entry => (
                      <TimetableRow
                        key={entry._id}
                        entry={entry}
                        onUpdate={changes => updateEntry(entry._id, changes)}
                        onDelete={() => deleteEntry(entry._id)}
                        canPrice={canPrice}
                        price={canPrice ? (prices.byKey.get(entry.puntoKey || entry._id) ?? null) : null}
                        defaultPrice={prices.defaultPrecio}
                        onPrice={p => savePointPrices(ttProjectId, orgId, { [entry.puntoKey || entry._id]: p })
                          .then(() => logAuditGrouped(`precio:${ttProjectId}`, { modulo: "Planning", accion: "Cambió precios de puntos" },
                            acc => { acc.n = (acc.n || 0) + 1; acc.last = `${entry.nombre || entry.direccion || "punto"}: ${p == null ? "por defecto" : fmtEur(p)}`; },
                            acc => `${acc.n} punto(s) (último: ${acc.last})`))
                          .catch(e => alert("No se pudo guardar el precio: " + (e.message || e)))}
                      />
                    ))}
                  </Fragment>
                  );
                })}
                {(!isLarge || barrioFiltro || qNorm) && totalFiltradas === 0 && (
                  <tr><td colSpan={canPrice ? 6 : 5} style={{ padding: "30px 20px", textAlign: "center", fontSize: 12, color: C.dim }}>
                    {qNorm ? `Ningún punto coincide con «${busqueda.trim()}»` : "Sin puntos"}
                  </td></tr>
                )}
              </tbody>
            </table>
            {(!isLarge || barrioFiltro || qNorm) && totalFiltradas > tope && (
              <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, borderTop: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 12, color: C.dim }}>
                  Mostrando {tope.toLocaleString()} de {totalFiltradas.toLocaleString()} puntos
                </span>
                <button onClick={() => setPaginas({ clave: claveLista, n: nPaginas + 1 })} style={{
                  padding: "5px 12px", borderRadius: 6, background: C.surface2, border: `1px solid ${C.border2}`,
                  color: C.text, fontSize: 12, cursor: "pointer", fontFamily: font,
                }}>Mostrar {Math.min(TT_PAGINA, totalFiltradas - tope).toLocaleString()} más</button>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
