// App del conductor (Rutas, Incidencias, Inventario, Admin): datos, colores,
// estilos y utilidades que comparten todas sus pantallas.
import { CarFront, CircleDot, Droplets, Hammer, MapPin, Megaphone, Settings2, Sparkles, Wrench } from "lucide-react";
import { useState, useEffect } from "react";
import { db } from "../firebase.js";
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, query, where, orderBy, limit } from "firebase/firestore";
import { C, alfa } from "../tema.js";
import { tono } from "../tema.js";





export const VEHICULOS = ["VH-001 · Furgoneta Iveco","VH-002 · Camión MAN","VH-003 · Furgón Mercedes","VH-004 · Pickup Ford","VH-005 · Renault Master"];

export const CATS = [
  {label:"Avería mecánica",color:C.red,icon:"🔧",Icono:Wrench},
  {label:"Accidente / Golpe",color:C.orange,icon:"⚠️",Icono:CarFront},
  {label:"Neumáticos",color:C.amber,icon:"⚙️",Icono:CircleDot},
  {label:"Mantenimiento",color:C.blue,icon:"🛠️",Icono:Settings2},
  {label:"Comunicado general",color:C.violet,icon:"📢",Icono:Megaphone},
];

export const PC = {alta:C.red,media:C.orange,baja:C.green};

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

// Firestore rechaza los campos «undefined» y las listas dentro de listas:
// los vacíos se quitan y una lista dentro de otra pasa a objeto ({0:…,1:…})
export function paraFirestore(v) {
  if (Array.isArray(v)) return v.map(x => (Array.isArray(x) ? Object.fromEntries(x.map((y, i) => [i, paraFirestore(y)])) : paraFirestore(x)));
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, paraFirestore(x)]));
  }
  return v;
}

export async function fbAdd(colName, data) {
  return await addDoc(collection(db, colName), { ...paraFirestore(data), fecha: serverTimestamp() });
}

export async function fbUpdate(colName, id, data) {
  return await updateDoc(doc(db, colName, id), data);
}

export async function fbDelete(colName, id) {
  return await deleteDoc(doc(db, colName, id));
}

// ── BARRIO COLOR (misma paleta que scheduling) ────────────────────
const BARRIO_PALETTE = [
  C.blue,C.green,C.orange,C.red,
  C.violet,C.amber,"#f472b6","#22d3ee","#818cf8","#4ade80",
];

const _barrioCache = {};

export function barrioColor(b) {
  if (!b) return C.muted;
  if (_barrioCache[b]) return _barrioCache[b];
  let h = 0;
  for (let i = 0; i < b.length; i++) h = (h * 31 + b.charCodeAt(i)) >>> 0;
  return (_barrioCache[b] = BARRIO_PALETTE[h % BARRIO_PALETTE.length]);
}

// ── DESIGN SYSTEM ─────────────────────────────────────────────────

