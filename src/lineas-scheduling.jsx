// ── Scheduling de proyectos "Líneas regulares" ────────────────────────
// Misma estructura y aspecto que el Scheduling de rutas por puntos
// (pestañas, barra de herramientas, Restricciones, barra de indicadores
// KpiBar, Gantt con vista Tabla/Compacta y zoom) con lo propio de los
// autobuses: los viajes de cada línea en su color, los relevos de conductor
// (T12) y la pestaña de horarios de salida. El cálculo está en lineas-sched.js.
import { useState, useEffect, useMemo, useRef } from "react";
import { watchRed, watchCfg, watchSchedParams, guardarSchedParams, watchCocheras, cambiarManuales, watchCambioPlanning } from "./lineas-store.js";
import {
  generarVehiculos, generarTurnos, moverViaje, moverPieza, moverViajes, moverViajesTurno,
  esCambioVehiculos, esCambioTurnos, aplicarCambios, claveViaje, clavePieza, ID_COCHERA,
  PARAMS_DEFECTO, OBJETIVOS, esCalendario, nombreDia, viajesDia, resumenServicio,
  nombreEstrategia, CAMPOS_ESTRATEGIA, CAMPOS_VEHICULOS,
} from "./lineas-sched.js";
import { KpiBar } from "./scheduling.jsx";
import { SelectorCalendario, Horarios } from "./lineas-horarios.jsx";
import { logAudit } from "./audit.js";
import { PublicarServicio } from "./lineas-publicar.jsx";
import { EnviarRostering } from "./lineas-enviar-rostering.jsx";
import { turnosCompactos } from "./lineas-rostering.js";
import {
  C, ESTRATEGIA_UI, MAX_EN_MEMORIA, baseDeResumen, cambiosKpi, claveEscenario,
  claveVehiculos, font, hhmm, kpisBarra, mismos, mono,
  nombreObjetivo, nombreTipo, num, sinCampos, soloCampos,
} from "./lineas-scheduling/comun.js";
import { Gantt } from "./lineas-scheduling/gantt.jsx";
import { PanelOptimizar, PorQueSinTipo, ResumenCalendarios, SelectorLineas } from "./lineas-scheduling/paneles.jsx";
import { Restricciones } from "./lineas-scheduling/restricciones.jsx";

