// App del conductor (Rutas, Incidencias, Inventario, Admin): datos, colores,
// estilos y utilidades que comparten todas sus pantallas.
import { CarFront, CircleDot, Droplets, Hammer, MapPin, Megaphone, Settings2, Sparkles, Wrench } from "lucide-react";
import { useState, useEffect } from "react";
import { db } from "../firebase.js";
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, query, where, orderBy, limit } from "firebase/firestore";





export const VEHICULOS = ["VH-001 · Furgoneta Iveco","VH-002 · Camión MAN","VH-003 · Furgón Mercedes","VH-004 · Pickup Ford","VH-005 · Renault Master"];

export const CATS = [
  {label:"Avería mecánica",color:"#f26d6d",icon:"🔧",Icono:Wrench},
  {label:"Accidente / Golpe",color:"#f59e5b",icon:"⚠️",Icono:CarFront},
  {label:"Neumáticos",color:"#f5b84a",icon:"⚙️",Icono:CircleDot},
  {label:"Mantenimiento",color:"#5b7cfa",icon:"🛠️",Icono:Settings2},
  {label:"Comunicado general",color:"#a78bfa",icon:"📢",Icono:Megaphone},
];

export const PC = {alta:"#f26d6d",media:"#f59e5b",baja:"#3fcf8e"};

