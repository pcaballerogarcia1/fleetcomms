// App del conductor → Rutas: portada, fichaje, tareas correctivas y su cuadrante.
import { CalendarDays, ChevronLeft, Loader2, Plus, TriangleAlert, Upload, WifiOff, X } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { db } from "../firebase.js";
import { collection, onSnapshot, addDoc, updateDoc, doc, query, where, orderBy, limit, setDoc } from "firebase/firestore";
import { puedeGestionarRutas as puedeGestionarRutasRol } from "../roles.js";
import { aplicarCambios, camposCambiados, colaDe } from "./cola.js";
import {
  C, CUADRANTE_META, MESES_ES, S, TIPOS_TRABAJO, VEHICULOS,
  avatarOf, fbUpdate, fmtDuracion, fmtHora, fmtMes, font,
  haversineKm, hhmm, mono, parseKML, recorridoParaGuardar, timeAgo,
} from "./comun.js";
import { DetallePlan } from "./ruta-detalle.jsx";
import { Btn } from "./ui.jsx";
import { comprobarLugarFichaje, escucharDepotsFichaje, RADIO_FICHAJE_M } from "../fichaje-depots.js";
import { tono } from "../tema.js";
import { MisAusencias } from "../vacaciones/app-trabajador.jsx";

// Correctivo: tarjeta de tarea manual (sin KML)
function TarjetaCorrectivo({tarea,sesion,onUpdate,onDelete,usuarios}){
  const [expandida,setExpandida]=useState(false);
  const [comentario,setCom]=useState("");
  const getUser=id=>usuarios.find(u=>u.id===id)||{nombre:"?",apellidos:""};
  const statusColor=tarea.estado==="cerrada"?C.green:tarea.estado==="en curso"?C.orange:C.red;

  function agregarCom(){
    if(!comentario.trim())return;
    onUpdate({...tarea,comentarios:[...(tarea.comentarios||[]),{usuarioId:sesion.id,texto:comentario,fecha:Date.now()}]});
    setCom("");
  }
  function cambiarEstado(est){onUpdate({...tarea,estado:est});}

  return(
    <div style={{...S.card}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tarea.titulo}</div>
          <div style={{fontSize:10,color:C.muted,marginBottom:4}}>{tarea.vehiculo||"Sin vehículo"} · {tarea.fecha?(tarea.fecha.toDate?tarea.fecha.toDate():new Date(tarea.fecha)).toLocaleDateString("es-ES"):"—"}</div>
          {tarea.descripcion&&<div style={{fontSize:11,color:C.muted,lineHeight:1.5,display:"-webkit-box",WebkitLineClamp:expandida?99:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{tarea.descripcion}</div>}
        </div>
        <span style={{fontSize:12,padding:"3px 8px",borderRadius:12,background:`${statusColor}22`,color:statusColor,border:`1px solid ${statusColor}44`,textTransform:"capitalize",flexShrink:0,marginLeft:8}}>{tarea.estado}</span>
      </div>
      {/* Estado */}
      <div style={{display:"flex",gap:5,marginBottom:8}}>
        {["pendiente","en curso","cerrada"].map(est=>(
          <button key={est} onClick={()=>cambiarEstado(est)} style={{flex:1,padding:"5px 4px",borderRadius:8,cursor:"pointer",fontSize:10,fontFamily:mono,textTransform:"capitalize",letterSpacing:0.5,background:tarea.estado===est?tono("#1d222d", "#ebedf2"):"none",border:`1px solid ${tarea.estado===est?C.blue:C.border}`,color:tarea.estado===est?C.blueText:C.muted}}>{est}</button>
        ))}
      </div>
      {/* Expandir comentarios */}
      <button onClick={()=>setExpandida(v=>!v)} style={{...S.btnGhost,width:"100%",fontSize:10,padding:"4px 10px",display:"flex",justifyContent:"space-between"}}>
        <span>Comentarios ({tarea.comentarios?.length||0})</span><span>{expandida?"▲":"▼"}</span>
      </button>
      {expandida&&(
        <div style={{marginTop:8}}>
          {(tarea.comentarios||[]).map((c,i)=>{const u=getUser(c.usuarioId);return(
            <div key={i} style={{background:C.input,borderRadius:8,padding:"7px 10px",marginBottom:5}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                <div style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:18,height:18,borderRadius:"50%",background:C.blueDim,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:C.blueText,fontWeight:700}}>{avatarOf(u)}</div><span style={{fontSize:11,color:C.muted}}>{u.nombre}</span></div>
                <span style={{fontSize:10,color:C.dim}}>{timeAgo(c.fecha)}</span>
              </div>
              <div style={{fontSize:12,color:C.muted,lineHeight:1.5}}>{c.texto}</div>
            </div>
          );})}
          <div style={{display:"flex",gap:6,marginTop:6}}>
            <input value={comentario} onChange={e=>setCom(e.target.value)} onKeyDown={e=>e.key==="Enter"&&agregarCom()} placeholder="Añadir comentario..." style={{...S.input,flex:1,fontSize:12,padding:"7px 10px"}}/>
            <button onClick={agregarCom} style={{...S.btnSm}}>↑</button>
          </div>
          {puedeGestionarRutasRol(sesion.rol)&&<button onClick={onDelete} style={{background:tono("#2d1515", "#f4e8e8"),border:`1px solid ${C.red}44`,color:C.red,width:"100%",padding:"7px",borderRadius:8,fontSize:11,cursor:"pointer",fontFamily:mono,marginTop:6}}>Eliminar tarea</button>}
        </div>
      )}
    </div>
  );
}

function FichajeWidget({ sesion }){
  const [fichajeAbierto, setFichajeAbierto] = useState(undefined); // undefined=cargando, null=ninguno
  const [recientes, setRecientes] = useState([]);
  const [km, setKm] = useState("");
  const [matricula, setMatricula] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [, forceTick] = useState(0); // refresca el cronómetro cada minuto mientras hay fichaje abierto
  const [lugares, setLugares] = useState([]); // depots de la empresa: solo se ficha cerca de uno
  useEffect(() => escucharDepotsFichaje(sesion?.org_id, setLugares), [sesion?.org_id]);

  // El fichaje abierto y los últimos cerrados (antes se descargaba toda la
  // historia del conductor en cada apertura: ver e2e/informe-lecturas.md).
  useEffect(()=>{
    if(!sesion?.id) return;
    const q = query(collection(db,"fichajes"), where("uid","==",sesion.id), where("estado","==","abierto"), limit(5));
    return onSnapshot(q, snap=>{
      setFichajeAbierto(snap.docs.map(d=>({_id:d.id,...d.data()}))[0] || null);
    }, e=>{ console.error("[fichaje] error leyendo:", e); setFichajeAbierto(null); });
  },[sesion?.id]);
  useEffect(()=>{
    if(!sesion?.id) return;
    const q = query(collection(db,"fichajes"), where("uid","==",sesion.id), orderBy("horaEntrada","desc"), limit(6));
    return onSnapshot(q, snap=>{
      setRecientes(snap.docs.map(d=>({_id:d.id,...d.data()})).filter(f=>f.estado==="cerrado").slice(0,5));
    }, e=>console.error("[fichaje] error leyendo los últimos:", e));
  },[sesion?.id]);

  useEffect(()=>{
    if(!fichajeAbierto) return;
    const t = setInterval(()=>forceTick(x=>x+1), 60000);
    return ()=>clearInterval(t);
  },[fichajeAbierto]);

  async function ficharEntrada(){
    const v = km.trim();
    const mat = matricula.trim();
    if(!v || isNaN(+v)){ setErr("Introduce el cuentakilómetros de inicio"); return; }
    if(!mat){ setErr("Introduce la matrícula del vehículo"); return; }
    setSaving(true); setErr("");
    try{
      const { lugar } = await comprobarLugarFichaje(lugares);
      await addDoc(collection(db,"fichajes"),{
        uid: sesion.id, org_id: sesion.org_id ?? null,
        nombre: [sesion.nombre, sesion.apellidos].filter(Boolean).join(" "),
        fecha: new Date().toISOString().slice(0,10),
        horaEntrada: Date.now(), horaSalida: null,
        matricula: mat.toUpperCase(),
        kmInicio: +v, kmFin: null, kmRecorridos: null,
        estado: "abierto",
        ...(lugar ? { lugarEntrada: lugar } : {}),
      });
      setKm(""); setMatricula("");
    }catch(e){ setErr(e.message?.startsWith("Estás a") || e.message?.startsWith("Activa") || e.message?.startsWith("No se ha podido saber") ? e.message : "No se pudo fichar entrada: "+e.message); }
    setSaving(false);
  }

  async function ficharSalida(){
    const v = km.trim();
    if(!v || isNaN(+v)){ setErr("Introduce el cuentakilómetros de fin"); return; }
    const kmFin = +v;
    if(kmFin < fichajeAbierto.kmInicio){ setErr("El km de fin no puede ser menor que el de inicio"); return; }
    setSaving(true); setErr("");
    try{
      const { lugar } = await comprobarLugarFichaje(lugares);
      await updateDoc(doc(db,"fichajes",fichajeAbierto._id),{
        horaSalida: Date.now(), kmFin, kmRecorridos: +(kmFin - fichajeAbierto.kmInicio).toFixed(1),
        estado: "cerrado",
        ...(lugar ? { lugarSalida: lugar } : {}),
      });
      setKm("");
    }catch(e){ setErr(e.message?.startsWith("Estás a") || e.message?.startsWith("Activa") || e.message?.startsWith("No se ha podido saber") ? e.message : "No se pudo fichar salida: "+e.message); }
    setSaving(false);
  }

  if(fichajeAbierto === undefined) return null;

  return (
    <div style={{...S.card, margin:"12px 14px 0"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom: fichajeAbierto?10:0}}>
        <div>
          <div style={{fontSize:13,fontWeight:700}}>
            {fichajeAbierto ? "Jornada en curso" : "Sin fichar"}
          </div>
          {fichajeAbierto && (
            <div style={{fontSize:11,color:C.muted,marginTop:2}}>
              Desde las {fmtHora(fichajeAbierto.horaEntrada)} · {fmtDuracion(fichajeAbierto.horaEntrada)} · {fichajeAbierto.matricula || "sin matrícula"} · {fichajeAbierto.kmInicio} km inicio
            </div>
          )}
        </div>
        {recientes.length>0 && (
          <button onClick={()=>setExpanded(e=>!e)} style={{background:"none",border:"none",color:C.dim,fontSize:11,cursor:"pointer",fontFamily:font}}>
            {expanded ? "ocultar" : "historial"}
          </button>
        )}
      </div>

      {!fichajeAbierto && (
        <input
          type="text" placeholder="Matrícula del vehículo"
          value={matricula} onChange={e=>setMatricula(e.target.value)}
          style={{...S.input, marginBottom:8, textTransform:"none"}}
        />
      )}
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        <input
          type="number" inputMode="decimal"
          placeholder={fichajeAbierto ? "Km de fin" : "Km de inicio"}
          value={km} onChange={e=>setKm(e.target.value)}
          style={{...S.input, flex:1}}
        />
        <Btn
          onClick={fichajeAbierto ? ficharSalida : ficharEntrada}
          variant={fichajeAbierto ? "danger" : "success"}
          size="md" disabled={saving}
        >
          {saving ? "..." : (fichajeAbierto ? "Fichar salida" : "Fichar entrada")}
        </Btn>
      </div>
      {err && <div style={{fontSize:11,color:C.red,marginTop:6}}>{err}</div>}
      {lugares.length > 0 && !err && <div style={{fontSize:11,color:C.dim,marginTop:6}}>Solo se puede fichar a menos de {RADIO_FICHAJE_M / 1000} km de un depot.</div>}

      {expanded && recientes.length>0 && (
        <div style={{marginTop:12,paddingTop:10,borderTop:`1px solid ${C.border}`}}>
          {recientes.map(f=>(
            <div key={f._id} style={{display:"flex",justifyContent:"space-between",fontSize:11,color:C.muted,padding:"4px 0"}}>
              <span>{f.fecha} · {fmtHora(f.horaEntrada)}–{fmtHora(f.horaSalida)} · {f.matricula || "—"}</span>
              <span style={{color:C.text,fontWeight:600}}>{f.kmRecorridos ?? "—"} km</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── MÓDULO RUTAS POR TIPO ─────────────────────────────────────────
// Aviso de cobertura: cuántos cambios esperan en el móvil a ser enviados
function useCola(uid){
  const cola=colaDe(uid||"anonimo");
  const [estado,setEstado]=useState(()=>cola.estado());
  useEffect(()=>cola.suscribir(setEstado),[cola]);
  useEffect(()=>{
    const f=()=>setEstado(cola.estado());
    window.addEventListener("online",f);window.addEventListener("offline",f);
    return()=>{window.removeEventListener("online",f);window.removeEventListener("offline",f);};
  },[cola]);
  return [cola,estado];
}
export function AvisoCobertura({estado}){
  if(estado.enLinea&&!estado.pendientes&&!estado.ultimoError) return null;
  const sin=!estado.enLinea;
  const color=estado.ultimoError?C.red:sin?C.orange:C.blue;
  const n=estado.pendientes;
  const texto=estado.ultimoError
    ?estado.ultimoError
    :sin
      ?`Sin cobertura${n?` · ${n} cambio${n===1?"":"s"} guardado${n===1?"":"s"} en el móvil, se enviarán solos`:" · puedes seguir marcando paradas"}`
      :`Enviando ${n} cambio${n===1?"":"s"}…`;
  return <div data-testid="aviso-cobertura" style={{background:`${color}1f`,border:`1px solid ${color}55`,color,borderRadius:8,padding:"7px 12px",fontSize:12,fontWeight:600,margin:"8px 14px 0"}}>{sin?<WifiOff size={14} style={{verticalAlign:"-2px",marginRight:6}}/>:<Loader2 size={14} className="op-girando" style={{verticalAlign:"-2px",marginRight:6}}/>}{texto}</div>;
}

// Nombre propio del trabajo (puesto al publicar desde Scheduling o Rostering)
const trabajoDe = p => (p.trabajo && String(p.trabajo).trim()) || null;
// Apartados de la portada: los cuatro de siempre y, detrás de cada uno, los
// trabajos con nombre propio de ese tipo que haya en los planes
function gruposTrabajo(planes){
  return TIPOS_TRABAJO.flatMap(t=>{
    const propios=[...new Set(planes.filter(p=>p.tipo===t.key).map(trabajoDe).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"es"));
    return [{t,trabajo:null},...propios.map(trabajo=>({t,trabajo}))];
  });
}

function ModuloRutas({planes,addPlan,updatePlan,deletePlan,sesion,usuarios}){
  const [tipoActivo,setTipoActivo]   = useState(null); // null = portada · { key, trabajo } (trabajo: nombre propio puesto al publicar, o null)
  const [planActivo,setPlanActivo]   = useState(null);
  // Cambios de paradas de esta persona que aún no han llegado al servidor
  // (sin cobertura, o enviándose): se pintan encima de su versión
  const [cola,estadoCola]            = useCola(sesion?.id);
  const [showUpload,setShowUpload]   = useState(false);
  const [showNuevaTarea,setShowNT]   = useState(false);
  const [subiendo,setSubiendo]       = useState(false);
  const [errorMsg,setErrorMsg]       = useState("");
  const [debugInfo,setDebugInfo]     = useState([]);
  const [mesFilter,setMesFilter]     = useState(null);
  // superadmin: no pertenece a ninguna empresa, elige a cuál sube los KML
  const esSA=sesion?.rol==="superadmin";
  const [orgs,setOrgs]               = useState([]);
  const [orgDestino,setOrgDestino]   = useState(sesion?.org_id||"");
  // fecha de servicio de los KML que se suben: vacía = la que diga el KML (o el mes actual)
  const [fechaKml,setFechaKml]       = useState("");
  useEffect(()=>{
    if(!esSA) return;
    return onSnapshot(collection(db,"orgs"),snap=>setOrgs(snap.docs.map(d=>({org_id:d.id,...d.data()})).sort((a,b)=>(a.nombre||"").localeCompare(b.nombre||""))),()=>setOrgs([]));
  },[esSA]);
  const [formTarea,setFormTarea]     = useState({titulo:"",descripcion:"",vehiculo:"",estado:"pendiente"});
  const [verCuadrante,setVerCuadrante] = useState(false);
  const fileRef = useRef();
  // Intermedio tiene la misma gestión de Rutas que Administrador (subir
  // KML, borrar planes, gestionar tareas) — solo Incidencias/Inventario/
  // Usuarios quedan fuera de su alcance, filtrado más arriba en el árbol.
  const esAdmin = puedeGestionarRutasRol(sesion.rol);

  // Compartir ubicación en vivo mientras se está en Rutas, para el mapa de
  // flota de Control. Pide permiso del navegador la primera vez que entra
  // aquí; si lo deniega, simplemente no comparte (sin romper nada). Las
  // escrituras se limitan a 1 cada ~20s para no gastar batería/datos ni
  // saturar Firestore.
  //
  // planId + lastMovedAt: para las alertas de Control (parada prolongada
  // fuera de programa / fuera de zona) hace falta saber a qué plan de hoy
  // pertenece esta ubicación y desde cuándo el vehículo lleva parado de
  // verdad (no solo el ruido normal del GPS) — lastMovedAt solo avanza si
  // la posición se mueve más de MOVE_THRESHOLD_KM respecto a la última
  // escritura, así Control puede calcular "cuánto lleva parado" sin
  // necesitar guardar un historial completo de posiciones.
  useEffect(()=>{
    if(!navigator.geolocation || !sesion?.id) return;
    const uid = sesion.id;
    const ref = doc(db,"ubicaciones_activas",uid);
    const planId = planActivo?._id ?? null;
    let lastWrite = 0;
    let lastPos = null;
    let lastMovedAt = Date.now();
    const MIN_INTERVAL_MS = 20000;
    const MOVE_THRESHOLD_KM = 0.03; // 30m — evita que el ruido del GPS parado cuente como movimiento

    const watchId = navigator.geolocation.watchPosition(
      pos=>{
        const now = Date.now();
        if(now - lastWrite < MIN_INTERVAL_MS) return;
        lastWrite = now;
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        if(!lastPos || haversineKm(lastPos.lat, lastPos.lng, lat, lng) > MOVE_THRESHOLD_KM) lastMovedAt = now;
        lastPos = { lat, lng };
        setDoc(ref,{
          uid, org_id: sesion.org_id ?? null, // Firestore rejects `undefined` outright (silent no-op otherwise)
          nombre: [sesion.nombre, sesion.apellidos].filter(Boolean).join(" "),
          lat, lng, planId,
          activo: true, updatedAt: now, lastMovedAt,
        },{merge:true}).then(
          ()=>console.log("[ubicación] guardada", lat, lng),
          e=>console.error("[ubicación] error al guardar:", e)
        );
      },
      e=>console.error("[ubicación] error de geolocalización:", e.code, e.message),
      { enableHighAccuracy:false, maximumAge:15000, timeout:20000 }
    );

    return ()=>{
      navigator.geolocation.clearWatch(watchId);
      setDoc(ref,{activo:false},{merge:true}).catch(e=>console.error("[ubicación] error al marcar inactivo:", e));
    };
  },[sesion?.id, sesion?.org_id, sesion?.nombre, sesion?.apellidos, planActivo?._id]);

  // Si hay plan activo, mostrar detalle: la versión del SERVIDOR (así se ven
  // las paradas que marcan otros a la vez) con los cambios propios que aún
  // se están guardando pintados encima, para que el ✓ salga al instante sin
  // esperar la ida y vuelta a Firestore (muy notorio en 4G).
  if(verCuadrante) return <MiCuadrante sesion={sesion} onBack={()=>setVerCuadrante(false)}/>;

  if(planActivo){
    const fresco=planes.find(p=>p._id===planActivo._id)||planActivo;
    const planMostrado={...fresco,ubicaciones:aplicarCambios(fresco.ubicaciones||[],cola.pendientesDe(fresco._id))};
    return <>
      <AvisoCobertura estado={estadoCola}/>
      <DetallePlan plan={planMostrado} sesion={sesion} onBack={()=>setPlanActivo(null)} onUpdate={(updated,cambio)=>{
        if(!cambio){
          setPlanActivo(updated);
          fbUpdate("planes",updated._id,{ubicaciones:updated.ubicaciones}).catch(e=>console.error("Guardando parada:",e));
          return;
        }
        // se guarda en el móvil y se envía cuando se pueda (cola.js)
        const antes=planMostrado.ubicaciones.find(u=>String(u.id)===String(cambio.ubicId));
        if(antes) cola.encolar(fresco._id,cambio.ubicId,camposCambiados(antes,cambio.cambio(antes)));
      }}/>
    </>;
  }

  // El tipo abierto, con el nombre propio del trabajo si lo tiene
  const tipoBase = tipoActivo && TIPOS_TRABAJO.find(t=>t.key===tipoActivo.key);
  const tipo = tipoBase && { ...tipoBase, label: tipoActivo.trabajo || tipoBase.label };
  const delGrupo = (p, key, trabajo) => p.tipo===key && (trabajoDe(p)||null)===(trabajo||null);

  // ── PORTADA ──
  if(!tipoActivo) return(
    <div style={{paddingBottom:80}}>
      <AvisoCobertura estado={estadoCola}/>
      <FichajeWidget sesion={sesion} />
      <div style={{padding:"12px 14px 0"}}>
        <div onClick={()=>setVerCuadrante(true)} style={{...S.card,cursor:"pointer",marginBottom:18}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{width:46,height:46,borderRadius:12,background:`${C.blue}18`,border:`1px solid ${C.blue}33`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,color:C.blue}}><CalendarDays size={22} strokeWidth={1.8}/></div>
            <div style={{flex:1}}>
              <div style={{fontSize:15,fontWeight:700,marginBottom:3}}>Mi cuadrante</div>
              <div style={{fontSize:11,color:C.muted}}>Tus turnos, libres y vehículo de cada día · pedir vacaciones</div>
            </div>
            <div style={{fontSize:20,color:C.border}}>›</div>
          </div>
        </div>
        <div style={{fontSize:12,color:C.dim,letterSpacing:0,textTransform:"none",marginBottom:14}}>Selecciona tipo de trabajo</div>
        {gruposTrabajo(planes).map(({t,trabajo})=>{
          const planesTipo=planes.filter(p=>delGrupo(p,t.key,trabajo));
          const total=planesTipo.length;
          const completados=planesTipo.filter(p=>{
            if(p.tipo==="corr") return p.estado==="cerrada";
            const ubs=p.ubicaciones||[];
            return ubs.length>0&&ubs.every(u=>u.realizado);
          }).length;
          return(
            <div key={t.key+"|"+(trabajo||"")} onClick={()=>setTipoActivo({key:t.key,trabajo})} style={{...S.card,cursor:"pointer",marginBottom:10}}
              onMouseEnter={e=>e.currentTarget.style.borderColor=C.blueText}
              onMouseLeave={e=>e.currentTarget.style.borderColor=t.color}>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <div style={{width:46,height:46,borderRadius:12,background:`${t.color}18`,border:`1px solid ${t.color}33`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,color:t.color}}><t.Icono size={22} strokeWidth={1.8}/></div>
                <div style={{flex:1}}>
                  <div style={{fontSize:15,fontWeight:700,marginBottom:3}}>{trabajo||t.label}</div>
                  <div style={{fontSize:11,color:C.muted}}>{total} {t.kml?"planes":"tareas"} · {completados} completados</div>
                  {!t.kml&&<div style={{fontSize:10,color:C.dim,marginTop:2}}>Sin rutas KML · gestión manual</div>}
                </div>
                <div style={{fontSize:20,color:C.border}}>›</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  // ── VISTA TIPO CON KML ──
  if(tipo.kml){
    const planesT=planes.filter(p=>delGrupo(p,tipoActivo.key,tipoActivo.trabajo));
    const meses=[...new Set(planesT.map(p=>p.mes))].sort((a,b)=>b.localeCompare(a));
    const filtrados=mesFilter?planesT.filter(p=>p.mes===mesFilter):planesT;

    function handleFiles(e){
      const files=Array.from(e.target.files);
      if(!files.length)return;
      if(esSA&&!orgDestino){setErrorMsg("Elige primero la empresa a la que subir el KML.");e.target.value="";return;}
      setSubiendo(true);setErrorMsg("");setDebugInfo([]);
      let done=0;
      files.forEach(file=>{
        if(/\.kmz$/i.test(file.name)){setErrorMsg(`«${file.name}» es un KMZ (comprimido): ábrelo en Google Earth y guárdalo como KML.`);done++;if(done===files.length)setSubiendo(false);return;}
        const reader=new FileReader();
        reader.onload=ev=>{
          try{
            const {ubicaciones,recorrido,docName,debug}=parseKML(ev.target.result);
            setDebugInfo(debug||[]);
            if(ubicaciones.length===0){
              setErrorMsg(`Sin ubicaciones en "${file.name}". Ver debug.`);
            } else {
              const turno=ubicaciones[0]?.turno||"";
              // la fecha elegida al subir manda sobre la del KML
              const elegida=/^\d{4}-\d{2}-\d{2}$/.test(fechaKml)?fechaKml.split("-"):null;
              const dia=elegida?`${elegida[2]}/${elegida[1]}/${elegida[0]}`:(ubicaciones[0]?.dia||"");
              let mes=new Date().toISOString().slice(0,7);
              if(dia){const p=dia.split("/");if(p.length===3)mes=p[2]+"-"+p[1].padStart(2,"0");}
              // se espera a que se guarde: si falla (permisos, conexión), se dice
              Promise.resolve(addPlan({tipo:tipoActivo.key,...(tipoActivo.trabajo?{trabajo:tipoActivo.trabajo}:{}),nombre:docName||file.name.replace(/\.kml$/i,""),archivo:file.name,turno,mes,diaServicio:dia,ubicaciones,recorrido:recorridoParaGuardar(recorrido),fechaSubida:Date.now(),...(esSA&&orgDestino?{org_id:orgDestino}:{})}))
                .then(()=>{setShowUpload(false);setDebugInfo([]);})
                .catch(err=>setErrorMsg(`No se pudo guardar «${file.name}»: ${err?.message||err}`));
            }
          }catch(err){setErrorMsg("Error: "+err.message);}
          done++;if(done===files.length)setSubiendo(false);
        };
        reader.onerror=()=>{setErrorMsg("Error leyendo "+file.name);done++;if(done===files.length)setSubiendo(false);};
        reader.readAsText(file,"UTF-8");
      });
      e.target.value="";
    }

    return(
      <div style={{paddingBottom:80}}>
        {/* Sub-header tipo */}
        <div style={{borderBottom:`1px solid ${C.border}`,padding:"12px 14px",display:"flex",alignItems:"center",gap:12}}>
          <button onClick={()=>{setTipoActivo(null);setShowUpload(false);setErrorMsg("");setDebugInfo([]);setMesFilter(null);}} style={{...S.btnGhost,padding:"7px 10px",flexShrink:0}} title="Volver"><ChevronLeft size={18} style={{verticalAlign:"-4px"}}/></button>
          <div style={{width:36,height:36,borderRadius:12,background:`${tipo.color}1a`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><tipo.Icono size={18} color={tipo.color}/></div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:15,fontWeight:650,color:C.text,letterSpacing:"-0.01em"}}>{tipo.label}</div>
            <div style={{fontSize:13,color:C.muted}}>{planesT.length} {planesT.length===1?"plan":"planes"}</div>
          </div>
        </div>

        <div style={{padding:"12px 14px 0"}}>
          {esAdmin&&(
            <>
              <button onClick={()=>{setShowUpload(v=>!v);setErrorMsg("");setDebugInfo([]);}} style={{...S.btnGhost,width:"100%",marginBottom:10,padding:"11px 14px",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                {showUpload?<><X size={16}/> Cancelar</>:<><Upload size={16}/> Subir KML</>}
              </button>
              {showUpload&&(
                <div style={{...S.card,marginBottom:10}}>
                  <div style={{fontSize:11,color:C.muted,marginBottom:10,lineHeight:1.7}}>Sube archivos KML de {tipo.label.toLowerCase()}. La app detecta turno, fecha y paradas automáticamente.</div>
                  {esSA&&<div style={{marginBottom:10}}>
                    <div style={{fontSize:11,color:C.muted,marginBottom:4}}>Empresa</div>
                    <select value={orgDestino} onChange={e=>setOrgDestino(e.target.value)} style={{width:"100%",background:C.input,border:`1px solid ${C.border}`,color:C.text,borderRadius:8,padding:"9px 10px",fontSize:13}}>
                      <option value="">— Elige la empresa —</option>
                      {orgs.map(o=><option key={o.org_id} value={o.org_id}>{o.nombre||o.org_id}</option>)}
                    </select>
                  </div>}
                  <div style={{marginBottom:10}}>
                    <div style={{fontSize:11,color:C.muted,marginBottom:4}}>Fecha de servicio</div>
                    <input type="date" value={fechaKml} onChange={e=>setFechaKml(e.target.value)} style={{width:"100%",boxSizing:"border-box",background:C.input,border:`1px solid ${C.border}`,color:C.text,borderRadius:8,padding:"9px 10px",fontSize:13,colorScheme:tono("dark","light")}}/>
                    <div style={{fontSize:11,color:C.dim,marginTop:4}}>{fechaKml?"Los KML se guardan en esta fecha (y su mes en Control).":"Vacía: la fecha que diga el KML o, si no dice ninguna, este mes."}</div>
                  </div>
                  {errorMsg&&<div style={{background:tono("#2d1515", "#f4e8e8"),border:`1px solid ${C.red}44`,color:C.red,borderRadius:8,padding:"10px 12px",fontSize:12,marginBottom:10}}><TriangleAlert size={14} style={{verticalAlign:"-2px",marginRight:6}}/>{errorMsg}</div>}
                  {debugInfo.length>0&&<div style={{background:tono("#080f1a", "#e6ecf7"),border:`1px solid ${C.blueDim}`,borderRadius:8,padding:"10px 12px",fontSize:11,marginBottom:10}}><div style={{color:C.blueText,fontWeight:700,marginBottom:6}}>Detalle de la lectura:</div>{debugInfo.map((l,i)=><div key={i} style={{color:l.startsWith("ERROR")?C.red:l.includes("Ubicaciones")?C.green:C.muted,marginBottom:2}}>{l}</div>)}</div>}
                  <div onClick={()=>fileRef.current.click()} style={{background:tono("#080f1a", "#e6ecf7"),border:`2px dashed ${tipo.color}44`,borderRadius:12,padding:"28px 20px",textAlign:"center",cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.borderColor=tipo.color} onMouseLeave={e=>e.currentTarget.style.borderColor=tipo.color+"44"}>
                    <div style={{marginBottom:8,color:tipo.color}}><tipo.Icono size={30} strokeWidth={1.6}/></div>
                    <div style={{fontSize:13,color:tipo.color,fontWeight:600,marginBottom:4}}>{subiendo?"Procesando…":"Seleccionar KML"}</div>
                    <div style={{fontSize:10,color:C.dim}}>Formato: 02-02-2026.kml</div>
                  </div>
                  <input ref={fileRef} type="file" accept=".kml,application/vnd.google-earth.kml+xml,application/xml,text/xml,application/octet-stream" multiple onChange={handleFiles} style={{display:"none"}}/>
                </div>
              )}
            </>
          )}
          {meses.length>0&&<div style={{display:"flex",gap:6,overflowX:"auto",marginBottom:10,paddingBottom:2}}><button onClick={()=>setMesFilter(null)} style={{...S.btnGhost,fontSize:10,padding:"3px 10px",borderRadius:20,whiteSpace:"nowrap",borderColor:!mesFilter?tipo.color:C.border,color:!mesFilter?tipo.color:C.muted,background:!mesFilter?tipo.color+"18":"none"}}>Todos</button>{meses.map(m=><button key={m} onClick={()=>setMesFilter(m)} style={{...S.btnGhost,fontSize:10,padding:"3px 10px",borderRadius:20,whiteSpace:"nowrap",borderColor:mesFilter===m?tipo.color:C.border,color:mesFilter===m?tipo.color:C.muted,background:mesFilter===m?tipo.color+"18":"none"}}>{fmtMes(m)}</button>)}</div>}
          {filtrados.length===0&&<div style={{textAlign:"center",padding:"50px 0"}}><div style={{marginBottom:12,color:C.dim}}><tipo.Icono size={36} strokeWidth={1.5}/></div><div style={{fontSize:15,color:C.dim}}>Sin planes de {tipo.label.toLowerCase()}</div>{esAdmin&&<div style={{fontSize:11,color:"#374151",marginTop:6}}>Sube un KML para empezar</div>}</div>}
          {filtrados.map(plan=>{
            const real=plan.ubicaciones.filter(u=>u.realizado).length,tot=plan.ubicaciones.length;
            const tasa=tot?Math.round(real/tot*100):0,col=tasa===100?C.green:tasa>0?C.orange:C.dim;
            const totalQR=plan.ubicaciones.reduce((s,u)=>s+u.elementos.length,0);
            return(
              <div key={plan._id} style={{...S.card,cursor:"pointer"}} onClick={()=>setPlanActivo(plan)} onMouseEnter={e=>e.currentTarget.style.borderColor=C.blueText} onMouseLeave={e=>e.currentTarget.style.borderColor=tasa===100?C.green:tipo.color}>
                <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:5}}>
                      {plan.turno&&<span style={{fontSize:11,background:tipo.color+"18",color:tipo.color,border:`1px solid ${tipo.color}44`,borderRadius:12,padding:"2px 9px"}}>{plan.turno}</span>}
                      <span style={{fontSize:11,color:C.dim}}>{plan.diaServicio}</span>
                      {tasa===100&&<span style={{fontSize:11,color:C.green}}>✓</span>}
                    </div>
                    <div style={{fontSize:15,fontWeight:700,marginBottom:5,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{plan.nombre}</div>
                    <div style={{fontSize:11,color:C.muted,marginBottom:8}}>{tot} paradas · {totalQR} elementos QR</div>
                    <div style={{height:5,background:C.bg,borderRadius:4,overflow:"hidden",marginBottom:4}}><div style={{height:"100%",background:col,borderRadius:4,width:`${tasa}%`,transition:"width 0.4s"}}/></div>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:C.dim}}><span>{real} de {tot} realizadas</span><span style={{color:col,fontWeight:700}}>{tasa}%</span></div>
                  </div>
                  {esAdmin&&<button onClick={e=>{e.stopPropagation();deletePlan(plan._id);}} style={{background:tono("#2d1515", "#f4e8e8"),border:`1px solid ${C.red}`,color:C.red,padding:"5px 8px",borderRadius:8,fontSize:11,cursor:"pointer",fontFamily:mono,flexShrink:0}}><X size={14} /></button>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── VISTA CORRECTIVO (sin KML) ──
  const tareasT=planes.filter(p=>p.tipo==="corr");

  function crearTarea(){
    if(!formTarea.titulo.trim())return;
    addPlan({tipo:"corr",titulo:formTarea.titulo,descripcion:formTarea.descripcion,vehiculo:formTarea.vehiculo,estado:"pendiente",creadoPor:sesion.id});
    setFormTarea({titulo:"",descripcion:"",vehiculo:"",estado:"pendiente"});
    setShowNT(false);
  }

  return(
    <div style={{paddingBottom:80}}>
      <div style={{borderBottom:`1px solid ${C.border}`,padding:"12px 14px",display:"flex",alignItems:"center",gap:12}}>
        <button onClick={()=>setTipoActivo(null)} style={{...S.btnGhost,padding:"7px 10px",flexShrink:0}} title="Volver"><ChevronLeft size={18} style={{verticalAlign:"-4px"}}/></button>
        <div style={{width:36,height:36,borderRadius:12,background:`${tipo.color}1a`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><tipo.Icono size={18} color={tipo.color}/></div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:15,fontWeight:650,color:C.text,letterSpacing:"-0.01em"}}>{tipo.label}</div>
          <div style={{fontSize:13,color:C.muted}}>{tareasT.length} tareas · {tareasT.filter(t=>t.estado==="cerrada").length} cerradas</div>
        </div>
      </div>
      <div style={{padding:"12px 14px 0"}}>
        {/* Stats rápidas */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:12}}>
          {[
            {l:"Pendientes",v:tareasT.filter(t=>t.estado==="pendiente").length,c:C.red},
            {l:"En curso",v:tareasT.filter(t=>t.estado==="en curso").length,c:C.orange},
            {l:"Cerradas",v:tareasT.filter(t=>t.estado==="cerrada").length,c:C.green},
          ].map(s=><div key={s.l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px",textAlign:"center"}}><div style={{fontSize:20,fontWeight:800,color:s.c}}>{s.v}</div><div style={{fontSize:12,color:C.dim,textTransform:"none",letterSpacing:0}}>{s.l}</div></div>)}
        </div>

        {/* Nueva tarea */}
        <button onClick={()=>setShowNT(v=>!v)} className={showNuevaTarea?undefined:"op-btn op-primario"} style={showNuevaTarea?{...S.btnGhost,width:"100%",marginBottom:10,padding:"11px 14px",display:"flex",alignItems:"center",justifyContent:"center",gap:8}:{width:"100%",height:44,marginBottom:12,fontSize:15,borderRadius:12}}>
          {showNuevaTarea?<><X size={16}/> Cancelar</>:<><Plus size={17}/> Nueva tarea correctiva</>}
        </button>
        {showNuevaTarea&&(
          <div style={{...S.card,marginBottom:12}}>
            <div style={{marginBottom:12}}><label style={S.label}>Título *</label><input value={formTarea.titulo} onChange={e=>setFormTarea({...formTarea,titulo:e.target.value})} placeholder="Ej: Cambio de frenos VH-002" style={S.input}/></div>
            <div style={{marginBottom:12}}><label style={S.label}>Vehículo</label><select value={formTarea.vehiculo} onChange={e=>setFormTarea({...formTarea,vehiculo:e.target.value})} style={S.input}><option value="">— Sin vehículo —</option>{VEHICULOS.map(v=><option key={v} value={v}>{v}</option>)}</select></div>
            <div style={{marginBottom:14}}><label style={S.label}>Descripción</label><textarea value={formTarea.descripcion} onChange={e=>setFormTarea({...formTarea,descripcion:e.target.value})} placeholder="Describe el trabajo a realizar..." rows={3} style={{...S.input,resize:"none"}}/></div>
            <button onClick={crearTarea} style={{...S.btn,width:"100%",background:tipo.color+"22",borderColor:tipo.color,color:tipo.color}}>CREAR TAREA</button>
          </div>
        )}

        {tareasT.length===0&&!showNuevaTarea&&<div style={{textAlign:"center",padding:"40px 0"}}><div style={{marginBottom:12,color:C.dim}}><tipo.Icono size={36} strokeWidth={1.5}/></div><div style={{fontSize:15,color:C.dim}}>Sin tareas correctivas</div></div>}
        {/* Pendientes y en curso primero */}
        {tareasT.filter(t=>t.estado!=="cerrada").map(t=>(
          <TarjetaCorrectivo key={t._id||t.id} tarea={t} sesion={sesion} usuarios={usuarios}
            onUpdate={upd=>updatePlan(upd)}
            onDelete={()=>deletePlan(t._id)}/>
        ))}
        {tareasT.filter(t=>t.estado==="cerrada").length>0&&(
          <>
            <div style={{fontSize:12,color:C.green,letterSpacing:0,textTransform:"none",marginBottom:6,marginTop:10,paddingLeft:4}}>Cerradas ({tareasT.filter(t=>t.estado==="cerrada").length})</div>
            {tareasT.filter(t=>t.estado==="cerrada").map(t=>(
              <TarjetaCorrectivo key={t._id||t.id} tarea={t} sesion={sesion} usuarios={usuarios}
                onUpdate={upd=>updatePlan(upd)}
                onDelete={()=>deletePlan(t._id)}/>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function MiCuadrante({sesion,onBack}){
  const [docs,setDocs]=useState(null);
  const [sel,setSel]=useState(null);
  const [diaSel,setDiaSel]=useState(null);
  useEffect(()=>{
    if(!sesion?.org_id||!sesion?.uid) return;
    const q=query(collection(db,"cuadrantes"),where("org_id","==",sesion.org_id),where("uid","==",sesion.uid));
    return onSnapshot(q,snap=>{
      const list=snap.docs.map(d=>({...d.data(),_id:d.id})).sort((a,b)=>b.mes.localeCompare(a.mes));
      setDocs(list);
    },err=>{ console.error("cuadrantes",err); setDocs([]); });
  },[sesion?.org_id,sesion?.uid]);

  const hoyMes=new Date().toISOString().slice(0,7);
  const actual=docs&&(docs.find(d=>d.mes===sel)||docs.find(d=>d.mes===hoyMes)||docs[0]);

  const header=(
    <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px"}}>
      <button onClick={onBack} style={{...S.btnGhost,padding:"7px 10px"}} title="Volver"><ChevronLeft size={18} style={{verticalAlign:"-4px"}}/></button>
      <div style={{fontSize:15,fontWeight:650,letterSpacing:"-0.01em"}}>Mi cuadrante</div>
      {docs?.length>1&&(
        <select value={actual?.mes||""} onChange={e=>{setSel(e.target.value);setDiaSel(null);}}
          style={{marginLeft:"auto",background:C.surface2,border:`1px solid ${C.border}`,color:C.text,borderRadius:8,padding:"4px 8px",fontSize:12,fontFamily:font}}>
          {docs.map(d=><option key={d.mes} value={d.mes}>{MESES_ES[d.month-1]} {d.year}</option>)}
        </select>
      )}
    </div>
  );

  if(docs===null) return <div style={{paddingBottom:80}}>{header}<div style={{padding:20,color:C.dim,fontSize:13}}>Cargando…</div></div>;
  if(!actual) return <div style={{paddingBottom:80}}>{header}<div style={{padding:20,color:C.dim,fontSize:13}}>Todavía no te han publicado ningún cuadrante.</div><div style={{padding:"0 14px"}}><MisAusencias sesion={sesion}/></div></div>;

  const {year,month,dias={}}=actual;
  const nDias=new Date(year,month,0).getDate();
  const offset=(new Date(year,month-1,1).getDay()+6)%7; // lunes primero
  const celdas=[...Array(offset).fill(null),...Array.from({length:nDias},(_,i)=>i+1)];
  const hoy=new Date();
  const esHoy=d=>hoy.getFullYear()===year&&hoy.getMonth()+1===month&&hoy.getDate()===d;
  let horas=0; const cuenta={};
  for(const v of Object.values(dias)){
    cuenta[v.c]=(cuenta[v.c]||0)+1;
    if(v.s!=null&&v.e!=null) horas+=(v.e-v.s)/60; else if("MTN".includes(v.c)) horas+=8;
  }
  const det=diaSel?dias[String(diaSel)]:null;

  return(
    <div style={{paddingBottom:80}}>
      {header}
      <div style={{padding:"0 14px"}}>
        <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>{MESES_ES[month-1]} {year}</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
          {["L","M","X","J","V","S","D"].map(d=><div key={d} style={{fontSize:10,color:C.dim,textAlign:"center"}}>{d}</div>)}
          {celdas.map((d,i)=>{
            if(!d) return <div key={"e"+i}/>;
            const v=dias[String(d)]; const m=v?CUADRANTE_META[v.c]:null;
            return(
              <div key={d} onClick={()=>setDiaSel(d)} style={{
                borderRadius:8,padding:"5px 2px",textAlign:"center",cursor:"pointer",minHeight:46,
                background:m?m.bg:C.surface2,
                border:`${esHoy(d)?2:1}px solid ${diaSel===d?"#fff":esHoy(d)?C.blue:C.border}`,
              }}>
                <div style={{fontSize:10,color:C.dim}}>{d}</div>
                <div style={{fontSize:15,fontWeight:700,color:m?m.text:C.dim}}>{v?.c||"·"}</div>
              </div>
            );
          })}
        </div>

        {det?(
          <div style={{...S.card,marginTop:12}}>
            <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>Día {diaSel} · {CUADRANTE_META[det.c]?.label||det.c}</div>
            {det.v&&<div style={{fontSize:12,color:C.muted}}>Vehículo: <b style={{color:C.text}}>{det.v}</b></div>}
            {det.s!=null&&<div style={{fontSize:12,color:C.muted}}>Horario: <b style={{color:C.text}}>{hhmm(det.s)} – {hhmm(det.e)}</b></div>}
          </div>
        ):diaSel?(
          <div style={{...S.card,marginTop:12,fontSize:12,color:C.dim}}>Día {diaSel}: sin turno asignado.</div>
        ):null}

        <div style={{...S.card,marginTop:12,display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"}}>
          <div style={{fontSize:13,fontWeight:700}}>{Math.round(horas)}h</div>
          {Object.entries(cuenta).map(([c,n])=>(
            <div key={c} style={{fontSize:11,color:CUADRANTE_META[c]?.text||C.muted}}>{CUADRANTE_META[c]?.label||c}: {n}</div>
          ))}
        </div>
        {actual.publicadoEn&&<div style={{fontSize:10,color:C.dim,marginTop:8}}>Publicado {new Date(actual.publicadoEn).toLocaleString()}</div>}
        <MisAusencias sesion={sesion}/>
      </div>
    </div>
  );
}

export function ListaPlanes({planes,addPlan,updatePlan,deletePlan,sesion,usuarios}){
  return <ModuloRutas planes={planes} addPlan={addPlan} updatePlan={updatePlan} deletePlan={deletePlan} sesion={sesion} usuarios={usuarios}/>;
}