export function SchedulingLineasPage({ projectId, orgId, proyecto, sesion }) {
  const [subTab, setSubTab] = useState("escenario");
  const [publicando, setPublicando] = useState(false);
  const [aRostering, setARostering] = useState(false);
  const [estado, setEstado] = useState({ red: null, cargando: true });
  const [cfg, setCfg] = useState({});
  const [guardados, setGuardados] = useState(undefined);
  const [cambios, setCambios] = useState({});
  const [diaSel, setDiaSel] = useState(null);
  const [cache, setCache] = useState({}); // dia → { res, base, claveV, clave, t }
  const [calculando, setCalculando] = useState(false);
  const [modo, setModo] = useState("vehicles"); // paso: "vehicles" 1 o "workers" 2
  const [showC, setShowC] = useState(false);
  const [filtro, setFiltro] = useState("");
  const [panelLineas, setPanelLineas] = useState(false);
  const [showOpt, setShowOpt] = useState(false);
  const [objetivoV, setObjetivoV] = useState("autobuses");
  const [objetivoT, setObjetivoT] = useState("conductores");
  const [optPorDia, setOptPorDia] = useState({}); // "dia|fase" → estado de la optimización
  const [lote, setLote] = useState(null); // { optimizar, progreso: [i, n], dia }
  const [nota, setNota] = useState(null); // { texto, error } abajo, unos segundos
  useEffect(() => { if (!nota) return; const t = setTimeout(() => setNota(null), nota.error ? 6000 : 4500); return () => clearTimeout(t); }, [nota]);
  const autoRef = useRef(false);
  const escribiendoRef = useRef(0); // transacciones de cambios a mano en curso
  const workerRef = useRef(null);
  useEffect(() => () => workerRef.current?.terminate(), []);

  useEffect(() => watchRed(projectId, setEstado), [projectId]);
  // listos: hasta que llegan la configuración de las líneas y las cocheras no se
  // calcula (antes se calculaba con lo de antes y el escenario no reflejaba los
  // cambios del Planning)
  const [cfgListo, setCfgListo] = useState(false);
  const [cocherasListas, setCocherasListas] = useState(false);
  useEffect(() => watchCfg(projectId, c => { setCfg(c); setCfgListo(true); }), [projectId]);
  // El último cambio del Planning (horarios, tiempos, cocheras…): si es posterior
  // a lo último que se vio de un calendario, se avisa arriba
  const [cambioPlanning, setCambioPlanning] = useState(null);
  useEffect(() => watchCambioPlanning(projectId, setCambioPlanning), [projectId]);
  useEffect(() => watchSchedParams(projectId, setGuardados), [projectId]);
  const [cocheras, setCocheras] = useState([]);
  useEffect(() => watchCocheras(projectId, l => { setCocheras(l); setCocherasListas(true); }), [projectId]);

  const red = estado.red;
  // la clave de cada escenario también cambia si se mueven las cocheras
  const cfgTxt = useMemo(() => JSON.stringify(cfg) + JSON.stringify(cocheras.map(c => [c.id, c.lat, c.lng])), [cfg, cocheras]);
  const { porCalendario = {}, ...guardadoTop } = guardados || {};
  const existe = d => !esCalendario(d) || !!red?.calendarios?.some(c => c.id === d);
  const diaGuardado = existe(guardadoTop.dia) ? guardadoTop.dia : "laborable";
  const dia = diaSel && existe(diaSel) ? diaSel : diaGuardado || "laborable";
  const fase = modo === "workers" ? "turnos" : "vehiculos";

  // Parámetros de un calendario: restricciones comunes + su estrategia
  function paramsPara(d, extra = {}, estrategia) {
    const globales = { ...PARAMS_DEFECTO, lineas: null, ...sinCampos(guardadoTop, ESTRATEGIA_UI), ...sinCampos(extra, ESTRATEGIA_UI), dia: d };
    const est = { ...(estrategia ?? porCalendario[d]?.estrategia ?? {}), ...soloCampos(extra, ESTRATEGIA_UI) };
    return { ...globales, ...soloCampos(est, ESTRATEGIA_UI), entreLineas: globales.entreLineas && (est.entreLineas ?? true), entreLineasGlobal: globales.entreLineas };
  }
  const params = paramsPara(dia, cambios);
  const actual = cache[dia];
  const res = actual?.res || null;
  const avisoPlanning = cambioPlanning && porCalendario[dia] && cambioPlanning.atMs > (porCalendario[dia].planningVisto || 0) ? cambioPlanning : null;
  const optDe = (d, f) => optPorDia[`${d}|${f}`] || { estado: "nada", progreso: [0, 0] };
  const opt = optDe(dia, fase);
  const paradasPorId = useMemo(() => new Map([...(red?.paradas || []).map(p => [p.id, p]), ...cocheras.map(c => [ID_COCHERA(c.id), { nombre: `Cochera ${c.nombre || ""}`.trim() }])]), [red, cocheras]);
  const pendientes = Object.keys(cambios).length > 0;
  const enMemoriaValido = (d, p) => {
    const c = cache[d];
    return c && (c.res.turnos ? c.clave === claveEscenario(p, cfgTxt) : c.claveV === claveVehiculos(p, cfgTxt));
  };

  function guardarCalendario(d, datos) {
    return guardarSchedParams(projectId, { porCalendario: { [d]: datos } }).catch(() => {});
  }

  // Calcula un calendario: "vehiculos" (paso 1, sin turnos), "turnos" (paso 2
  // sobre los vehículos que hay) o "ambos". meta.objetivoV/T: si viene de Optimizar.
  // Cambios a mano: meta.manuales (lista a aplicar), meta.conservar (los
  // guardados); si no, generar un paso quita los cambios a mano de ese paso.
  // La partición de turnos (lo pesado de «Generar turnos») en un worker, para
  // no congelar la pantalla con redes grandes; devuelve grupos de claves de pieza.
  function gruposEnWorker(p, opsV) {
    return new Promise((resolve, reject) => {
      const w = new Worker(new URL("./lineas-opt.worker.js", import.meta.url), { type: "module" });
      w.onmessage = e => { w.terminate(); if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data.ok); };
      w.onerror = e => { w.terminate(); reject(new Error(e.message || "error en el cálculo")); };
      w.postMessage({ tipo: "grupos", red, cfg, cocheras, params: p, opsV });
    });
  }
  function calcular(p = params, que = "ambos", meta = {}) {
    if (!red) return;
    setCalculando(true);
    setTimeout(async () => {
      try {
        const claveV = claveVehiculos(p, cfgTxt);
        const previos = cache[p.dia]?.manuales ?? porCalendario[p.dia]?.manuales ?? [];
        const lista = meta.manuales ?? (meta.conservar ? previos : que === "turnos" ? previos.filter(esCambioVehiculos) : []);
        const opsV = lista.filter(esCambioVehiculos), opsT = lista.filter(esCambioTurnos);
        const fallidos = [];
        const conV = x => { if (!opsV.length) return x; const a = aplicarCambios(x, opsV); fallidos.push(...a.fallidos); return a.res; };
        const conT = x => { if (!opsT.length) return x; const a = aplicarCambios(x, opsT); fallidos.push(...a.fallidos); return a.res; };
        let r;
        if (que === "vehiculos") r = conV(generarVehiculos(red, cfg, p, { cocheras }));
        else {
          const c = cache[p.dia];
          const veh = que === "turnos" && c?.res && c.claveV === claveV ? c.res : conV(generarVehiculos(red, cfg, p, { cocheras }));
          const grupos = (p.metodo ?? PARAMS_DEFECTO.metodo) === "particion" ? await gruposEnWorker(p, opsV) : null;
          r = conT(generarTurnos(veh, p, { grupos }));
        }
        const aplicados = lista.filter(o => !fallidos.some(f => f.clave === o.clave && f.tipo === o.tipo && f.destino === o.destino));
        if (meta.aviso && !fallidos.length) setNota({ texto: meta.aviso });
        if (fallidos.length) setNota({ texto: `${fallidos.length} cambio${fallidos.length > 1 ? "s" : ""} a mano ya no encaja${fallidos.length > 1 ? "n" : ""} y se ha${fallidos.length > 1 ? "n" : ""} quitado: ${fallidos[0].error}`, error: true });
        const resumen = resumenServicio(r);
        const clave = r.turnos ? claveEscenario(p, cfgTxt) : null;
        const est = soloCampos(p, CAMPOS_ESTRATEGIA);
        const previo = porCalendario[p.dia];
        setCache(c => {
          const antes = c[p.dia]?.res ? resumenServicio(c[p.dia].res) : previo?.resumen;
          const n = { ...c, [p.dia]: { res: r, base: baseDeResumen(antes, p), claveV, clave, manuales: aplicados, t: Date.now() } };
          const sobran = Object.keys(n).sort((x, y) => n[y].t - n[x].t).slice(MAX_EN_MEMORIA);
          for (const k of sobran) delete n[k];
          return n;
        });
        setCambios({});
        setDiaSel(p.dia);
        const top = { ...sinCampos(p, [...CAMPOS_ESTRATEGIA, "entreLineasGlobal"]), entreLineas: p.entreLineasGlobal, lineas: p.lineas || null, ...soloCampos(PARAMS_DEFECTO, ESTRATEGIA_UI) };
        // solo lo que esta persona ha cambiado: si otra cambió a la vez otra
        // restricción, no se le deshace (antes se guardaban todas)
        const cambiados = Object.fromEntries(Object.entries(top).filter(([k, v]) => k === "dia" || JSON.stringify(guardadoTop[k] ?? PARAMS_DEFECTO[k] ?? null) !== JSON.stringify(v ?? null)));
        guardarSchedParams(projectId, cambiados).catch(() => {});
        guardarCalendario(p.dia, {
          estrategia: est, resumen, claveV, clave, manuales: aplicados, ...(previo ? {} : { planningVisto: Date.now() }),
          objetivoV: meta.objetivoV ?? (previo && mismos(CAMPOS_VEHICULOS, previo.estrategia, est) ? previo.objetivoV ?? null : null),
          objetivoT: r.turnos ? meta.objetivoT ?? (previo?.clave && mismos(CAMPOS_ESTRATEGIA, previo.estrategia, est) ? previo.objetivoT ?? null : null) : null,
        });
        logAudit({
          modulo: "Scheduling", accion: que === "vehiculos" ? "Generó los vehículos de líneas" : que === "turnos" ? "Generó los turnos de líneas" : "Generó el escenario de líneas",
          detalle: `${r.diaNombre} · ${r.kpis.viajes} viajes · ${r.kpis.autobuses} autobuses · ${Math.round(r.kpis.kmVacio || 0)} km en vacío${r.turnos ? ` · ${r.kpis.turnos} turnos` : ""}`,
        });
      } catch (e) {
        console.error("Scheduling de líneas:", e);
        setNota({ texto: `No se pudo calcular: ${e.message || e}`, error: true });
      } finally {
        setCalculando(false);
      }
    }, 30);
  }

  // Cambiar de calendario: si ya está calculado y al día se enseña, si no se calculan los dos pasos
  function cambiarDia(d) {
    const extra = sinCampos(cambios, ESTRATEGIA_UI); // la estrategia a medio tocar era del otro calendario
    const p = paramsPara(d, extra);
    setPanelLineas(false);
    if (!Object.keys(extra).length && enMemoriaValido(d, p)) {
      setCambios({});
      setDiaSel(d);
      guardarSchedParams(projectId, { dia: d }).catch(() => {});
      return;
    }
    calcular(p, "ambos", { conservar: true });
  }

  // Mover a mano una expedición (paso 1) o una pieza (paso 2)
  // tipo: "viaje" | "pieza" (uno) · "viajes" | "viajesTurno" (varios: clave es la lista)
  function mover(tipo, clave, destino) {
    const c = cache[dia];
    if (!c?.res) return false;
    const claves = Array.isArray(clave) ? clave : null;
    const deVeh = tipo === "viaje" || tipo === "viajes";
    // las expediciones se mueven sobre los autobuses del paso 1 tal cual (sin los
    // intercambios de «los autobuses siguen al conductor»), como al recalcular
    const baseVeh = c.res.vehiculosBase ? { ...c.res, vehiculos: c.res.vehiculosBase, vehiculosBase: undefined } : c.res;
    const r = tipo === "viaje" ? moverViaje(baseVeh, clave, destino)
      : tipo === "viajes" ? moverViajes(baseVeh, claves, destino)
        : tipo === "viajesTurno" ? moverViajesTurno(c.res, claves, destino)
          : moverPieza(c.res, clave, destino);
    if (r.error) { setNota({ texto: `No se puede: ${r.error}`, error: true }); return false; }
    const previos = c.manuales || [];
    const op = claves ? { tipo, clave: claves[0], claves, destino } : { tipo, clave, destino };
    // mover expediciones rehace los vehículos: los cambios de turnos ya no valen
    const anadir = l => (deVeh ? [...l.filter(esCambioVehiculos), op] : [...l, op]);
    const manuales = anadir(previos);
    const clv = r.turnos ? c.clave : null;
    setCache(m => ({ ...m, [dia]: { ...c, res: r, base: baseDeResumen(resumenServicio(c.res), params), clave: clv, manuales, t: Date.now() } }));
    const prev = porCalendario[dia] || {};
    const d = dia;
    escribiendoRef.current++;
    // la operación se añade a la lista del SERVIDOR: si otra persona movió
    // piezas de este calendario a la vez, se conservan y se recalcula con todas
    cambiarManuales(projectId, d, anadir, { resumen: resumenServicio(r), claveV: c.claveV, clave: clv, objetivoT: r.turnos ? prev.objetivoT ?? null : null })
      .then(({ antes, despues }) => {
        if (JSON.stringify(antes) !== JSON.stringify(previos)) {
          setNota({ texto: "Otra persona ha cambiado este calendario a la vez: se recalcula con sus cambios y los tuyos." });
          calcular(paramsPara(d), "ambos", { manuales: despues });
        }
      })
      .catch(e => setNota({ texto: `No se pudo guardar el cambio: ${e.message || e}`, error: true }))
      .finally(() => { escribiendoRef.current--; });
    const primero = claves ? claves[0] : clave;
    const avisos = (deVeh
      ? r.vehiculos.find(v => v.viajes.some(x => !x.vacio && claveViaje(x) === primero))?.avisos
      : tipo === "viajesTurno" ? r.turnos.find(t => t.piezas.some(pz => pz.viajes.some(x => !x.vacio && claveViaje(x) === primero)))?.avisos
        : r.turnos.find(t => t.piezas.some(x => clavePieza(x) === clave))?.avisos) || [];
    const donde = destino == null ? (deVeh ? "a un autobús nuevo" : "a un turno nuevo") : deVeh ? `al autobús ${destino}` : `al turno T${destino}`;
    const que = tipo === "viaje" ? "Expedición movida" : tipo === "viajes" ? `${claves.length} expediciones movidas` : tipo === "viajesTurno" ? `${claves.length} viaje${claves.length > 1 ? "s" : ""} movido${claves.length > 1 ? "s" : ""}` : "Pieza movida";
    setNota({ texto: `${que} ${donde}${avisos.length ? ` · ojo: ${avisos[0]}` : ""}${deVeh && c.res.turnos ? " · los turnos hay que rehacerlos (paso 2)" : ""}`, error: avisos.length > 0 });
    logAudit({ modulo: "Scheduling", accion: deVeh ? (claves ? "Movió a mano varias expediciones" : "Movió a mano una expedición") : claves ? "Movió a mano varios viajes de turno" : "Movió a mano una pieza", detalle: `${nombreDia(dia, red)} · ${claves ? `${claves.length}: ${claves.slice(0, 3).join(", ")}${claves.length > 3 ? "…" : ""}` : clave} → ${donde}` });
    return true;
  }
  const manualesActuales = actual?.manuales || [];
  const deshacer = () => {
    const ultima = JSON.stringify(manualesActuales.at(-1));
    escribiendoRef.current++;
    cambiarManuales(projectId, dia, l => { const i = l.map(o => JSON.stringify(o)).lastIndexOf(ultima); return i < 0 ? l : [...l.slice(0, i), ...l.slice(i + 1)]; })
      .then(({ despues }) => calcular(params, "ambos", { manuales: despues }))
      .catch(e => setNota({ texto: `No se pudo deshacer: ${e.message || e}`, error: true }))
      .finally(() => { escribiendoRef.current--; });
  };
  const quitarManuales = () => { if (window.confirm(`¿Quitar los ${manualesActuales.length} cambios a mano de este calendario?`)) calcular(params, "ambos", { manuales: [] }); };
  // generar u optimizar un paso quita los cambios a mano de ese paso
  const perderManuales = f => {
    const n = f === "vehiculos" ? manualesActuales.length : manualesActuales.filter(esCambioTurnos).length;
    return !n || window.confirm(`Se perderán ${n} cambio${n > 1 ? "s" : ""} a mano de ${f === "vehiculos" ? "vehículos y turnos" : "turnos"}. ¿Seguir?`);
  };

  // Rostering: los turnos de un calendario tal y como salen aquí (el de pantalla si está al día; si no, se calculan aparte)
  const alDia = d => { const c = cache[d]; return !!(c?.res?.turnos && c.clave === claveEscenario(paramsPara(d), cfgTxt)); };
  const estadoParaRoster = d => (alDia(d) ? "pantalla" : porCalendario[d]?.clave ? "guardado" : "nuevo");
  function turnosParaRoster(d) {
    if (alDia(d)) return Promise.resolve(turnosCompactos(cache[d].res));
    return new Promise((resolve, reject) => {
      const w = new Worker(new URL("./lineas-opt.worker.js", import.meta.url), { type: "module" });
      w.onmessage = e => { w.terminate(); if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data.ok); };
      w.onerror = e => { w.terminate(); reject(new Error(e.message || "error en el cálculo")); };
      w.postMessage({ tipo: "turnosDia", red, cfg, cocheras, params: paramsPara(d), manuales: cache[d]?.manuales ?? porCalendario[d]?.manuales ?? [] });
    });
  }
  function nuevoWorker() {
    workerRef.current?.terminate();
    const w = new Worker(new URL("./lineas-opt.worker.js", import.meta.url), { type: "module" });
    workerRef.current = w;
    return w;
  }
  const hayPreciosVeh = p => p.costeVehiculoDia > 0 || p.costeKm > 0;
  const objetivoVehValido = p => (objetivoV === "coste" && !hayPreciosVeh(p) ? "autobuses" : objetivoV);

  // Optimizar un paso del calendario que se está viendo (en un worker)
  const marcarPlanningVisto = d => { if (avisoPlanning) guardarCalendario(d, { planningVisto: Date.now() }); };
  function optimizar() {
    if (!red || opt.estado === "corriendo" || lote || !perderManuales(fase)) return;
    marcarPlanningVisto(params.dia);
    const p = params, d = p.dia, f = fase;
    const obj = f === "vehiculos" ? objetivoVehValido(p) : objetivoT;
    const setO = x => setOptPorDia(m => ({ ...m, [`${d}|${f}`]: typeof x === "function" ? x(m[`${d}|${f}`] || {}) : x }));
    setPanelLineas(false);
    setO({ estado: "corriendo", progreso: [0, 0] });
    const w = nuevoWorker();
    w.onmessage = e => {
      if (e.data.progreso) { setO(o => ({ ...o, progreso: e.data.progreso })); return; }
      w.terminate(); workerRef.current = null;
      if (e.data.error) { setO({ estado: "nada", progreso: [0, 0], error: e.data.error }); return; }
      const { probadas } = e.data.ok;
      setO({ estado: "hecho", progreso: [0, 0], probadas, params: p, objetivo: obj, aplicada: 0 });
      if (probadas[0]) {
        calcular({ ...p, ...probadas[0].estrategia }, f, f === "vehiculos" ? { objetivoV: obj } : { objetivoT: obj });
        logAudit({ modulo: "Scheduling", accion: f === "vehiculos" ? "Optimizó los vehículos de líneas" : "Optimizó los turnos de líneas", detalle: `${nombreDia(d, red)} · ${OBJETIVOS.find(o => o.id === obj)?.nombre} · ${probadas[0].nombre}` });
      }
    };
    w.onerror = e => { w.terminate(); workerRef.current = null; setO({ estado: "nada", progreso: [0, 0], error: e.message || "error en el cálculo" }); };
    // vehículos: puede probar a no cambiar de línea solo si la restricción lo permite;
    // turnos: con los vehículos tal cual están
    w.postMessage({ tipo: f, red, cfg, cocheras, params: f === "vehiculos" ? { ...p, entreLineas: p.entreLineasGlobal } : p, objetivo: obj });
  }
  // Optimizar todo junto (vehículos y turnos a la vez, por el coste total)
  const optJunto = optDe(dia, "conjunto");
  function optimizarJunto() {
    if (!red || optJunto.estado === "corriendo" || opt.estado === "corriendo" || lote || !perderManuales("vehiculos")) return;
    marcarPlanningVisto(params.dia);
    const p = params, d = p.dia;
    const setO = x => setOptPorDia(m => ({ ...m, [`${d}|conjunto`]: typeof x === "function" ? x(m[`${d}|conjunto`] || {}) : x }));
    setPanelLineas(false);
    setO({ estado: "corriendo", progreso: [0, 0] });
    const w = nuevoWorker();
    w.onmessage = e => {
      if (e.data.progreso) { setO(o => ({ ...o, progreso: e.data.progreso })); return; }
      w.terminate(); workerRef.current = null;
      if (e.data.error) { setO({ estado: "nada", progreso: [0, 0], error: e.data.error }); return; }
      const { probadas, precios } = e.data.ok;
      setO({ estado: "hecho", progreso: [0, 0], probadas, precios, params: p, aplicada: 0 });
      if (probadas[0]) {
        calcular({ ...p, ...probadas[0].estrategia }, "ambos", { objetivoV: "total", objetivoT: "total" });
        logAudit({ modulo: "Scheduling", accion: "Optimizó vehículos y turnos de líneas a la vez", detalle: `${nombreDia(d, red)} · ${probadas[0].nombre}` });
      }
    };
    w.onerror = e => { w.terminate(); workerRef.current = null; setO({ estado: "nada", progreso: [0, 0], error: e.message || "error en el cálculo" }); };
    w.postMessage({ tipo: "conjunto", red, cfg, cocheras, params: { ...p, entreLineas: p.entreLineasGlobal } });
  }
  function aplicarJunto(i) {
    const r = optJunto.probadas?.[i];
    if (!r) return;
    setOptPorDia(m => ({ ...m, [`${dia}|conjunto`]: { ...optJunto, aplicada: i } }));
    calcular({ ...optJunto.params, ...r.estrategia }, "ambos", { objetivoV: "total", objetivoT: "total" });
  }
  function aplicarOpt(i) {
    const r = opt.probadas?.[i];
    if (!r) return;
    setOptPorDia(m => ({ ...m, [`${dia}|${fase}`]: { ...opt, aplicada: i } }));
    calcular({ ...opt.params, ...r.estrategia }, fase, fase === "vehiculos" ? { objetivoV: opt.objetivo } : { objetivoT: opt.objetivo });
  }

  // Calcular u optimizar varios calendarios, uno detrás de otro (en un worker)
  function calcularLote(dias, optimizarTodos) {
    if (!red || lote || !dias.length) return;
    const globales = paramsPara(dias[0], {}, {});
    const objV = objetivoVehValido(globales), objT = objetivoT;
    // restricciones comunes + la estrategia por defecto (cada calendario pone la suya encima)
    const base = { ...sinCampos(globales, ["entreLineasGlobal", "dia"]), entreLineas: globales.entreLineasGlobal };
    const hechos = {};
    setLote({ optimizar: optimizarTodos, progreso: [0, dias.length], dia: dias[0] });
    const w = nuevoWorker();
    w.onmessage = e => {
      const m = e.data;
      if (m.progreso) { setLote(l => (l ? { ...l, progreso: m.progreso, dia: m.dia } : l)); return; }
      if (m.hecho) {
        const { dia: d, estrategia, resumen, optimizado } = m.hecho;
        hechos[d] = estrategia;
        const previo = porCalendario[d];
        const q = paramsPara(d, {}, estrategia);
        guardarCalendario(d, {
          estrategia, resumen, claveV: claveVehiculos(q, cfgTxt), clave: claveEscenario(q, cfgTxt), manuales: m.hecho.manuales || [],
          objetivoV: optimizado ? objV : previo && mismos(CAMPOS_VEHICULOS, previo.estrategia, estrategia) ? previo.objetivoV ?? null : null,
          objetivoT: optimizado ? objT : previo?.clave && mismos(CAMPOS_ESTRATEGIA, previo.estrategia, estrategia) ? previo.objetivoT ?? null : null,
        });
        return;
      }
      w.terminate(); workerRef.current = null;
      setLote(null);
      if (m.error) { alert(`No se ha podido terminar: ${m.error}`); return; }
      logAudit({ modulo: "Scheduling", accion: optimizarTodos ? "Optimizó todos los calendarios de líneas" : "Calculó los calendarios de líneas", detalle: `${dias.length} calendarios${optimizarTodos ? ` · ${nombreObjetivo(objV)} · ${nombreObjetivo(objT)}` : ""}` });
      // el calendario que se está viendo ha cambiado: se recalcula
      if (hechos[dia]) calcular(paramsPara(dia, {}, hechos[dia]), "ambos", { conservar: !optimizarTodos });
    };
    w.onerror = e => { w.terminate(); workerRef.current = null; setLote(null); alert(`No se ha podido terminar: ${e.message || "error en el cálculo"}`); };
    w.postMessage({ tipo: "lote", red, cfg, cocheras, params: base, objetivoVehiculos: objV, objetivoTurnos: objT, optimizar: optimizarTodos, dias: dias.map(d => ({ dia: d, estrategia: optimizarTodos ? {} : porCalendario[d]?.estrategia || {}, manuales: optimizarTodos ? [] : (cache[d]?.manuales ?? porCalendario[d]?.manuales ?? []) })) });
  }
  function pararLote() { workerRef.current?.terminate(); workerRef.current = null; setLote(null); }

  // Otra persona ha cambiado los cambios a mano del calendario que se ve:
  // se recalcula con la lista del servidor (si no, se pisarían)
  const manualesServidor = JSON.stringify(porCalendario[dia]?.manuales || []);
  useEffect(() => {
    const c = cache[dia];
    if (!c?.res || calculando || lote || escribiendoRef.current) return;
    if (JSON.stringify(c.manuales || []) === manualesServidor) return;
    if (porCalendario[dia]?.claveV && porCalendario[dia].claveV !== c.claveV) return; // otro escenario: lo resuelve «Desactualizado»
    // en diferido: agrupa varios cambios seguidos del servidor en un solo recálculo
    const t = setTimeout(() => calcular(paramsPara(dia), "ambos", { manuales: JSON.parse(manualesServidor), aviso: "Otra persona ha cambiado este calendario: se actualiza con sus cambios." }), 300);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualesServidor, dia]);

  useEffect(() => {
    if (red && guardados !== undefined && cfgListo && cocherasListas && !autoRef.current) { autoRef.current = true; calcular(params, "ambos", { conservar: true }); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [red, guardados, cfgListo, cocherasListas]);
  // El Planning cambia con el Scheduling abierto (horarios, tiempos, cocheras…):
  // el calendario que se ve se recalcula con los cambios
  useEffect(() => {
    if (!autoRef.current || calculando || lote || !cache[dia] || enMemoriaValido(dia, params)) return;
    const t = setTimeout(() => calcular(params, "ambos", { conservar: true }), 400);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfgTxt]);

  async function exportar(tipo) {
    if (!res || (tipo === "turnos" && !res.turnos)) return;
    const XLSX = await import("xlsx");
    const nom = id => paradasPorId.get(id)?.nombre || id;
    const filas = tipo === "vehiculos"
      ? res.vehiculos.flatMap(v => v.viajes.map(x => ({ "Autobús": v.autobus, "Bloque": v.id, "Tipo": nombreTipo(v.tipo), "Línea": x.vacio ? (x.hacia ? `Vacío → ${x.hacia}` : "Vacío") : x.nombre, "Sentido": x.sentido, "Salida": hhmm(x.dep), "Llegada": hhmm(x.arr), "Desde": nom(x.o), "Hasta": nom(x.d), "Km": x.km, "En vacío": x.vacio ? "sí" : "" })))
      : res.turnos.flatMap(t => t.piezas.flatMap((pz, i) => pz.viajes.map(x => ({
          "Turno": `T${t.id}`, "Pieza": i + 1, "Autobús": res.vehiculos.find(v => v.id === pz.vehiculo)?.autobus, "Línea": x.vacio ? "Vacío" : x.nombre, "Sentido": x.sentido,
          "Salida": hhmm(x.dep), "Llegada": hhmm(x.arr), "Desde": nom(x.o), "Hasta": nom(x.d), "Inicio turno": hhmm(t.inicio), "Fin turno": hhmm(t.fin), "Avisos": t.avisos.join(" · "),
        }))));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), tipo === "vehiculos" ? "Autobuses" : "Turnos");
    XLSX.writeFile(wb, `${tipo === "vehiculos" ? "vehiculos" : "turnos"}_${res.diaNombre.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60)}.xlsx`);
  }

  const subTabs = [["escenario", "Escenario / Gantt"], ["calendarios", "Calendarios"], ["horarios", "Horarios de salida"]];
  const cabecera = (
    <div style={{ height: 38, flexShrink: 0, background: C.card, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "stretch", padding: "0 20px", gap: 2 }}>
      {subTabs.map(([k, l]) => (
        <button key={k} onClick={() => setSubTab(k)} style={{ background: "none", border: "none", cursor: "pointer", padding: "0 14px", fontFamily: font, fontSize: 12, fontWeight: subTab === k ? 600 : 400, color: subTab === k ? C.text : C.muted, borderBottom: `2px solid ${subTab === k ? C.blue : "transparent"}`, marginBottom: -1 }}>{l}</button>
      ))}
      {lote && (
        <div style={{ marginLeft: "auto", alignSelf: "center", fontSize: 11, color: C.blueText, fontFamily: mono }}>
          {lote.optimizar ? "Optimizando" : "Calculando"} calendarios · {lote.progreso[0] + 1} de {lote.progreso[1]}
        </div>
      )}
    </div>
  );

  if (estado.cargando) return <div style={{ flex: 1, display: "flex", flexDirection: "column", background: C.bg }}>{cabecera}<div style={{ padding: 30, color: C.muted, fontFamily: font, fontSize: 13 }}>Cargando la red…</div></div>;
  if (!red) return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: C.bg, fontFamily: font }}>
      {cabecera}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: 13 }}>Importa primero la red (GTFS) en Planning para generar el escenario.</div>
    </div>
  );

  const nLineas = params.lineas ? params.lineas.length : red.lineas.length;
  const totalViajes = red.lineas.filter(l => !params.lineas || params.lineas.includes(l.id)).reduce((s, l) => s + l.sentidos.reduce((a, x) => a + viajesDia(x, params.dia, red, cfg[l.id]), 0), 0);
  const btnSec = { padding: "5px 10px", background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: font, display: "flex", alignItems: "center", gap: 5, flexShrink: 0 };
  const btnExcel = { padding: "5px 10px", background: "rgba(52,211,153,.08)", border: "1px solid rgba(52,211,153,.3)", color: "#34d399", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font, display: "flex", alignItems: "center", gap: 5, flexShrink: 0 };
  const icoDescarga = <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>;
  const sep = <div style={{ width: 1, height: 18, background: C.border, flexShrink: 0 }} />;
  const infoCal = porCalendario[dia];
  const restriccionesUI = { ...params, entreLineas: params.entreLineasGlobal };
  const sinTurnos = res && !res.turnos;
  const etiquetaOpt = [infoCal?.objetivoV && `vehículos: ${nombreObjetivo(infoCal.objetivoV)}`, infoCal?.objetivoT && `turnos: ${nombreObjetivo(infoCal.objetivoT)}`].filter(Boolean).join(" · ");
  const paso = (v, n, l, aviso) => (
    <button key={v} onClick={() => setModo(v)} title={aviso || undefined} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 11px", borderRadius: 4, border: "none", cursor: "pointer", background: modo === v ? C.blue : "none", color: modo === v ? "#fff" : C.muted, fontSize: 11, fontWeight: modo === v ? 600 : 400, fontFamily: font }}>
      <span style={{ width: 16, height: 16, borderRadius: 8, fontSize: 9.5, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", background: modo === v ? "#fff" : C.bg, color: modo === v ? C.blue : C.muted }}>{n}</span>
      {l}
      {aviso && <span style={{ width: 7, height: 7, borderRadius: 4, background: C.amber }} />}
    </button>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: C.bg, fontFamily: font, minHeight: 0 }}>
      {cabecera}
      {subTab === "horarios" ? <Horarios red={red} cfg={cfg} diaInicial={params.dia} /> : subTab === "calendarios" ? (
        <ResumenCalendarios red={red} porCalendario={porCalendario} claveDe={d => claveEscenario(paramsPara(d), cfgTxt)} claveVDe={d => claveVehiculos(paramsPara(d), cfgTxt)} precios={params} diaActual={dia}
          objetivoV={objetivoV} setObjetivoV={setObjetivoV} objetivoT={objetivoT} setObjetivoT={setObjetivoT} lote={lote} pendientes={pendientes} ocupado={opt.estado === "corriendo"}
          onVer={d => { setSubTab("escenario"); cambiarDia(d); }} onLote={calcularLote} onParar={pararLote} onRestricciones={() => { setSubTab("escenario"); setShowC(true); }} />
      ) : (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {/* ── TOOLBAR (como la del Scheduling de puntos) ── */}
          <div style={{ padding: "0 16px", height: 46, borderBottom: `1px solid ${C.border}`, background: C.card, flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ position: "relative" }}>
              <button onClick={() => setPanelLineas(v => !v)} title="Líneas que entran en el escenario" style={{ padding: "5px 11px", background: C.greenDim, border: `1px solid ${C.green}44`, color: C.green, borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: "pointer", fontFamily: font, display: "flex", alignItems: "center", gap: 6, flexShrink: 0, whiteSpace: "nowrap" }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                {totalViajes.toLocaleString("es-ES")} viajes · {nLineas === red.lineas.length ? `${nLineas} líneas` : `${nLineas} de ${red.lineas.length} líneas`}
              </button>
              {panelLineas && <SelectorLineas lineas={red.lineas} elegidas={params.lineas} onCambiar={ids => setCambios(c => ({ ...c, lineas: ids }))} onCerrar={() => setPanelLineas(false)} />}
            </div>
            <SelectorCalendario red={red} valor={dia} onCambiar={cambiarDia} ancho={240} />
            {etiquetaOpt && <span title={`Estrategia de este calendario: ${nombreEstrategia(infoCal.estrategia || {}, params.piezaMax)}`} style={{ fontSize: 10.5, color: C.green, border: `1px solid ${C.green}44`, borderRadius: 10, padding: "2px 8px", whiteSpace: "nowrap", flexShrink: 0, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>Optimizado · {etiquetaOpt}</span>}
            {sep}
            <div style={{ display: "flex", gap: 2, background: C.surface2, borderRadius: 6, padding: 2, flexShrink: 0 }}>
              {paso("vehicles", 1, "Vehículos")}
              {paso("workers", 2, "Trabajadores", sinTurnos ? "Faltan los turnos de estos vehículos" : null)}
            </div>
            <button onClick={() => setShowC(s => !s)} style={{ ...btnSec, background: showC ? C.surface2 : "none", border: `1px solid ${showC ? C.border2 : C.border}`, color: showC ? C.text : C.muted }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="6" x2="20" y2="6" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="11" y1="18" x2="13" y2="18" /></svg>
              Restricciones
            </button>
            {res && <>
              {sep}
              {modo === "vehicles"
                ? <button onClick={() => exportar("vehiculos")} title="Descargar los autobuses, con los vacíos, en Excel" style={btnExcel}>{icoDescarga} Vehículos</button>
                : <button onClick={() => exportar("turnos")} disabled={!res.turnos} title="Descargar los turnos de conductor en Excel" style={{ ...btnExcel, opacity: res.turnos ? 1 : 0.4 }}>{icoDescarga} Trabajadores</button>}
              <button onClick={() => setPublicando(true)} disabled={!res.turnos || !orgId} title={res.turnos ? "Publicar los turnos de este calendario para un día: los conductores los ven en el móvil y Control los sigue en vivo" : "Primero hay que hacer los turnos (paso 2)"}
                style={{ ...btnSec, color: C.blueText || C.blue, border: `1px solid ${C.blue}66`, fontWeight: 600, opacity: res.turnos && orgId ? 1 : 0.4, cursor: res.turnos && orgId ? "pointer" : "not-allowed" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M22 2 11 13" /><path d="M22 2 15 22 11 13 2 9z" /></svg>
                Publicar a Control
              </button>
              <button onClick={() => setARostering(true)} disabled={!orgId} title="Mandar los turnos de un mes al Rostering: cada día, los del calendario que circula" style={{ ...btnSec, opacity: orgId ? 1 : 0.4 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                Enviar a Rostering
              </button>
            </>}
            <div style={{ flex: 1 }} />
            <input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Filtrar por línea…" style={{ width: 130, background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "5px 9px", fontSize: 11.5, fontFamily: font, outline: "none" }} />
            <button onClick={() => setShowOpt(s => !s)} title={modo === "vehicles" ? "Buscar los mejores vehículos de este calendario" : "Buscar los mejores turnos sobre estos vehículos"} style={{ ...btnSec, padding: "6px 12px", fontSize: 12, fontWeight: 600, background: showOpt ? C.blueDim : "none", border: `1px solid ${showOpt ? C.blue : C.border2}`, color: showOpt ? C.blueText : C.text }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="3 17 9 11 13 15 21 7" /><polyline points="15 7 21 7 21 13" /></svg>
              {opt.estado === "corriendo" ? `Optimizando ${opt.progreso[1] ? Math.round((100 * opt.progreso[0]) / opt.progreso[1]) : 0}%` : modo === "vehicles" ? "Optimizar vehículos" : "Optimizar turnos"}
            </button>
            <button onClick={() => { setPanelLineas(false); if (perderManuales(fase)) { marcarPlanningVisto(dia); calcular(params, fase); } }} disabled={calculando} style={{
              padding: "7px 16px", borderRadius: 7, border: "none", background: pendientes ? C.amber : C.blue, color: pendientes ? "#0b1220" : "#fff",
              fontSize: 12, fontWeight: 600, cursor: calculando ? "wait" : "pointer", fontFamily: font, flexShrink: 0, whiteSpace: "nowrap",
            }}>{calculando ? "Generando…" : `${modo === "vehicles" ? "Generar vehículos" : "Generar turnos"}${pendientes ? " con los cambios" : ""}`}</button>
          </div>

          {avisoPlanning && (
            <div style={{ padding: "7px 16px", fontSize: 12, color: "#0b1220", background: C.amber, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
              <span>⚠ <b>Se ha modificado el Planning</b> desde la última vez que se trabajó este calendario: {avisoPlanning.detalle} · {new Date(avisoPlanning.atMs).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}. El escenario ya se ha recalculado con los cambios; conviene volver a optimizar.</span>
              <button onClick={() => marcarPlanningVisto(dia)} style={{ marginLeft: "auto", background: "#0b1220", border: "none", color: C.amber, borderRadius: 5, padding: "3px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: font, flexShrink: 0 }}>Entendido</button>
            </div>
          )}
          {manualesActuales.length > 0 && (
            <div style={{ padding: "5px 16px", fontSize: 11.5, color: C.blueText, background: "rgba(92,155,255,0.08)", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12 }}>
              <span>✎ {manualesActuales.length} cambio{manualesActuales.length > 1 ? "s" : ""} a mano en este calendario ({manualesActuales.filter(esCambioVehiculos).length} de vehículos, {manualesActuales.filter(esCambioTurnos).length} de turnos). Se guardan y se vuelven a aplicar al abrirlo.</span>
              <button onClick={deshacer} disabled={calculando} style={{ background: "none", border: `1px solid ${C.border2}`, color: C.text, borderRadius: 5, padding: "2px 9px", fontSize: 11, cursor: "pointer", fontFamily: font }}>Deshacer el último</button>
              <button onClick={quitarManuales} disabled={calculando} style={{ background: "none", border: "none", color: C.muted, fontSize: 11, cursor: "pointer", fontFamily: font, textDecoration: "underline" }}>Quitarlos todos</button>
            </div>
          )}
          {aRostering && red && <EnviarRostering red={red} projectId={projectId} orgId={orgId} estadoDe={estadoParaRoster} turnosDe={turnosParaRoster} onCerrar={() => setARostering(false)} />}
          {publicando && res?.turnos && <PublicarServicio red={red} res={res} dia={dia} cocheras={cocheras} projectId={projectId} orgId={orgId} proyecto={proyecto} sesion={sesion} onCambiarDia={cambiarDia}
            avisoManual={calculando || opt.estado === "corriendo" ? "Hay un cálculo en marcha: espera a que termine para publicar lo último." : null} onCerrar={() => setPublicando(false)} />}
          {showC && <Restricciones p={restriccionesUI} red={red} onCambiarDia={cambiarDia} onChange={ch => setCambios(c => ({ ...c, ...ch }))} onCerrar={() => setShowC(false)} />}
          {showOpt && <PanelOptimizar fase={fase} p={params} diaNombre={nombreDia(dia, red)} objetivo={fase === "vehiculos" ? objetivoV : objetivoT} setObjetivo={fase === "vehiculos" ? setObjetivoV : setObjetivoT}
            opt={opt} onOptimizar={optimizar} onAplicar={aplicarOpt} onRestricciones={() => setShowC(true)}
            optJunto={optJunto} onOptimizarJunto={optimizarJunto} onAplicarJunto={aplicarJunto}
            bloqueado={lote ? "Espera a que terminen los cálculos de la pestaña Calendarios" : null} />}
          {res && ((params.flotaMax > 0 && res.kpis.autobuses > params.flotaMax) || (params.conductoresMax > 0 && res.kpis.turnos > params.conductoresMax)) && (
            <div style={{ padding: "6px 16px", fontSize: 11.5, color: C.red, background: "rgba(248,113,113,0.08)", borderBottom: "1px solid rgba(248,113,113,0.3)" }}>
              El escenario no cabe en los recursos disponibles:
              {params.flotaMax > 0 && res.kpis.autobuses > params.flotaMax && ` necesita ${num(res.kpis.autobuses)} autobuses y hay ${num(params.flotaMax)}.`}
              {params.conductoresMax > 0 && res.kpis.turnos > params.conductoresMax && ` Necesita ${num(res.kpis.turnos)} conductores y hay ${num(params.conductoresMax)}.`}
              {" "}Prueba «Optimizar» o relaja las restricciones.
            </div>
          )}
          {res?.turnos && <PorQueSinTipo res={res} p={params} onRestricciones={() => setShowC(true)} />}

          {res && !res.conCocheras && (
            <div style={{ padding: "6px 16px", fontSize: 11.5, color: C.amber, background: "rgba(251,191,36,0.08)", borderBottom: "1px solid rgba(251,191,36,0.3)" }}>
              Sin cocheras: no se calculan las salidas ni las vueltas a cochera ni sus km en vacío. Añádelas en Planning («Cocheras»).
            </div>
          )}
          {res?.aproximado && (
            <div style={{ padding: "6px 16px", fontSize: 11.5, color: C.amber, background: "rgba(251,191,36,0.08)", borderBottom: "1px solid rgba(251,191,36,0.3)" }}>
              Esta red se importó sin las horas de salida de cada viaje: se han repartido entre la primera y la última de cada sentido. Vuelve a importar el GTFS en Planning («Sustituir red») para usar los horarios exactos.
            </div>
          )}

          {res && <KpiBar k={kpisBarra(res, params)} base={actual.base} onConfigCostes={() => setShowC(true)} cambios={cambiosKpi(res, params)} />}
          {res && modo === "workers" && !res.turnos ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ textAlign: "center", maxWidth: 460 }}>
                <div style={{ fontSize: 15, color: C.text, fontWeight: 600, marginBottom: 6 }}>Paso 2 · Turnos de conductor</div>
                <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6, marginBottom: 16 }}>
                  Los vehículos de este calendario ({num(res.kpis.autobuses)} autobuses, {num(res.kpis.bloques)} bloques, {num(res.kpis.kmVacio || 0)} km en vacío) aún no tienen turnos. Se hacen sobre esos bloques sin cambiarlos.
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                  <button onClick={() => calcular(params, "turnos", { conservar: true })} disabled={calculando} style={{ padding: "8px 18px", borderRadius: 7, border: "none", background: C.blue, color: "#fff", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: font }}>{calculando ? "Generando…" : "Generar turnos"}</button>
                  <button onClick={() => setShowOpt(true)} style={{ padding: "8px 18px", borderRadius: 7, border: `1px solid ${C.border2}`, background: "none", color: C.text, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: font }}>Optimizar turnos…</button>
                </div>
              </div>
            </div>
          ) : res ? <Gantt key={`${modo}|${res.params.dia}|${!!res.turnos}`} res={res} modo={modo} filtro={filtro} paradasPorId={paradasPorId} onMover={calculando ? null : mover} />
            : <div style={{ padding: 20, color: C.muted, fontSize: 13 }}>{calculando ? "Generando…" : "Pulsa «Generar vehículos»."}</div>}
        </div>
      )}
      {nota && (
        <div onClick={() => setNota(null)} style={{ position: "fixed", left: "50%", bottom: 22, transform: "translateX(-50%)", zIndex: 3000, maxWidth: "min(760px, calc(100vw - 32px))", padding: "9px 16px", borderRadius: 9, fontSize: 12.5, cursor: "pointer",
          background: nota.error ? "#3a1620" : "#0d2f22", border: `1px solid ${nota.error ? C.red : C.green}`, color: nota.error ? "#fecaca" : "#bbf7d0", boxShadow: "0 10px 30px rgba(0,0,0,.5)" }}>{nota.texto}</div>
      )}
    </div>
  );
}
