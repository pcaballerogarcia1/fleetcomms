import { useState, useRef, useEffect, useMemo } from "react";
import { db } from "./firebase.js";
import { collection, onSnapshot, query, doc, setDoc, updateDoc, serverTimestamp, where, getDoc } from "firebase/firestore";
import { uploadLayerMarkers, loadLayerMarkers, localGet } from "./layer-store.js";
import { logAudit } from "./audit.js";
import { cambiarDepots, getContenedor, getFraccion } from "./planning/datos.js";
import { C, LAYER_COLORS, font } from "./planning/estilo.js";
import { TabTimetable } from "./planning/horarios.jsx";
import { TabTrabajos } from "./planning/trabajos.jsx";
import { TabRecursos } from "./planning/recursos.jsx";
import { parseCSV, parseKMLPlanning, parseXLSX } from "./planning/importar.js";
import { MapaPlanning } from "./planning/mapa.jsx";
import { Sidebar } from "./planning/sidebar.jsx";
import { useUltimo } from "./use-ultimo.js";
import { BotonCerrar } from "./ui/cerrar.jsx";

// ── PLANNING PAGE ─────────────────────────────────────────────────
export function PlanningPage({ sesion, onLogout, projectId, embedded = false, activeProject = null, onProjectUpdate = null, vehicles = [], workers = [], loadingV = false, loadingW = false, orgRecursos = null }) {
  const orgId = sesion?.org_id ?? null;
  const orgIdRef = useUltimo(orgId); // la de ahora, dentro de las escuchas por proyecto

  const [layers,       setLayers]       = useState([]);
  // GTFS: líneas de cada capa ({ docId: { v, lineas } }), línea elegida y "ver todas"
  const [gtfsLineas, setGtfsLineas]         = useState({});
  const [lineaSel, setLineaSel]             = useState(null);
  const [verTodasLineas, setVerTodasLineas] = useState(false);
  const [depots,       setDepots]       = useState([]);
  const [barrioColors, setBarrioColors] = useState({});
  const [mapStyle,     setMapStyle]     = useState("dark");

  // ── Manual point creation ─────────────────────────────────────
  const [addPointMode,  setAddPointMode]  = useState(false);
  const [manualForm,    setManualForm]    = useState({ nombre: "", lat: "", lng: "" });

  function onMapClickAddPoint(lat, lng) {
    setManualForm(f => ({ ...f, lat: lat.toFixed(6), lng: lng.toFixed(6) }));
    setAddPointMode(false);
  }

  async function addManualPoint() {
    const lat = parseFloat(manualForm.lat), lng = parseFloat(manualForm.lng);
    if (isNaN(lat) || isNaN(lng)) return;
    const marker = {
      lat, lng,
      nombre: manualForm.nombre.trim() || `Punto ${lat.toFixed(4)},${lng.toFixed(4)}`,
      id: `manual_${Date.now()}`,
    };
    const existingManual = layers.find(l => l.type === "manual");
    if (existingManual) {
      const updatedMarkers = [...(existingManual.markers || []), marker];
      if (projectId) {
        const docId = `${projectId}_${existingManual.id}`;
        setDoc(doc(db, "planning_layers", docId), {
          ...existingManual, markers: updatedMarkers, projectId, orgId, createdAt: serverTimestamp(),
        }).catch(console.error);
      } else {
        setLayers(prev => prev.map(l => l.id === existingManual.id ? { ...l, markers: updatedMarkers } : l));
      }
    } else {
      const newLayer = {
        id: Date.now() + Math.random(),
        name: "Puntos manuales", type: "manual",
        color: LAYER_COLORS[layers.length % LAYER_COLORS.length],
        markers: [marker], visible: true,
      };
      if (projectId) {
        const docId = `${projectId}_${newLayer.id}`;
        setDoc(doc(db, "planning_layers", docId), {
          ...newLayer, projectId, orgId, createdAt: serverTimestamp(),
        }).catch(console.error);
      } else {
        setLayers(prev => [...prev, newLayer]);
      }
    }
    setManualForm({ nombre: "", lat: "", lng: "" });
  }

  const layersMigratedRef  = useRef(false);
  const depotsMigratedRef  = useRef(false);
  const colorDebounceRef   = useRef(null);

  // ── Layers: Firestore subscription — synchronous, no async/await ──
  useEffect(() => {
    if (!projectId) return;
    const q = query(collection(db, "planning_layers"), where("projectId", "==", projectId));
    const unsub = onSnapshot(q, snap => {
      const mainSnap  = snap.docs.filter(d => !d.id.match(/_c\d+$/));
      const chunkSnap = snap.docs.filter(d =>  d.id.match(/_c\d+$/));

      const assembled = mainSnap.map(d => {
        const data = { _docId: d.id, ...d.data() };

        if (data.chunked && !data.localOnly) {
          // Legacy: markers in Firestore chunk docs
          const chunks = chunkSnap
            .filter(c => c.data().layerId === data.id)
            .sort((a, b) => a.data().chunkIndex - b.data().chunkIndex);
          data.markers = chunks.flatMap(c => c.data().markers || []);
        } else if (!data.markers) {
          // localOnly layers: markers will be filled by IDB loader below
          data.markers = [];
        }

        return data;
      });

      // Use functional form so we can preserve in-memory markers for localOnly layers.
      // Without this, the onSnapshot (triggered by setDoc after idbPut) would wipe
      // the markers that were set immediately on upload, causing a visible flash to 0.
      setLayers(prev => {
        const merged = assembled.map(layer => {
          if ((layer.localOnly || layer.cloud) && (!layer.markers || layer.markers.length === 0)) {
            const existing = prev.find(l => l._docId === layer._docId);
            // Capa en la nube: solo se conservan los puntos si son de la
            // misma versión (si alguien la ha vuelto a subir, se recargan).
            const sameVersion = !layer.cloud || !existing?._cloudV || existing._cloudV === layer.cloud.v;
            if (existing?.markers?.length > 0 && sameVersion) {
              return { ...layer, markers: existing.markers, _cloudV: existing._cloudV };
            }
          }
          return layer;
        });
        return merged.sort((a, b) => a.id - b.id);
      });

      // One-time migration from localStorage
      if (!layersMigratedRef.current) {
        layersMigratedRef.current = true;
        if (snap.empty) {
          const migKey = `fc_migrated_layers_v1_${projectId}`;
          if (!localStorage.getItem(migKey)) {
            try {
              const old = JSON.parse(localStorage.getItem(`fc_layers_${projectId}`)) ?? [];
              for (const l of old) {
                setDoc(doc(db, "planning_layers", `${projectId}_${l.id}`), {
                  ...l, projectId, orgId: orgIdRef.current, createdAt: serverTimestamp(),
                });
              }
              if (old.length > 0) localStorage.removeItem(`fc_layers_${projectId}`);
            } catch { /* no crítico: se sigue sin ello */ }
            localStorage.setItem(migKey, "1");
          }
        }
      }
    });
    return () => unsub();
  }, [projectId, orgIdRef]);

  // ── Líneas de las capas GTFS: bloque aparte en la misma capa (layer-store)
  const lineasCargando = useRef(new Set());
  useEffect(() => {
    for (const l of layers) {
      const lc = l.lineasCloud, docId = l._docId;
      if (!lc || !docId || gtfsLineas[docId]?.v === lc.v || lineasCargando.current.has(`${docId}:${lc.v}`)) continue;
      lineasCargando.current.add(`${docId}:${lc.v}`);
      loadLayerMarkers(docId, lc, { clave: `${docId}__lineas` })
        .then(lineas => setGtfsLineas(prev => ({ ...prev, [docId]: { v: lc.v, lineas } })))
        .catch(e => console.error("Líneas GTFS:", e))
        .finally(() => lineasCargando.current.delete(`${docId}:${lc.v}`));
    }
  }, [layers, gtfsLineas]);
  // Al cambiar de proyecto, ninguna línea elegida
  useEffect(() => { setLineaSel(null); setVerTodasLineas(false); }, [projectId]);

  // ── Franjas horarias y nombres editados: viven en una colección aparte
  // (scheduling_projects/{id}/timetable) de los marcadores del mapa
  // (planning_layers) — sin este listener el mapa no tiene forma de saber
  // qué puntos tienen franja, ni el nombre renombrado a mano en Timetable.
  const [windowedKeys, setWindowedKeys] = useState(new Set());
  const [nombreOverrides, setNombreOverrides] = useState(new Map());
  useEffect(() => {
    const timetableCol = projectId
      ? collection(db, "scheduling_projects", projectId, "timetable")
      : collection(db, "planning_timetable");
    const unsub = onSnapshot(timetableCol, snap => {
      const keys = new Set();
      const names = new Map();
      snap.docs.forEach(d => {
        const e = d.data();
        const key = e.puntoKey || d.id;
        if (e.horaInicio || e.franjaInicio) keys.add(key);
        if (e.nombre) names.set(key, e.nombre);
      });
      setWindowedKeys(keys);
      setNombreOverrides(names);
    }, () => {});
    return () => unsub();
  }, [projectId]);

  // ── Cargador de capas grandes (layer-store.js) ──
  // Capas en la nube: de la copia local si es de la misma versión, si no se
  // descargan. Capas antiguas "solo locales": si este navegador es el que
  // las subió, se usan y ADEMÁS se suben a la nube para que las vean los
  // demás; si no, se marcan como no disponibles aquí (aviso en la lista).
  const layerLoadTriedRef = useRef(new Set());
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);
  useEffect(() => {
    const pending = layers.filter(l =>
      l._docId && (l.cloud || l.localOnly) && (!l.markers || l.markers.length === 0) &&
      !layerLoadTriedRef.current.has(`${l._docId}:${l.cloud?.v || "local"}`));
    if (!pending.length) return;
    for (const l of pending) layerLoadTriedRef.current.add(`${l._docId}:${l.cloud?.v || "local"}`);
    Promise.all(pending.map(async l => {
      try {
        if (l.cloud) return { id: l.id, markers: await loadLayerMarkers(l._docId, l.cloud), v: l.cloud.v };
        const local = await localGet(l._docId);
        if (Array.isArray(local) && local.length) {
          migrateLegacyLayer(l, local);
          return { id: l.id, markers: local };
        }
        return { id: l.id, missing: true };
      } catch (e) {
        console.error("[capas] error cargando", l._docId, e);
        return { id: l.id, error: e.message || String(e) };
      }
    })).then(results => {
      if (!aliveRef.current) return;
      setLayers(prev => prev.map(layer => {
        const r = results.find(x => x.id === layer.id);
        if (!r) return layer;
        if (r.markers) return { ...layer, markers: r.markers, _cloudV: r.v, _missing: false, _loadError: null };
        return { ...layer, _missing: !!r.missing, _loadError: r.error || null };
      }));
    });
  }, [layers]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sube a la nube una capa antigua que solo estaba en este navegador
  async function migrateLegacyLayer(layer, markers) {
    try {
      const cloud = await uploadLayerMarkers(layer._docId, projectId, markers);
      await updateDoc(doc(db, "planning_layers", layer._docId), { cloud, localOnly: false, totalMarkers: markers.length });
      console.log("[capas] capa subida a la nube:", layer._docId, cloud);
    } catch (e) {
      console.error("[capas] no se pudo subir la capa a la nube", layer._docId, e);
    }
  }

  // ── Depots: Firestore subscription + one-time localStorage migration ──
  useEffect(() => {
    if (!projectId) return;
    const unsub = onSnapshot(doc(db, "planning_depots", projectId), snap => {
      const list = snap.exists() ? (snap.data().depots ?? []) : [];
      setDepots(list);
      if (!depotsMigratedRef.current) {
        depotsMigratedRef.current = true;
        if (!snap.exists()) {
          const migKey = `fc_migrated_depots_v1_${projectId}`;
          if (!localStorage.getItem(migKey)) {
            try {
              const old = JSON.parse(localStorage.getItem(`fc_depots_${projectId}`)) ?? [];
              if (old.length > 0) {
                setDoc(doc(db, "planning_depots", projectId), {
                  depots: old, projectId, orgId: orgIdRef.current, updatedAt: serverTimestamp(),
                });
                localStorage.removeItem(`fc_depots_${projectId}`);
              }
            } catch { /* no crítico: se sigue sin ello */ }
            localStorage.setItem(migKey, "1");
          }
        }
      }
    });
    return () => unsub();
  }, [projectId, orgIdRef]);

  // ── Settings: read once on mount, migrate from localStorage if needed ──
  useEffect(() => {
    if (!projectId) return;
    getDoc(doc(db, "planning_settings", projectId)).then(snap => {
      if (snap.exists()) {
        const data = snap.data();
        setBarrioColors(data.barrioColors ?? {});
        setMapStyle(data.mapStyle ?? "dark");
      } else {
        const migKey = `fc_migrated_settings_v1_${projectId}`;
        if (!localStorage.getItem(migKey)) {
          try {
            const oldColors = JSON.parse(localStorage.getItem(`fc_barrio_colors_${projectId}`)) ?? {};
            const oldStyle  = localStorage.getItem(`fc_map_style_${projectId}`) ?? "dark";
            setBarrioColors(oldColors);
            setMapStyle(oldStyle);
            setDoc(doc(db, "planning_settings", projectId), {
              barrioColors: oldColors, mapStyle: oldStyle,
              projectId, orgId: orgIdRef.current, updatedAt: serverTimestamp(),
            });
            if (Object.keys(oldColors).length > 0) localStorage.removeItem(`fc_barrio_colors_${projectId}`);
            localStorage.removeItem(`fc_map_style_${projectId}`);
          } catch { /* no crítico: se sigue sin ello */ }
          localStorage.setItem(migKey, "1");
        }
      }
    });
  }, [projectId, orgIdRef]);

  // Debounced helper for barrio color writes
  function saveBarrioColors(newColors) {
    if (!projectId) return;
    clearTimeout(colorDebounceRef.current);
    colorDebounceRef.current = setTimeout(() => {
      setDoc(doc(db, "planning_settings", projectId), {
        barrioColors: newColors, updatedAt: serverTimestamp(),
      }, { merge: true });
    }, 800);
  }

  const [uploading, setUploading]           = useState(false);
  const [depotUploading, setDepotUploading] = useState(false);
  const [errors, setErrors]                 = useState([]);
  const [tab, setTab]                       = useState("mapa");
  const [searchQuery, setSearchQuery]       = useState("");
  const [fraccionFilter, setFraccionFilter]     = useState(null);
  const [contenedorFilter, setContenedorFilter] = useState(null);

  async function handleDepotImport(files) {
    setDepotUploading(true);
    const newErrors = [];
    for (const file of files) {
      const ext = file.name.split(".").pop().toLowerCase();
      let result;
      try {
        if (ext === "csv")       result = parseCSV(await file.text());
        else if (ext === "kml")  result = parseKMLPlanning(await file.text());
        else if (ext === "xlsx") result = await parseXLSX(file);
        else { newErrors.push(`${file.name}: formato no soportado`); continue; }
      } catch (e) { newErrors.push(`${file.name}: ${e.message}`); continue; }
      if (result.error) { newErrors.push(`${file.name}: ${result.error}`); continue; }
      const newDepots = result.markers.map(m => ({
        id: Date.now() + Math.random(),
        lat: m.lat, lng: m.lng,
        nombre: m.nombre || m.name || m.id || `Depot ${m.lat?.toFixed(4)},${m.lng?.toFixed(4)}`,
        fields: Object.fromEntries(
          Object.entries(m).filter(([k]) => !["lat","lng","nombre","name"].includes(k.toLowerCase()))
        ),
      }));
      if (projectId) {
        // sobre la lista del servidor: varios archivos (o varias personas) a la vez no se pisan
        await cambiarDepots(projectId, orgId, l => [...l, ...newDepots])
          .catch(e => newErrors.push(`${file.name}: no se pudo guardar (${e.message || e})`));
      } else {
        setDepots(prev => [...prev, ...newDepots]);
      }
    }
    if (newErrors.length) setErrors(prev => [...prev, ...newErrors]);
    setDepotUploading(false);
  }

  async function handleUpload(files) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setErrors([]);
    const newErrors = [];
    try {
    for (const file of files) {
      const name = file.name.replace(/\.[^.]+$/, "");
      const ext = file.name.split(".").pop().toLowerCase();
      const color = LAYER_COLORS[layers.length % LAYER_COLORS.length];

      let result;
      try {
        if (ext === "csv") {
          result = parseCSV(await file.text());
        } else if (ext === "kml") {
          result = parseKMLPlanning(await file.text());
        } else if (ext === "xlsx") {
          result = await parseXLSX(file);
        } else {
          newErrors.push(`${file.name}: formato no soportado (solo CSV, KML y XLSX)${ext === "zip" ? " — un GTFS de autobuses va en un proyecto de «Líneas regulares»" : ""}`);
          continue;
        }
      } catch (e) {
        newErrors.push(`${file.name}: Error inesperado al procesar el archivo: ${e.message}`);
        continue;
      }

      if (result.error) {
        newErrors.push(`${file.name}: ${result.error}`);
        continue;
      }

      const newLayer = {
        id: Date.now() + Math.random(),
        name, type: ext, color,
        markers: result.markers, visible: true,
      };
      if (projectId) {
        const markers = newLayer.markers;
        const docId = `${projectId}_${newLayer.id}`;
        if (markers.length > 500) {
          // Capa grande: los puntos van a la nube comprimidos y troceados
          // (layer-store.js) para que la vea cualquier navegador — antes
          // solo se guardaban en el IndexedDB de este. Se muestra ya desde
          // memoria y se sube en segundo plano.
          setLayers(prev => [...prev, { ...newLayer, _docId: docId, totalMarkers: markers.length }]);
          logAudit({ modulo: "Planning", accion: "Subió una capa", detalle: `${name} · ${markers.length} puntos` });
          (async () => {
            try {
              const cloud = await uploadLayerMarkers(docId, projectId, markers);
              setLayers(prev => prev.map(l => l._docId === docId ? { ...l, _cloudV: cloud.v } : l));
              await setDoc(doc(db, "planning_layers", docId), {
                id: newLayer.id, name, type: ext, color, visible: true,
                markers: [], cloud, totalMarkers: markers.length,
                projectId, orgId, createdAt: serverTimestamp(),
              });
            } catch (e) {
              console.error("Layer persist:", e);
              setErrors(prev => [...prev, `${name}: no se pudo guardar en la nube (${e.message || e}) — vuelve a subir el archivo.`]);
            }
          })();
        } else {
          // Small layer: store inline in Firestore, onSnapshot updates state
          await setDoc(doc(db, "planning_layers", docId), {
            ...newLayer, projectId, orgId, createdAt: serverTimestamp(),
          });
        }
      } else {
        setLayers(prev => [...prev, newLayer]);
      }
    }

    if (newErrors.length) setErrors(newErrors);
    } catch (e) {
      setErrors([`Error inesperado: ${e.message}`]);
    } finally {
      setUploading(false);
    }
  }

  const initials = ((sesion.nombre?.[0] ?? "") + (sesion.apellidos?.[0] ?? "")).toUpperCase();

  // GTFS: línea elegida y recorridos a dibujar
  const lineaActiva = lineaSel ? (gtfsLineas[lineaSel.docId]?.lineas || []).find(x => x.id === lineaSel.id) || null : null;
  const recorridos = useMemo(() => {
    if (lineaActiva) return [{ color: lineaActiva.color, trazados: lineaActiva.trazados, grosor: 4, encuadrar: true }];
    if (!verTodasLineas) return null;
    const visibles = new Set(layers.filter(l => l.visible).map(l => l._docId));
    return Object.entries(gtfsLineas).filter(([d]) => visibles.has(d))
      .flatMap(([, g]) => g.lineas.map(x => ({ color: x.color, trazados: x.trazados, grosor: 2, opacidad: 0.55 })));
  }, [lineaActiva, verTodasLineas, gtfsLineas, layers]);
  const gtfsGrupos = useMemo(() => layers.filter(l => gtfsLineas[l._docId])
    .map(l => ({ docId: l._docId, capa: l.name, lineas: gtfsLineas[l._docId].lineas })), [layers, gtfsLineas]);

  const hasActiveFilter = !!searchQuery.trim() || !!fraccionFilter || !!contenedorFilter || !!lineaActiva;
  const filteredLayers = hasActiveFilter
    ? layers.map(l => ({
        ...l,
        ...(lineaActiva && l._docId === lineaSel.docId ? { color: lineaActiva.color } : {}),
        markers: (l.markers ?? []).filter(m => {
          if (lineaActiva && l._docId === lineaSel.docId && !m._r?.includes(lineaActiva.id)) return false;
          if (searchQuery.trim() && !Object.values(m).some(v => String(v ?? "").toLowerCase().includes(searchQuery.toLowerCase()))) return false;
          if (fraccionFilter && getFraccion(m) !== fraccionFilter) return false;
          if (contenedorFilter && getContenedor(m) !== contenedorFilter) return false;
          return true;
        }),
      }))
    : layers;

  const totalFiltered = filteredLayers.reduce((s, l) => s + (l.markers?.length ?? 0), 0);
  const totalAll      = layers.reduce((s, l) => s + (l.markers?.length ?? l.totalMarkers ?? 0), 0);

  const inner = (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: embedded ? "100%" : "100vh", background: C.bg, fontFamily: font }}>
      {/* Header — only when standalone */}
      {!embedded && <div style={{
        height: 52, flexShrink: 0,
        background: C.card, borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 20px", zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: C.muted,
            letterSpacing: 0.5, textTransform: "uppercase",
          }}>
            Operanzia
          </div>
          <div style={{ width: 1, height: 16, background: C.border2 }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>Planificación</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>{sesion.nombre}</div>
            <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: .5 }}>{sesion.rol}</div>
          </div>
          <button
            onClick={onLogout}
            title="Cerrar sesión"
            style={{
              width: 32, height: 32, borderRadius: "50%",
              background: C.surface2,
              border: `1px solid ${C.border}`,
              color: C.muted, fontSize: 11, fontWeight: 600,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all .15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.text; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
          >
            {initials}
          </button>
        </div>
      </div>}

      {/* Error toasts */}
      {errors.length > 0 && (
        <div style={{ position: "absolute", top: 60, right: 16, zIndex: 1000, display: "flex", flexDirection: "column", gap: 6 }}>
          {errors.map((err, i) => (
            <div key={i} style={{
              background: C.card, border: `1px solid rgba(242,109,109,0.3)`,
              color: C.red, borderRadius: 8, padding: "10px 14px",
              fontSize: 12, display: "flex", alignItems: "center", gap: 8,
              maxWidth: 380, boxShadow: "0 4px 20px rgba(0,0,0,.4)",
              animation: "planning-fadein .2s ease both",
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span style={{ flex: 1 }}>{err}</span>
              <BotonCerrar onClick={() => setErrors(prev => prev.filter((_, j) => j !== i))} onMouseEnter={e => e.currentTarget.style.color = C.red} onMouseLeave={e => e.currentTarget.style.color = C.dim} />
            </div>
          ))}
        </div>
      )}

      {/* Tab bar */}
      <div style={{
        height: 40, flexShrink: 0,
        background: C.card, borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "stretch", padding: "0 20px", gap: 2,
        zIndex: 5,
      }}>
        {[
          { key: "mapa",      label: "Mapa" },
          { key: "trabajos",  label: "Trabajos" },
          { key: "timetable", label: "Horarios" },
          { key: "recursos",  label: "Recursos" },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            background: "none", border: "none", cursor: "pointer",
            padding: "0 14px", fontFamily: font,
            fontSize: 13, fontWeight: tab === t.key ? 600 : 400,
            color: tab === t.key ? C.text : C.muted,
            borderBottom: `2px solid ${tab === t.key ? C.blue : "transparent"}`,
            marginBottom: -1,
            display: "flex", alignItems: "center", gap: 6,
            transition: "color .12s",
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {tab === "mapa" ? (
          <>
            <Sidebar
              saveBarrioColors={saveBarrioColors}
              layers={layers}
              setLayers={setLayers}
              onUpload={handleUpload}
              uploading={uploading}
              gtfsGrupos={gtfsGrupos}
              lineaSel={lineaSel}
              setLineaSel={setLineaSel}
              verTodasLineas={verTodasLineas}
              setVerTodasLineas={setVerTodasLineas}
              depots={depots}
              setDepots={setDepots}
              onDepotImport={handleDepotImport}
              depotUploading={depotUploading}
              barrioColors={barrioColors}
              setBarrioColors={setBarrioColors}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              totalFiltered={totalFiltered}
              totalAll={totalAll}
              addPointMode={addPointMode}
              setAddPointMode={setAddPointMode}
              manualForm={manualForm}
              setManualForm={setManualForm}
              onAddManualPoint={addManualPoint}
              projectId={projectId}
              orgId={orgId}
              fraccionFilter={fraccionFilter}
              setFraccionFilter={setFraccionFilter}
              contenedorFilter={contenedorFilter}
              setContenedorFilter={setContenedorFilter}
            />
            <MapaPlanning layers={filteredLayers} depots={depots} barrioColors={barrioColors} mapStyle={mapStyle} setMapStyle={setMapStyle} addPointMode={addPointMode} onMapClickAddPoint={onMapClickAddPoint} projectId={projectId} windowedKeys={windowedKeys} nombreOverrides={nombreOverrides} recorridos={recorridos} />
          </>
        ) : tab === "trabajos" ? (
          <TabTrabajos key={projectId} layers={layers} activeProject={activeProject} onProjectUpdate={onProjectUpdate} vehicles={vehicles} />
        ) : tab === "recursos" ? (
          <TabRecursos key={projectId} vehicles={vehicles} workers={workers} loadingV={loadingV} loadingW={loadingW} activeProject={activeProject} onProjectUpdate={onProjectUpdate} orgId={orgRecursos || orgId} />
        ) : (
          <TabTimetable layers={layers} projectId={projectId} orgId={orgId}
            canPrice={sesion?.rol === "admin" || sesion?.rol === "superadmin"} />
        )}
      </div>
    </div>
  );

  return inner;
}