// Haversine distance in km — usado para detectar si el conductor se ha
// movido de verdad entre dos lecturas de GPS (no solo ruido del sensor).
export function haversineKm(lat1,lng1,lat2,lng2){
  if(lat1==null||lng1==null||lat2==null||lng2==null) return 0;
  const R=6371, toRad=x=>x*Math.PI/180;
  const dLat=toRad(lat2-lat1), dLng=toRad(lng2-lng1);
  const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

// ── FIREBASE HELPERS ──────────────────────────────────────────────
const SIN_DATOS = [];
export function useCollection(colName, orderField = "fecha", orgId = null, superAdmin = false, limitN = null) {
  // lo recibido va con la consulta de la que viene: al cambiar de consulta no se
  // enseña lo de la anterior (y sin empresa no se pide nada)
  const activo = !!(orgId || superAdmin);
  const clave = `${colName}|${orderField}|${orgId}|${superAdmin}|${limitN}`;
  const [estado, setEstado] = useState({ clave: null, data: SIN_DATOS });
  useEffect(() => {
    if (!activo) return;
    // fechaSubida/fecha son número (Date.now()) o Timestamp de servidor
    // siempre presentes desde la creación del doc, así que orderBy no
    // deja fuera documentos antiguos por falta del campo.
    const clauses = [
      ...(orgId ? [where("org_id", "==", orgId)] : []),
      ...(limitN ? [orderBy(orderField, "desc"), limit(limitN)] : []),
    ];
    const q = clauses.length ? query(collection(db, colName), ...clauses) : collection(db, colName);
    const unsub = onSnapshot(q, snap => {
      const docs = snap.docs
        .map(d => ({ ...d.data(), _id: d.id }))
        .sort((a, b) => {
          const av = a[orderField], bv = b[orderField];
          if (!av && !bv) return 0; if (!av) return 1; if (!bv) return -1;
          const am = av?.toMillis ? av.toMillis() : (typeof av === "number" ? av : 0);
          const bm = bv?.toMillis ? bv.toMillis() : (typeof bv === "number" ? bv : 0);
          return bm - am;
        });
      setEstado({ clave, data: docs });
    }, err => { console.error(colName, err); setEstado(e => ({ clave, data: e.clave === clave ? e.data : SIN_DATOS })); });
    return () => unsub();
  }, [activo, clave, colName, orderField, orgId, limitN]);
  if (!activo) return { data: SIN_DATOS, loading: false };
  return estado.clave === clave ? { data: estado.data, loading: false } : { data: SIN_DATOS, loading: true };
}

export const nuevoComentario = (usuarioId, texto) => ({ usuarioId, texto, fecha: Date.now() });

export async function fbAdd(colName, data) {
  return await addDoc(collection(db, colName), { ...data, fecha: serverTimestamp() });
}

export async function fbUpdate(colName, id, data) {
  return await updateDoc(doc(db, colName, id), data);
}

export async function fbDelete(colName, id) {
  return await deleteDoc(doc(db, colName, id));
}

// ── BARRIO COLOR (misma paleta que scheduling) ────────────────────
const BARRIO_PALETTE = [
  "#5b7cfa","#3fcf8e","#f59e5b","#f26d6d",
  "#a78bfa","#f5b84a","#f472b6","#22d3ee","#818cf8","#4ade80",
];

const _barrioCache = {};

export function barrioColor(b) {
  if (!b) return "#9aa3b2";
  if (_barrioCache[b]) return _barrioCache[b];
  let h = 0;
  for (let i = 0; i < b.length; i++) h = (h * 31 + b.charCodeAt(i)) >>> 0;
  return (_barrioCache[b] = BARRIO_PALETTE[h % BARRIO_PALETTE.length]);
}

// ── DESIGN SYSTEM ─────────────────────────────────────────────────

const FONTS = `

*, *::before, *::after { box-sizing: border-box; -webkit-font-smoothing: antialiased; }

:root {
  --bg:       #0b0d12;
  --surface:  #12151c;
  --surface2: #181c25;
  --border:   rgba(255,255,255,0.08);
  --border2:  rgba(255,255,255,0.14);
  --blue:     #5b7cfa;
  --blueDim:  #1a2142;
  --blueText: #b4c3ff;
  --cyan:     #5b7cfa;
  --cyanDim:  #1a2142;
  --cyanText: #b4c3ff;
  --green:    #3fcf8e;
  --greenDim: #0f2a1f;
  --orange:   #f59e5b;
  --red:      #f26d6d;
  --amber:    #f5b84a;
  --text:     #e6e8ee;
  --muted:    #9aa3b2;
  --dim:      #5d6574;
  --font:     'Inter Variable', 'Inter', system-ui, sans-serif;
  --mono:     var(--font);
  --radius:   8px;
  --shadow:   0 2px 16px rgba(0,0,0,.4);
}

body { background: var(--bg); color: var(--text); font-family: var(--font); margin: 0; }

::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: var(--surface); }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }

@keyframes fadeUp   { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
@keyframes fadeIn   { from { opacity:0; } to { opacity:1; } }
@keyframes slideIn  { from { opacity:0; transform:translateX(-8px); } to { opacity:1; transform:translateX(0); } }
@keyframes pulse2   { 0%,100% { opacity:.4; transform:scale(.9); } 50% { opacity:1; transform:scale(1.1); } }
@keyframes shimmer  { 0% { background-position:-200% 0; } 100% { background-position:200% 0; } }

.fade-up   { animation: fadeUp .2s ease both; }
.fade-in   { animation: fadeIn .18s ease both; }
.slide-in  { animation: slideIn .18s ease both; }

button { transition: all .12s ease; }
button:active { transform: scale(.97); }
`;

// Inyectar estilos globales
if (typeof document !== 'undefined' && !document.getElementById('fc-styles')) {
  const style = document.createElement('style');
  style.id = 'fc-styles';
  style.textContent = FONTS;
  document.head.appendChild(style);
}

export const mono = "var(--mono)";

export const font = "var(--font)";

export const C = {
  bg:"#0b0d12", card:"#12151c", surface2:"#181c25",
  border:"rgba(255,255,255,0.08)", border2:"rgba(255,255,255,0.14)",
  cyan:"#5b7cfa", cyanDim:"#1a2142", cyanText:"#b4c3ff",
  green:"#3fcf8e", greenDim:"#0f2a1f",
  orange:"#f59e5b", red:"#f26d6d", amber:"#f5b84a",
  text:"#e6e8ee", muted:"#9aa3b2", dim:"#5d6574",
  blue:"#5b7cfa", blueDim:"#1a2142", blueText:"#b4c3ff",
};

export const S = {
  page:   {fontFamily:font, background:C.bg, minHeight:"100vh", width:"100%", maxWidth:520, margin:"0 auto", color:C.text},
  input:  {width:"100%", background:"#0d0f14", border:"1px solid rgba(255,255,255,0.1)", color:C.text, padding:"10px 13px", borderRadius:10, fontSize:14, boxSizing:"border-box", fontFamily:font, outline:"none", transition:"border-color .15s"},
  label:  {fontSize:12.5, color:"#c9ced8", display:"block", marginBottom:6, fontFamily:font, fontWeight:500},
  btn:    {background:C.blueDim, border:`1px solid ${C.blue}44`, color:C.blueText, padding:"10px 18px", borderRadius:7, fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:font, transition:"all .15s"},
  btnGhost:{background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.1)", color:"#c9ced8", padding:"8px 14px", borderRadius:10, fontSize:13, fontWeight:500, cursor:"pointer", fontFamily:font, transition:"all .15s"},
  btnSm:  {background:"rgba(91,124,250,0.16)", border:"1px solid rgba(91,124,250,0.4)", color:"#d6deff", padding:"8px 14px", borderRadius:10, fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:font, transition:"all .15s"},
  btnOk:  {background:"rgba(63,207,142,0.12)", border:"1px solid rgba(63,207,142,0.35)", color:C.green, padding:"8px 14px", borderRadius:10, fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:font, transition:"all .15s"},
  card:   {background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:"14px 16px", marginBottom:10, boxShadow:"0 1px 2px rgba(0,0,0,.3)"},
  header: {background:"rgba(11,13,18,0.86)", borderBottom:`1px solid ${C.border}`, padding:"12px 20px", position:"sticky", top:0, zIndex:100, display:"flex", alignItems:"center", justifyContent:"space-between", backdropFilter:"blur(16px)"},
};

// ── HELPERS ───────────────────────────────────────────────────────
export function timeAgo(ts){const d=(Date.now()-(ts?.toMillis?.()??ts))/1000;if(d<60)return"Ahora mismo";if(d<3600)return`Hace ${Math.floor(d/60)}min`;if(d<86400)return`Hace ${Math.floor(d/3600)}h`;return`Hace ${Math.floor(d/86400)}d`;}

export function avatarOf(u){return((u?.nombre?.[0]??"")+(u?.apellidos?.[0]??"")).toUpperCase();}

export function fmtMes(k){try{return new Date(k+"-01").toLocaleDateString("es-ES",{month:"long",year:"numeric"});}catch{return k;}}

// Limpiar nombre de calle: "1-PONCIR-2" → "PONCIR", "2-MARE DE DEU-12" → "MARE DE DEU"
export function cleanCalle(raw) {
  if (!raw || raw === "Sin calle") return raw;
  // Quitar número inicial: "1-" o "12-"
  let c = raw.replace(/^\d+-/, "");
  // Quitar número final: "-2" o "-12"
  c = c.replace(/-\d+$/, "");
  return c.trim() || raw;
}

// ── KML PARSER ────────────────────────────────────────────────────
export function parseKML(rawText) {
  const ubicaciones = {};
  let recorrido = null;
  let docName = "";
  const debug = [];

  try {
    const text = rawText.charCodeAt(0) === 0xFEFF ? rawText.slice(1) : rawText;
    debug.push("Tamaño: " + text.length + " chars");

    const dn = text.indexOf("<name>"), de = text.indexOf("</name>");
    if (dn !== -1 && de > dn) docName = text.slice(dn+6, de).trim();

    // Contar placemarks
    let pmTotal = 0;
    let pp = 0;
    while(true){const i=text.indexOf("<Placemark>",pp);if(i===-1)break;pmTotal++;pp=i+1;}
    debug.push("Placemarks: " + pmTotal);

    // Helper getVal usando charCode para evitar problemas de escape en JSX
    function getVal(block, fieldName) {
      const q = String.fromCharCode(34);
      const needle = "name=" + q + fieldName + q + "><value>";
      const si = block.indexOf(needle);
      if (si === -1) return "";
      const after = block.slice(si + needle.length);
      const ei = after.indexOf("</value>");
      return ei === -1 ? "" : after.slice(0, ei).trim();
    }

    let pos = 0, processed = 0;
    while(true) {
      const pStart = text.indexOf("<Placemark>", pos);
      if (pStart === -1) break;
      const pEnd = text.indexOf("</Placemark>", pStart);
      if (pEnd === -1) break;
      const block = text.slice(pStart, pEnd+12);
      pos = pEnd+12;
      processed++;

      // LineString
      if (block.indexOf("<LineString>") !== -1) {
        const cs=block.indexOf("<coordinates>"),ce=block.indexOf("</coordinates>");
        if(cs!==-1&&ce>cs){
          const coords=[];
          block.slice(cs+13,ce).trim().split(/\s+/).forEach(pair=>{
            const p=pair.split(",");
            if(p.length>=2){const lng=parseFloat(p[0]),lat=parseFloat(p[1]);if(!isNaN(lat)&&!isNaN(lng))coords.push([lat,lng]);}
          });
          if(coords.length>1)recorrido=coords;
        }
        continue;
      }

      // Point coords
      const cs=block.indexOf("<coordinates>"),ce=block.indexOf("</coordinates>");
      if(cs===-1||ce===-1)continue;
      const cparts=block.slice(cs+13,ce).trim().split(",");
      if(cparts.length<2)continue;
      const lng=parseFloat(cparts[0]),lat=parseFloat(cparts[1]);
      if(isNaN(lat)||isNaN(lng))continue;

      // Fields — usar unicode escape para caracteres especiales
      const pa        = getVal(block,"Ubicaci\u00f3 T\u00e8cnica") || ("PA_"+processed);
      const orden     = getVal(block,"Orden")     || "0";
      const codiQR    = getVal(block,"Codi QR");
      const calleRaw  = getVal(block,"Calle")     || "Sin calle";
      const calle     = cleanCalle(calleRaw);
      const num       = getVal(block,"Num.")      || "";
      const barri     = getVal(block,"Barri")     || "";
      const districte = getVal(block,"Districte").trim();
      const model     = getVal(block,"Model")     || "";
      const turno     = getVal(block,"Turno")     || "";
      const dia       = getVal(block,"D\u00eda")  || "";
      const comentari = getVal(block,"Comentari") || "";

      const key = pa;
      if (!ubicaciones[key]) {
        ubicaciones[key] = {
          id:"u"+Object.keys(ubicaciones).length,
          pa, orden:parseInt(orden,10)||0,
          calle, num, comentari, barri, districte, turno, dia,
          lat, lng, elementos:[],
          realizado:false,realizadoPor:null,realizadoEn:null,nota:"",
        };
      }
      if (codiQR && codiQR !== "nan") {
        if (!ubicaciones[key].elementos.find(e=>e.codiQR===codiQR)) {
          ubicaciones[key].elementos.push({codiQR,model,realizado:false});
        }
      }
    }

    debug.push("Procesados: " + processed);
    debug.push("Ubicaciones: " + Object.keys(ubicaciones).length);
    if (Object.keys(ubicaciones).length > 0) {
      const f = Object.values(ubicaciones)[0];
      debug.push("Ejemplo: " + f.calle + " " + f.num + " (" + f.pa + ")");
    }
  } catch(err) {
    debug.push("ERROR: " + err.message);
  }

  const lista = Object.values(ubicaciones).sort((a,b)=>a.orden-b.orden);
  return {ubicaciones:lista,recorrido,docName,debug};
}

// ── PARTE DE INSPECCIÓN ───────────────────────────────────────────
export const PUNTOS_INSPECCION = [
  { grupo:"Conjunto pedal", puntos:[
    "Accionar el pedal y comprobar la distancia de apertura de la tapa",
    "Comprobar que el pedal no ha sufrido golpes o deformaciones",
    "Ajuste con la rosca existente al final de la varilla",
  ]},
  { grupo:"Patines y tapón de fondo", puntos:[
    "Verificar la existencia de rodillos y gomas de agarre",
    "Revisión del tapón de fondo",
  ]},
  { grupo:"Conjunto palanca", puntos:[
    "Comprobar el estado de la tapa de la palanca",
    "Estado de la U exterior",
    "Accionar la palanca y comprobar si funciona correctamente",
  ]},
  { grupo:"Conjunto tapas", puntos:[
    "Revisión del estado de las tapas y componentes",
    "Sustitución de elementos",
    "Revisión del sistema de retención de la tapa de usuario",
    "Comprobar el estado del embellecedor y la tapa embellecedor",
    "Comprobar el estado de las bocas de selectiva",
  ]},
  { grupo:"Conjunto amortiguador", puntos:[
    "Accionar el pedal y comprobar que la tapa baja con retención",
    "Comprobar la existencia de amortiguador",
    "Cambiar el amortiguador si es necesario",
  ]},
  { grupo:"Goma frontal de la tapa usuario", puntos:[
    "Comprobar el estado de la goma y cambiarla en caso de deterioro",
  ]},
  { grupo:"Cerraduras electrónicas", puntos:[
    "Verificar el funcionamiento de las cerraduras electrónicas",
    "Limpieza boca usuario",
    "Cerradura electrónica, batería, sistema de identificación u otros",
    "Reposición de baterías",
  ]},
  { grupo:"Cerraduras laterales tapa de descarga", puntos:[
    "Verificar que la tapa de descarga no abre en posición de reposo",
    "Ajustar la cerradura o bulón de la tapa en caso necesario",
  ]},
  { grupo:"Bulones, anclajes y horquillas", puntos:[
    "Revisión de bulones, anclajes y horquillas",
    "Sustitución de bulones y anclajes",
  ]},
  { grupo:"Sistema Vacri", puntos:[
    "Mantenimiento preventivo del sistema Vacri",
  ]},
  { grupo:"Grafitis, adhesivos y serigrafías", puntos:[
    "Eliminar grafitis y adhesivos",
    "Revisión códigos QR y pictogramas braille",
    "Sustitución de códigos QR y pictogramas braille",
    "Revisar y sustituir adhesivos o señales que se encuentren en mal estado",
  ]},
  { grupo:"Otras", puntos:[
    "Recolocación del contenedor",
  ]},
];

// ── TIPOS DE TRABAJO ──────────────────────────────────────────────
export const TIPOS_TRABAJO = [
  // genérico: recogida, reparto, revisiones… (el nombre del trabajo lo pone quien publica)
  { key:"ruta",   label:"Ruta de servicio",          icon:"📍", Icono:MapPin,   color:"#22b8cf", kml:true  },
  { key:"prev",   label:"Mantenimiento Preventivo", icon:"🛠️", Icono:Wrench,   color:"#5b7cfa", kml:true  },
  { key:"corr",   label:"Mantenimiento Correctivo", icon:"🔩", Icono:Hammer,   color:"#f59e5b", kml:false },
  { key:"ext",    label:"Limpieza Exterior",         icon:"🚿", Icono:Droplets, color:"#3fcf8e", kml:true  },
  { key:"int",    label:"Limpieza Interior",          icon:"🧹", Icono:Sparkles, color:"#a78bfa", kml:true  },
];

// ── FICHAJE (entrada/salida + kms de la jornada) ────────────────────
export function fmtHora(ts){ return ts ? new Date(ts).toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"}) : "—"; }

export function fmtDuracion(desde, hasta){
  const ms = (hasta ?? Date.now()) - desde;
  const h = Math.floor(ms/3600000), m = Math.floor((ms%3600000)/60000);
  return `${h}h ${String(m).padStart(2,"0")}min`;
}

// ── LISTA PLANES (alias para compatibilidad) ───────────────────────
// ── MI CUADRANTE (Rutas) ───────────────────────────────────────────
// El cuadrante del mes que Rostering le publica a cada trabajador
// (colección cuadrantes, un doc por usuario y mes: solo lo leen él y los
// gestores).
export const CUADRANTE_META={
  M:{label:"Mañana",bg:"#0d2248",text:"#5b7cfa"},
  T:{label:"Tarde",bg:"#3d1a00",text:"#f59e5b"},
  N:{label:"Noche",bg:"#1a0d3d",text:"#a78bfa"},
  L:{label:"Libre",bg:"#1a1f2a",text:"#64748b"},
  G:{label:"Guardia",bg:"#2d2200",text:"#f5b84a"},
  B:{label:"Baja",bg:"#3d0d0d",text:"#f26d6d"},
  D:{label:"Disponible",bg:"#0f2a1f",text:"#3fcf8e"},
};

export const MESES_ES=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

export const hhmm=m=>{ if(m==null) return ""; const x=((m%1440)+1440)%1440; return `${String(Math.floor(x/60)).padStart(2,"0")}:${String(x%60).padStart(2,"0")}`; };

// ── INVENTARIO ────────────────────────────────────────────────────
export const CATS_INV = ["Filtros","Frenos","Neumáticos","Motor","Eléctrico","Carrocería","Fluidos","Otros"];