const FONTS = `

*, *::before, *::after { box-sizing: border-box; -webkit-font-smoothing: antialiased; }

:root {
  --bg:       ${C.bg};
  --surface:  ${C.card};
  --surface2: ${C.surface2};
  --border:   ${alfa(0.08)};
  --border2:  ${alfa(0.14)};
  --blue:     ${C.blue};
  --blueDim:  ${C.blueDim};
  --blueText: ${C.blueText};
  --cyan:     ${C.blue};
  --cyanDim:  ${C.blueDim};
  --cyanText: ${C.blueText};
  --green:    ${C.green};
  --greenDim: ${C.greenDim};
  --orange:   ${C.orange};
  --red:      ${C.red};
  --amber:    ${C.amber};
  --text:     ${C.text};
  --muted:    ${C.muted};
  --dim:      ${C.dim};
  --font:     'Inter Variable', 'Inter', system-ui, sans-serif;
  --mono:     var(--font);
  --radius:   8px;
  --shadow:   0 2px 16px rgba(0,0,0,.4);
}

body { background: var(--bg); color: var(--text); font-family: var(--font); margin: 0; }

::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: var(--surface); }
::-webkit-scrollbar-thumb { background: ${alfa(0.15)}; border-radius: 2px; }

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

export { C };

export const S = {
  page:   {fontFamily:font, background:C.bg, minHeight:"100vh", width:"100%", maxWidth:520, margin:"0 auto", color:C.text},
  input:  {width:"100%", background:C.input, border:`1px solid ${alfa(0.1)}`, color:C.text, padding:"10px 13px", borderRadius:12, fontSize:15, boxSizing:"border-box", fontFamily:font, outline:"none", transition:"border-color .15s"},
  label:  {fontSize:13, color:C.text, display:"block", marginBottom:6, fontFamily:font, fontWeight:500},
  btn:    {background:C.blueDim, border:`1px solid ${C.blue}44`, color:C.blueText, padding:"10px 18px", borderRadius:8, fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:font, transition:"all .15s"},
  btnGhost:{background:alfa(0.03), border:`1px solid ${alfa(0.1)}`, color:C.text, padding:"8px 14px", borderRadius:12, fontSize:13, fontWeight:500, cursor:"pointer", fontFamily:font, transition:"all .15s"},
  btnSm:  {background:"rgba(91,124,250,0.16)", border:"1px solid rgba(91,124,250,0.4)", color:"#d6deff", padding:"8px 14px", borderRadius:12, fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:font, transition:"all .15s"},
  btnOk:  {background:"rgba(63,207,142,0.12)", border:"1px solid rgba(63,207,142,0.35)", color:C.green, padding:"8px 14px", borderRadius:12, fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:font, transition:"all .15s"},
  card:   {background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:"14px 16px", marginBottom:10, boxShadow:"0 1px 2px rgba(0,0,0,.3)"},
  header: {background:tono("rgba(11,13,18,0.86)", "rgba(255,255,255,0.86)"), borderBottom:`1px solid ${C.border}`, padding:"12px 20px", position:"sticky", top:0, zIndex:100, display:"flex", alignItems:"center", justifyContent:"space-between", backdropFilter:"blur(16px)"},
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
/** El recorrido de un KML ([[lat, lng], …]) como se guarda: Firestore no admite listas dentro de listas */
export const recorridoParaGuardar = r => (Array.isArray(r) && r.length > 1 ? r.map(p => (Array.isArray(p) ? { lat: p[0], lng: p[1] } : p)) : null);

// Texto de un KML: sin CDATA y con las entidades (&amp; …) traducidas
function limpiarXml(t) {
  return String(t || "").replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
}

export function parseKML(rawText) {
  const ubicaciones = {};
  let recorrido = null;
  let docName = "";
  const debug = [];

  try {
    const text = rawText.charCodeAt(0) === 0xFEFF ? rawText.slice(1) : rawText;
    debug.push("Tamaño: " + text.length + " chars");

    const dn = text.indexOf("<name>"), de = text.indexOf("</name>");
    if (dn !== -1 && de > dn) docName = limpiarXml(text.slice(dn+6, de).trim());

    // Cada <Placemark …>, con o sin atributos (Google My Maps, Google Earth, QGIS…)
    const bloques = [...text.matchAll(/<Placemark\b[^>]*>[\s\S]*?<\/Placemark>/g)].map(m => m[0]);
    debug.push("Placemarks: " + bloques.length);

    // Un campo de ExtendedData: <Data name="X"><value>…</value></Data> o
    // <SimpleData name="X">…</SimpleData>, con espacios o saltos de línea entre medias
    function getVal(block, fieldName) {
      const nombre = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const m = block.match(new RegExp("<(?:Data|SimpleData)\\s+name\\s*=\\s*[\"']" + nombre + "[\"'][^>]*>\\s*(?:<displayName>[\\s\\S]*?</displayName>\\s*)?(?:<value>([\\s\\S]*?)</value>|([^<]*))", "i"));
      if (!m) return "";
      return limpiarXml((m[1] ?? m[2] ?? "").trim());
    }
    const nombreDe = block => { const m = block.match(/<name>([\s\S]*?)<\/name>/); return m ? limpiarXml(m[1].trim()) : ""; };

    let processed = 0;
    for (const block of bloques) {
      processed++;

      // LineString: el recorrido
      if (block.indexOf("<LineString") !== -1) {
        const cm = block.match(/<coordinates[^>]*>([\s\S]*?)<\/coordinates>/);
        if (cm) {
          const coords = [];
          cm[1].trim().split(/\s+/).forEach(pair => {
            const q = pair.split(",");
            if (q.length >= 2) { const lng = parseFloat(q[0]), lat = parseFloat(q[1]); if (!isNaN(lat) && !isNaN(lng)) coords.push([lat, lng]); }
          });
          if (coords.length > 1) recorrido = coords;
        }
        continue;
      }
      if (block.indexOf("<Polygon") !== -1 && block.indexOf("<Point") === -1) continue; // zonas, no paradas

      // Point coords
      const cm = block.match(/<coordinates[^>]*>([\s\S]*?)<\/coordinates>/);
      if (!cm) continue;
      const cparts = cm[1].trim().split(/\s+/)[0].split(",");
      if (cparts.length < 2) continue;
      const lng = parseFloat(cparts[0]), lat = parseFloat(cparts[1]);
      if (isNaN(lat) || isNaN(lng)) continue;

      // Fields — usar unicode escape para caracteres especiales
      const pa        = getVal(block,"Ubicaci\u00f3 T\u00e8cnica") || ("PA_"+processed);
      const orden     = getVal(block,"Orden")     || String(processed);
      const codiQR    = getVal(block,"Codi QR");
      // sin campo «Calle», el nombre del punto (KML de Google Maps y similares)
      const calleRaw  = getVal(block,"Calle")     || nombreDe(block) || "Sin calle";
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
  { key:"prev",   label:"Mantenimiento Preventivo", icon:"🛠️", Icono:Wrench,   color:C.blue, kml:true  },
  { key:"corr",   label:"Mantenimiento Correctivo", icon:"🔩", Icono:Hammer,   color:C.orange, kml:false },
  { key:"ext",    label:"Limpieza Exterior",         icon:"🚿", Icono:Droplets, color:C.green, kml:true  },
  { key:"int",    label:"Limpieza Interior",          icon:"🧹", Icono:Sparkles, color:C.violet, kml:true  },
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
  M:{label:"Mañana",bg:tono("#0d2248", "#e4ecf8"),text:C.blue},
  T:{label:"Tarde",bg:tono("#3d1a00", "#f8ede4"),text:C.orange},
  N:{label:"Noche",bg:tono("#1a0d3d", "#eae4f8"),text:C.violet},
  L:{label:"Libre",bg:tono("#1a1f2a", "#ebedf2"),text:C.dim},
  G:{label:"Guardia",bg:tono("#2d2200", "#f8f4e4"),text:C.amber},
  B:{label:"Baja",bg:tono("#3d0d0d", "#f8e4e4"),text:C.red},
  D:{label:"Disponible",bg:C.greenDim,text:C.green},
};

export const MESES_ES=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

export const hhmm=m=>{ if(m==null) return ""; const x=((m%1440)+1440)%1440; return `${String(Math.floor(x/60)).padStart(2,"0")}:${String(x%60).padStart(2,"0")}`; };

// ── INVENTARIO ────────────────────────────────────────────────────
export const CATS_INV = ["Filtros","Frenos","Neumáticos","Motor","Eléctrico","Carrocería","Fluidos","Otros"];
