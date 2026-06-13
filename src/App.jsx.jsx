import { useState, useRef, useEffect, useCallback } from "react";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { db, auth, secondaryAuth } from "./firebase.js";
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, query, where, setDoc, getDoc,
} from "firebase/firestore";
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
  createUserWithEmailAndPassword,
} from "firebase/auth";
const VEHICULOS = ["VH-001 · Furgoneta Iveco","VH-002 · Camión MAN","VH-003 · Furgón Mercedes","VH-004 · Pickup Ford","VH-005 · Renault Master"];
const CATS = [
  {label:"Avería mecánica",color:"#ef4444",icon:"🔧"},
  {label:"Accidente / Golpe",color:"#f97316",icon:"⚠️"},
  {label:"Neumáticos",color:"#eab308",icon:"⚙️"},
  {label:"Mantenimiento",color:"#3b82f6",icon:"🛠️"},
  {label:"Comunicado general",color:"#8b5cf6",icon:"📢"},
];
const PC = {alta:"#f87171",media:"#fb923c",baja:"#34d399"};

// ── FIREBASE HELPERS ──────────────────────────────────────────────
function useCollection(colName, orderField = "fecha", orgId = null) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!orgId) { setData([]); setLoading(false); return; }
    const q = query(collection(db, colName), where("org_id", "==", orgId));
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
      setData(docs); setLoading(false);
    }, err => { console.error(colName, err); setLoading(false); });
    return () => unsub();
  }, [colName, orgId]);
  return { data, loading };
}

async function fbAdd(colName, data) {
  return await addDoc(collection(db, colName), { ...data, fecha: serverTimestamp() });
}
async function fbSet(colName, id, data) {
  return await setDoc(doc(db, colName, id), data, { merge: true });
}
async function fbUpdate(colName, id, data) {
  return await updateDoc(doc(db, colName, id), data);
}
async function fbDelete(colName, id) {
  return await deleteDoc(doc(db, colName, id));
}

// ── BARRIO COLOR (misma paleta que scheduling) ────────────────────
const BARRIO_PALETTE = [
  "#4f8ef7","#34d399","#fb923c","#f87171",
  "#a78bfa","#fbbf24","#f472b6","#22d3ee","#818cf8","#4ade80",
];
const _barrioCache = {};
function barrioColor(b) {
  if (!b) return "#8b95a5";
  if (_barrioCache[b]) return _barrioCache[b];
  let h = 0;
  for (let i = 0; i < b.length; i++) h = (h * 31 + b.charCodeAt(i)) >>> 0;
  return (_barrioCache[b] = BARRIO_PALETTE[h % BARRIO_PALETTE.length]);
}

// ── DESIGN SYSTEM ─────────────────────────────────────────────────

const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap');

*, *::before, *::after { box-sizing: border-box; -webkit-font-smoothing: antialiased; }

:root {
  --bg:       #0f1117;
  --surface:  #161b27;
  --surface2: #1c2333;
  --border:   rgba(255,255,255,0.08);
  --border2:  rgba(255,255,255,0.13);
  --blue:     #4f8ef7;
  --blueDim:  #0d2248;
  --blueText: #a3c4fc;
  --cyan:     #4f8ef7;
  --cyanDim:  #0d2248;
  --cyanText: #a3c4fc;
  --green:    #34d399;
  --greenDim: #072015;
  --orange:   #fb923c;
  --red:      #f87171;
  --amber:    #fbbf24;
  --text:     #f0f4f8;
  --muted:    #8b95a5;
  --dim:      #3d4d63;
  --font:     'Inter', system-ui, sans-serif;
  --mono:     'JetBrains Mono', 'Courier New', monospace;
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

const mono = "var(--mono)";
const font = "var(--font)";

const C = {
  bg:"#0f1117", card:"#161b27", surface2:"#1c2333",
  border:"rgba(255,255,255,0.08)", border2:"rgba(255,255,255,0.13)",
  cyan:"#4f8ef7", cyanDim:"#0d2248", cyanText:"#a3c4fc",
  green:"#34d399", greenDim:"#072015",
  orange:"#fb923c", red:"#f87171", amber:"#fbbf24",
  text:"#f0f4f8", muted:"#8b95a5", dim:"#3d4d63",
  blue:"#4f8ef7", blueDim:"#0d2248", blueText:"#a3c4fc",
};

// Componente base de botón con hover
const Btn = ({children, onClick, style={}, variant="primary", size="md", disabled=false, title=""}) => {
  const [hov, setHov] = useState(false);
  const base = {
    fontFamily: font, fontWeight:600, cursor: disabled?"not-allowed":"pointer",
    border:"none", display:"inline-flex", alignItems:"center", justifyContent:"center",
    gap:6, transition:"all .15s ease", letterSpacing:.3,
    opacity: disabled ? .45 : 1,
  };
  const sizes = {
    xs: {padding:"4px 10px", fontSize:10, borderRadius:5},
    sm: {padding:"6px 12px", fontSize:11, borderRadius:6},
    md: {padding:"10px 18px", fontSize:13, borderRadius:7},
    lg: {padding:"12px 22px", fontSize:14, borderRadius:8},
    xl: {padding:"14px 30px", fontSize:15, borderRadius:9},
  };
  const variants = {
    primary:  { background: hov?"#1a3570":C.blueDim, color:C.blueText, border:`1px solid ${C.blue}44` },
    success:  { background: hov?"rgba(52,211,153,0.15)":C.greenDim, color:C.green, border:`1px solid ${C.green}44` },
    danger:   { background: hov?"rgba(248,113,113,0.15)":"rgba(248,113,113,0.06)", color:C.red, border:`1px solid ${C.red}44` },
    ghost:    { background: hov?"rgba(255,255,255,0.06)":"transparent", color: hov?C.text:C.muted, border:`1px solid ${C.border}` },
    warning:  { background: hov?"rgba(251,146,60,0.15)":"rgba(251,146,60,0.06)", color:C.orange, border:`1px solid ${C.orange}44` },
    subtle:   { background: hov?"rgba(255,255,255,0.06)":C.surface2, color:C.muted, border:`1px solid ${C.border}` },
  };
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{...base, ...sizes[size], ...variants[variant], ...style}}>
      {children}
    </button>
  );
};

const S = {
  page:   {fontFamily:font, background:C.bg, minHeight:"100vh", maxWidth:520, margin:"0 auto", color:C.text},
  input:  {width:"100%", background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`, color:C.text, padding:"10px 13px", borderRadius:7, fontSize:13, boxSizing:"border-box", fontFamily:font, outline:"none", transition:"border-color .15s"},
  label:  {fontSize:10, color:C.muted, letterSpacing:1.5, textTransform:"uppercase", display:"block", marginBottom:6, fontFamily:font, fontWeight:500},
  btn:    {background:C.blueDim, border:`1px solid ${C.blue}44`, color:C.blueText, padding:"10px 18px", borderRadius:7, fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:font, transition:"all .15s"},
  btnGhost:{background:"none", border:`1px solid ${C.border}`, color:C.muted, padding:"7px 14px", borderRadius:7, fontSize:12, cursor:"pointer", fontFamily:font, transition:"all .15s"},
  btnSm:  {background:C.blueDim, border:`1px solid ${C.blue}44`, color:C.blueText, padding:"5px 11px", borderRadius:6, fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:font, transition:"all .15s"},
  btnOk:  {background:C.greenDim, border:`1px solid ${C.green}44`, color:C.green, padding:"5px 11px", borderRadius:6, fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:font, transition:"all .15s"},
  card:   {background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:"14px 16px", marginBottom:8},
  header: {background:"rgba(22,27,39,0.95)", borderBottom:`1px solid ${C.border}`, padding:"12px 20px", position:"sticky", top:0, zIndex:100, display:"flex", alignItems:"center", justifyContent:"space-between", backdropFilter:"blur(16px)"},
};

const CTip = ({active,payload,label}) => {
  if(!active||!payload?.length) return null;
  return (
    <div style={{background:C.card,border:`1px solid ${C.border2}`,borderRadius:8,padding:"10px 14px",fontSize:12,color:C.text,boxShadow:"0 8px 32px rgba(0,0,0,.5)"}}>
      {label&&<div style={{color:C.muted,marginBottom:5,fontSize:10,letterSpacing:1,textTransform:"uppercase"}}>{label}</div>}
      {payload.map((p,i)=><div key={i} style={{color:p.color||C.blueText,fontWeight:600}}>{p.name}: {p.value}</div>)}
    </div>
  );
};

// ── HELPERS ───────────────────────────────────────────────────────
function timeAgo(ts){const d=(Date.now()-(ts?.toMillis?.()??ts))/1000;if(d<60)return"Ahora mismo";if(d<3600)return`Hace ${Math.floor(d/60)}min`;if(d<86400)return`Hace ${Math.floor(d/3600)}h`;return`Hace ${Math.floor(d/86400)}d`;}
function avatarOf(u){return((u?.nombre?.[0]??"")+(u?.apellidos?.[0]??"")).toUpperCase();}
function fmtMes(k){try{return new Date(k+"-01").toLocaleDateString("es-ES",{month:"long",year:"numeric"});}catch{return k;}}

// Limpiar nombre de calle: "1-PONCIR-2" → "PONCIR", "2-MARE DE DEU-12" → "MARE DE DEU"
function cleanCalle(raw) {
  if (!raw || raw === "Sin calle") return raw;
  // Quitar número inicial: "1-" o "12-"
  let c = raw.replace(/^\d+-/, "");
  // Quitar número final: "-2" o "-12"
  c = c.replace(/-\d+$/, "");
  return c.trim() || raw;
}

// ── KML PARSER ────────────────────────────────────────────────────
function parseKML(rawText) {
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

// ── MAPA LEAFLET ──────────────────────────────────────────────────
function MapaLeaflet({ubicaciones,recorrido,selId,onSelect,height=260}) {
  const divRef=useRef(null);
  const mapRef=useRef(null);
  const layersRef=useRef([]);

  useEffect(()=>{
    if(!document.getElementById("leaflet-css")){
      const css=document.createElement("link");
      css.id="leaflet-css";css.rel="stylesheet";
      css.href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
      document.head.appendChild(css);
    }
    if(!window.L){
      const js=document.createElement("script");
      js.src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
      js.onload=()=>initMap();
      document.head.appendChild(js);
    } else { initMap(); }
  },[]);

  function initMap(){
    if(!divRef.current||mapRef.current)return;
    const L=window.L;
    const center=ubicaciones.length>0?[ubicaciones[0].lat,ubicaciones[0].lng]:[39.57,2.65];
    const map=L.map(divRef.current,{zoomControl:true,attributionControl:false}).setView(center,14);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
    mapRef.current=map;
    drawLayers();
  }

  function drawLayers(){
    const L=window.L;
    if(!L||!mapRef.current)return;
    const map=mapRef.current;
    layersRef.current.forEach(l=>map.removeLayer(l));
    layersRef.current=[];

    if(recorrido&&recorrido.length>1){
      const latlngs=recorrido.map(p=>Array.isArray(p)?p:[p.lat,p.lng]);
      const l=L.polyline(latlngs,{color:"#1e3a5f",weight:2,opacity:0.6,dashArray:"6,4"}).addTo(map);
      layersRef.current.push(l);
    }
    const pts=ubicaciones.filter(u=>u.lat&&u.lng);
    if(pts.length>1){
      const l=L.polyline(pts.map(u=>[u.lat,u.lng]),{color:"#2a3142",weight:1.5,opacity:0.4,dashArray:"4,8"}).addTo(map);
      layersRef.current.push(l);
    }
    pts.forEach((u,idx)=>{
      const isSel=selId===u.id;
      const baseColor=barrioColor(u.barri);
      const color=u.realizado?C.green:isSel?C.orange:baseColor;
      const size=isSel?32:26;
      const icon=L.divIcon({
        className:"",
        html:`<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:3px solid ${u.realizado?"#fff":isSel?"#fff":baseColor+"88"};display:flex;align-items:center;justify-content:center;font-size:${isSel?12:9}px;font-weight:800;color:white;box-shadow:0 2px 8px #0008;font-family:${mono};">${u.orden}</div>`,
        iconSize:[size,size],iconAnchor:[size/2,size/2],
      });
      const m=L.marker([u.lat,u.lng],{icon}).addTo(map).on("click",()=>onSelect(u.id));
      layersRef.current.push(m);
    });
    if(pts.length>0) map.fitBounds(pts.map(u=>[u.lat,u.lng]),{padding:[20,20]});
  }

  useEffect(()=>{
    if(window.L&&mapRef.current) drawLayers();
    else { const t=setTimeout(()=>{if(window.L&&!mapRef.current)initMap();else if(window.L)drawLayers();},600); return()=>clearTimeout(t); }
  },[ubicaciones,selId,recorrido]);

  useEffect(()=>{
    if(!mapRef.current||!selId)return;
    const u=ubicaciones.find(x=>x.id===selId);
    if(u) mapRef.current.setView([u.lat,u.lng],17,{animate:true});
  },[selId]);

  return (
    <div style={{borderRadius:10,overflow:"hidden",border:`1px solid ${C.border}`}}>
      <div ref={divRef} style={{height,background:"#1a2535"}}/>
      <div style={{background:C.card,padding:"7px 14px",display:"flex",justifyContent:"space-between",borderTop:`1px solid ${C.border}`}}>
        <div style={{display:"flex",gap:12}}>
          {[[C.green,"Realizada"],[C.blue,"Pendiente"],[C.orange,"Seleccionada"]].map(([c,l])=>(
            <div key={l} style={{display:"flex",alignItems:"center",gap:4}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:c}}/>
              <span style={{fontSize:10,color:C.muted}}>{l}</span>
            </div>
          ))}
        </div>
        <span style={{fontSize:10,color:C.dim}}>{ubicaciones.filter(u=>u.realizado).length}/{ubicaciones.length}</span>
      </div>
    </div>
  );
}

// ── TARJETA UBICACIÓN ─────────────────────────────────────────────
function TarjetaUbic({ub,isSel,isExp,onSelect,onExpand,onMarcar,onMarcarQR,onNota,onNavegar,onParte,done}){
  const elReal=ub.elementos.filter(e=>e.realizado).length;
  const tieneParteIniciado = ub.parte && Object.values(ub.parte.checks||{}).some(Boolean);
  const parteFirmado = ub.parte?.firmado;
  return (
    <div id={"u-"+ub.id} style={{...S.card,borderLeft:`3px solid ${done?C.green:isSel?C.orange:C.border}`,opacity:done?0.85:1}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:9}}>
        <div onClick={onSelect} style={{width:30,height:30,borderRadius:"50%",flexShrink:0,cursor:"pointer",background:done?C.greenDim:isSel?"#2a1f00":C.blueDim,border:`2px solid ${done?C.green:isSel?C.orange:C.blue}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:done?C.green:isSel?C.orange:C.blueText}}>
          {ub.orden}
        </div>
        <div style={{flex:1,minWidth:0,cursor:"pointer"}} onClick={onSelect}>
          <div style={{fontSize:13,color:C.text,fontWeight:700,marginBottom:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ub.calle} {ub.num}</div>
          <div style={{fontSize:10,color:C.muted}}>{ub.barri}{ub.districte?" · "+ub.districte:""}</div>
          {ub.comentari&&<div style={{fontSize:10,color:C.dim,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ub.comentari}</div>}
          {done&&ub.realizadoEn&&<div style={{fontSize:10,color:C.green,marginTop:2}}>✓ {timeAgo(ub.realizadoEn)}</div>}
          {ub.nota&&<div style={{fontSize:10,color:"#8b5cf6",marginTop:2}}>📝 {ub.nota}</div>}
          <div style={{fontSize:10,color:C.dim,marginTop:2}}>{ub.pa}</div>
          {onParte&&(
            <div style={{marginTop:4}}>
              {parteFirmado
                ? <span style={{fontSize:9,color:C.green,background:C.greenDim,border:`1px solid ${C.green}44`,borderRadius:10,padding:"2px 7px"}}>📋 Parte firmado</span>
                : tieneParteIniciado
                  ? <span style={{fontSize:9,color:C.orange,background:"#2a1500",border:`1px solid ${C.orange}44`,borderRadius:10,padding:"2px 7px"}}>📋 Parte en curso</span>
                  : <span style={{fontSize:9,color:C.dim,background:"#0a1628",border:`1px solid ${C.border}`,borderRadius:10,padding:"2px 7px"}}>📋 Sin parte</span>
              }
            </div>
          )}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0}}>
          <div style={{display:"flex",gap:4}}>
            <button onClick={onNavegar} style={{...S.btnOk}} title="Navegar">🧭</button>
            <button onClick={onMarcar} style={done?S.btnOk:S.btnSm}>{done?"✓":"Marcar"}</button>
          </div>
          <div style={{display:"flex",gap:4}}>
            {onParte&&<button onClick={onParte} style={{...S.btnGhost,fontSize:10,padding:"4px 6px",flex:1,borderColor:parteFirmado?C.green:tieneParteIniciado?C.orange:C.border,color:parteFirmado?C.green:tieneParteIniciado?C.orange:C.muted}}>📋 Parte</button>}
            <button onClick={onNota} style={{...S.btnGhost,fontSize:10,padding:"4px 8px",borderColor:ub.nota?"#8b5cf6":C.border,color:ub.nota?"#8b5cf6":C.muted}}>📝</button>
          </div>
        </div>
      </div>
      {ub.elementos.length>0&&(
        <div style={{marginTop:8,paddingTop:7,borderTop:`1px solid #1e2535`}}>
          <button onClick={onExpand} style={{...S.btnGhost,width:"100%",display:"flex",justifyContent:"space-between",fontSize:10,padding:"4px 10px"}}>
            <span>Elementos QR ({elReal}/{ub.elementos.length})</span><span>{isExp?"▲":"▼"}</span>
          </button>
          {isExp&&(
            <div style={{marginTop:6,display:"flex",flexDirection:"column",gap:4}}>
              {ub.elementos.map(el=>(
                <div key={el.codiQR} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:el.realizado?C.greenDim:"#0a1628",border:`1px solid ${el.realizado?C.green+"44":"#1e2535"}`,borderRadius:6,padding:"7px 10px"}}>
                  <div><span style={{fontSize:12,color:el.realizado?C.green:C.blueText,fontWeight:700}}>{el.codiQR}</span><span style={{fontSize:10,color:C.dim,marginLeft:8}}>{el.model}</span></div>
                  <button onClick={()=>onMarcarQR(el.codiQR,!el.realizado)} style={el.realizado?S.btnOk:S.btnSm}>{el.realizado?"✓":"Marcar"}</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── PARTE DE INSPECCIÓN ───────────────────────────────────────────
const PUNTOS_INSPECCION = [
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

function ParteInspeccion({ub, sesion, onSave, onClose}){
  // Inicializar estado del parte desde ub.parte si existe
  const initParte = ()=>{
    const p = ub.parte || {};
    const checks = {};
    PUNTOS_INSPECCION.forEach(g=>g.puntos.forEach(pt=>{ checks[pt] = p.checks?.[pt] || false; }));
    return checks;
  };
  const [checks, setChecks]     = useState(initParte);
  const [obs, setObs]           = useState(ub.parte?.observaciones || "");
  const [firmado, setFirmado]   = useState(ub.parte?.firmado || false);

  const total  = PUNTOS_INSPECCION.reduce((s,g)=>s+g.puntos.length,0);
  const marcados = Object.values(checks).filter(Boolean).length;
  const pct    = Math.round(marcados/total*100);

  function toggle(pt){ setChecks(prev=>({...prev,[pt]:!prev[pt]})); }

  function guardar(finalizar=false){
    const parte = { checks, observaciones:obs, firmado: finalizar||firmado, fechaFirma: finalizar?Date.now():ub.parte?.fechaFirma, operarioId: sesion.id };
    onSave(parte, finalizar);
  }

  function generarPDF(){
    // Abre ventana nueva con HTML imprimible
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Parte de Inspección - ${ub.pa}</title>
    <style>
      body{font-family:Arial,sans-serif;font-size:11px;margin:20px;color:#000}
      h2{font-size:14px;margin-bottom:4px}
      .header{display:grid;grid-template-columns:1fr 1fr;gap:10px;border:1px solid #000;padding:8px;margin-bottom:8px}
      .qrs{border:1px solid #000;padding:6px;margin-bottom:8px}
      table{width:100%;border-collapse:collapse;margin-bottom:8px}
      th,td{border:1px solid #999;padding:4px 6px;font-size:10px}
      th{background:#eee;font-weight:bold}
      .grupo{background:#ddd;font-weight:bold}
      .check{text-align:center;font-size:14px}
      .obs{border:1px solid #000;padding:8px;min-height:60px;margin-top:8px}
      .firma{margin-top:16px;display:flex;justify-content:space-between}
      @media print{button{display:none}}
    </style></head><body>
    <h2>PARTE DE INSPECCIÓN — MANTENIMIENTO PREVENTIVO</h2>
    <div class="header">
      <div><b>Punto de aportación:</b> ${ub.pa}</div>
      <div><b>Dirección:</b> ${ub.calle} ${ub.num}</div>
    </div>
    <div class="qrs"><b>QRs del P.A.:</b> ${ub.elementos.map(e=>e.codiQR).join(" · ")||"—"}</div>
    <table>
      <tr><th>Conjunto</th><th>Punto de inspección</th><th style="width:40px">✓</th></tr>
      ${PUNTOS_INSPECCION.map(g=>`
        <tr><td class="grupo" colspan="3">${g.grupo}</td></tr>
        ${g.puntos.map(pt=>`<tr><td></td><td>${pt}</td><td class="check">${checks[pt]?"✗":""}</td></tr>`).join("")}
      `).join("")}
    </table>
    <div class="obs"><b>Observaciones:</b><br/>${obs||""}</div>
    <div class="firma">
      <div>Operario: <b>${sesion.nombre} ${sesion.apellidos}</b></div>
      <div>Fecha: <b>${new Date().toLocaleDateString("es-ES")}</b></div>
      <div>Firma: _______________</div>
    </div>
    <br/><button onclick="window.print()">🖨️ Imprimir / Guardar PDF</button>
    </body></html>`;
    const w=window.open("","_blank");
    w.document.write(html);
    w.document.close();
  }

  return(
    <div style={{...S.page,paddingBottom:100}}>
      {/* Header */}
      <div style={{...S.header}}>
        <button onClick={onClose} style={{...S.btnGhost,fontSize:11,padding:"5px 10px",flexShrink:0}}>← Volver</button>
        <div style={{flex:1,minWidth:0,padding:"0 8px"}}>
          <div style={{fontSize:12,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>Parte — {ub.pa}</div>
          <div style={{fontSize:10,color:C.muted}}>{ub.calle} {ub.num} · {marcados}/{total} puntos</div>
        </div>
        <div style={{fontSize:15,fontWeight:800,color:pct===100?C.green:pct>50?C.orange:C.red}}>{pct}%</div>
      </div>

      <div style={{padding:"10px 14px 0"}}>
        {/* Info PA */}
        <div style={{...S.card,marginBottom:10,borderLeft:`3px solid ${C.blue}`}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
            <div><div style={S.label}>Punto de aportación</div><div style={{fontSize:13,fontWeight:700,color:C.blueText}}>{ub.pa}</div></div>
            <div><div style={S.label}>Dirección</div><div style={{fontSize:12,color:C.text}}>{ub.calle} {ub.num}</div></div>
          </div>
          {ub.elementos.length>0&&(
            <div>
              <div style={S.label}>QRs del P.A.</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {ub.elementos.map(e=>(
                  <span key={e.codiQR} style={{fontSize:11,background:C.blueDim,color:C.blueText,border:`1px solid ${C.blue}44`,borderRadius:6,padding:"2px 8px"}}>{e.codiQR}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Barra progreso */}
        <div style={{height:6,background:"#0f1117",borderRadius:3,overflow:"hidden",marginBottom:14}}>
          <div style={{height:"100%",background:pct===100?C.green:pct>50?C.orange:C.red,borderRadius:3,width:`${pct}%`,transition:"width 0.3s"}}/>
        </div>

        {/* Tabla puntos de inspección */}
        {PUNTOS_INSPECCION.map(g=>(
          <div key={g.grupo} style={{marginBottom:12}}>
            {/* Cabecera grupo */}
            <div style={{background:"#1a2535",borderRadius:"6px 6px 0 0",padding:"7px 12px",fontSize:11,fontWeight:700,color:C.blueText,borderBottom:`1px solid ${C.border}`}}>
              {g.grupo}
            </div>
            {/* Puntos */}
            {g.puntos.map((pt,i)=>(
              <div key={pt} onClick={()=>toggle(pt)} style={{
                display:"flex",alignItems:"center",gap:10,
                background: checks[pt]?"#0d2010":C.card,
                border:`1px solid ${checks[pt]?C.green+"44":C.border}`,
                borderTop: i===0?"none":"1px solid #1e2535",
                padding:"10px 12px",cursor:"pointer",
                borderRadius: i===g.puntos.length-1?"0 0 6px 6px":"0",
              }}>
                <div style={{
                  width:22,height:22,borderRadius:4,flexShrink:0,
                  background:checks[pt]?C.green:"#0a1628",
                  border:`2px solid ${checks[pt]?C.green:C.border}`,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:13,color:"white",fontWeight:800,
                }}>
                  {checks[pt]?"✓":""}
                </div>
                <div style={{fontSize:12,color:checks[pt]?C.green:C.text,lineHeight:1.4,flex:1}}>{pt}</div>
              </div>
            ))}
          </div>
        ))}

        {/* Observaciones */}
        <div style={{marginBottom:14}}>
          <label style={S.label}>Observaciones</label>
          <textarea value={obs} onChange={e=>setObs(e.target.value)} placeholder="Anotaciones, incidencias, elementos sustituidos..." rows={4}
            style={{...S.input,resize:"vertical"}}/>
        </div>

        {/* Estado firma */}
        {firmado&&(
          <div style={{background:C.greenDim,border:`1px solid ${C.green}44`,borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:C.green}}>
            ✓ Parte finalizado y firmado
          </div>
        )}

        {/* Botones */}
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          <button onClick={()=>guardar(false)} style={{...S.btn,width:"100%",padding:12,fontSize:13}}>
            💾 Guardar borrador
          </button>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <button onClick={generarPDF} style={{...S.btnGhost,padding:12,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
              🖨️ Generar PDF
            </button>
            <button onClick={()=>guardar(true)} style={{...S.btn,padding:12,fontSize:12,background:C.greenDim,borderColor:C.green,color:C.green,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
              ✓ Finalizar y firmar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── DETALLE PLAN ──────────────────────────────────────────────────
function DetallePlan({plan,sesion,onBack,onUpdate}){
  const [selId,setSelId]=useState(null);
  const [verMapa,setVerMapa]=useState(true);
  const [expandId,setExpandId]=useState(null);
  const [notaId,setNotaId]=useState(null);
  const [notaText,setNotaText]=useState("");
  const [filtroBa,setFiltroBa]=useState("");
  const [parteUbicId,setParteUbicId]=useState(null); // id de parada con parte abierto

  const esPrev = plan.tipo==="prev";
  const {ubicaciones,recorrido}=plan;
  const realizadas=ubicaciones.filter(u=>u.realizado).length;
  const tasa=ubicaciones.length?Math.round(realizadas/ubicaciones.length*100):0;
  const totalQR=ubicaciones.reduce((s,u)=>s+u.elementos.length,0);
  const realizadosQR=ubicaciones.reduce((s,u)=>s+u.elementos.filter(e=>e.realizado).length,0);
  const barrios=[...new Set(ubicaciones.map(u=>u.barri).filter(Boolean))];
  const ubics=filtroBa?ubicaciones.filter(u=>u.barri===filtroBa):ubicaciones;
  const pendientes=ubics.filter(u=>!u.realizado);
  const hechas=ubics.filter(u=>u.realizado);
  const proxima=pendientes[0];
  const tasaColor=tasa===100?C.green:tasa>50?C.orange:C.red;

  function marcarUbic(id,val){
    onUpdate({...plan,ubicaciones:ubicaciones.map(u=>u.id!==id?u:{...u,realizado:val,realizadoPor:val?sesion.id:null,realizadoEn:val?Date.now():null,elementos:val?u.elementos.map(e=>({...e,realizado:true})):u.elementos})});
  }
  function marcarQR(ubicId,qr,val){
    onUpdate({...plan,ubicaciones:ubicaciones.map(u=>{
      if(u.id!==ubicId)return u;
      const elems=u.elementos.map(e=>e.codiQR===qr?{...e,realizado:val}:e);
      const todos=elems.length>0&&elems.every(e=>e.realizado);
      return{...u,elementos:elems,realizado:todos,realizadoPor:todos?sesion.id:null,realizadoEn:todos?Date.now():null};
    })});
  }
  function guardarNota(){
    onUpdate({...plan,ubicaciones:ubicaciones.map(u=>u.id!==notaId?u:{...u,nota:notaText})});
    setNotaId(null);setNotaText("");
  }
  function guardarParte(ubicId, parte, finalizar){
    onUpdate({...plan,ubicaciones:ubicaciones.map(u=>u.id!==ubicId?u:{
      ...u,
      parte,
      // Si se finaliza, marcar la parada como realizada
      realizado: finalizar?true:u.realizado,
      realizadoPor: finalizar?sesion.id:u.realizadoPor,
      realizadoEn: finalizar?Date.now():u.realizadoEn,
    })});
    if(finalizar) setParteUbicId(null);
  }
  function sel(id){
    setSelId(selId===id?null:id);
    setTimeout(()=>{const el=document.getElementById("u-"+id);if(el)el.scrollIntoView({behavior:"smooth",block:"nearest"});},100);
  }

  // Si hay parte abierto, mostrarlo
  if(parteUbicId){
    const ub=ubicaciones.find(u=>u.id===parteUbicId);
    if(ub) return <ParteInspeccion ub={ub} sesion={sesion}
      onSave={(parte,finalizar)=>guardarParte(parteUbicId,parte,finalizar)}
      onClose={()=>setParteUbicId(null)}/>;
  }

  return(
    <div style={{...S.page,paddingBottom:90}}>
      <div style={{...S.header}}>
        <button onClick={onBack} style={{...S.btnGhost,fontSize:11,padding:"5px 10px"}}>← Volver</button>
        <div style={{flex:1,minWidth:0,padding:"0 10px"}}>
          <div style={{fontSize:13,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{plan.nombre}</div>
          <div style={{fontSize:10,color:C.muted}}>{plan.turno} · {plan.diaServicio} · {realizadas}/{ubicaciones.length}</div>
        </div>
        <div style={{fontSize:18,fontWeight:800,color:tasaColor}}>{tasa}%</div>
      </div>
      <div style={{padding:"10px 14px 0"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5,marginBottom:10}}>
          {[{l:"Paradas",v:ubicaciones.length,c:C.blueText},{l:"Hechas",v:realizadas,c:C.green},{l:"Pendient.",v:ubicaciones.length-realizadas,c:tasaColor},{l:"QR",v:`${realizadosQR}/${totalQR}`,c:"#8b5cf6"}].map(s=>(
            <div key={s.l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 4px",textAlign:"center"}}>
              <div style={{fontSize:15,fontWeight:800,color:s.c}}>{s.v}</div>
              <div style={{fontSize:8,color:C.dim,textTransform:"uppercase",letterSpacing:1}}>{s.l}</div>
            </div>
          ))}
        </div>
        <div style={{height:6,background:"#0f1117",borderRadius:3,overflow:"hidden",marginBottom:10}}>
          <div style={{height:"100%",background:tasaColor,borderRadius:3,width:`${tasa}%`,transition:"width 0.4s"}}/>
        </div>
        {proxima&&(
          <div style={{background:"#1a2535",border:`1px solid ${C.blue}33`,borderRadius:10,padding:"10px 14px",marginBottom:10,display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:32,height:32,borderRadius:"50%",background:C.blueDim,border:`2px solid ${C.blue}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:C.blueText,flexShrink:0}}>{proxima.orden}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:10,color:C.muted,marginBottom:1}}>PRÓXIMA PARADA</div>
              <div style={{fontSize:13,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{proxima.calle} {proxima.num}</div>
              <div style={{fontSize:10,color:C.dim}}>{proxima.barri} · {proxima.elementos.length} elementos</div>
            </div>
            <button onClick={()=>window.open(`https://maps.google.com/maps?daddr=${proxima.lat},${proxima.lng}&dirflg=d`,"_blank")} style={{...S.btnOk,flexShrink:0}}>🧭 IR</button>
          </div>
        )}
        <button onClick={()=>setVerMapa(v=>!v)} style={{...S.btnGhost,width:"100%",marginBottom:8,borderColor:verMapa?C.blue:C.border,color:verMapa?C.blueText:C.muted}}>
          🗺️ {verMapa?"Ocultar mapa":"Ver mapa del recorrido"}
        </button>
        {verMapa&&<div style={{marginBottom:10}}><MapaLeaflet ubicaciones={ubicaciones} recorrido={recorrido} selId={selId} onSelect={sel} height={260}/></div>}
        {barrios.length>1&&(
          <div style={{display:"flex",gap:6,overflowX:"auto",marginBottom:10,paddingBottom:2}}>
            <button onClick={()=>setFiltroBa("")} style={{...S.btnGhost,fontSize:10,padding:"3px 10px",borderRadius:20,whiteSpace:"nowrap",borderColor:!filtroBa?C.blue:C.border,color:!filtroBa?C.blueText:C.muted,background:!filtroBa?C.blueDim:"none"}}>Todos</button>
            {barrios.map(b=><button key={b} onClick={()=>setFiltroBa(b)} style={{...S.btnGhost,fontSize:10,padding:"3px 10px",borderRadius:20,whiteSpace:"nowrap",borderColor:filtroBa===b?C.blue:C.border,color:filtroBa===b?C.blueText:C.muted,background:filtroBa===b?C.blueDim:"none"}}>{b}</button>)}
          </div>
        )}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div style={{...S.label,marginBottom:0}}>Paradas ({ubics.length})</div>
          <button onClick={()=>{const t=ubics.every(u=>u.realizado);ubics.forEach(u=>marcarUbic(u.id,!t));}} style={{...S.btnGhost,fontSize:10,padding:"4px 10px"}}>
            {ubics.every(u=>u.realizado)?"✗ Desmarcar todas":"✓ Marcar todas"}
          </button>
        </div>
        {pendientes.length>0&&<><div style={{fontSize:9,color:C.dim,letterSpacing:2,textTransform:"uppercase",marginBottom:6,paddingLeft:4}}>PENDIENTES ({pendientes.length})</div>{pendientes.map(ub=><TarjetaUbic key={ub.id} ub={ub} isSel={selId===ub.id} isExp={expandId===ub.id} onSelect={()=>sel(ub.id)} onExpand={()=>setExpandId(expandId===ub.id?null:ub.id)} onMarcar={()=>marcarUbic(ub.id,true)} onMarcarQR={(qr,v)=>marcarQR(ub.id,qr,v)} onNota={()=>{setNotaId(ub.id);setNotaText(ub.nota||"");}} onNavegar={()=>window.open(`https://maps.google.com/maps?daddr=${ub.lat},${ub.lng}&dirflg=d`,"_blank")} onParte={esPrev?()=>setParteUbicId(ub.id):undefined}/>)}</>}
        {hechas.length>0&&<><div style={{fontSize:9,color:C.green,letterSpacing:2,textTransform:"uppercase",marginBottom:6,marginTop:12,paddingLeft:4}}>✓ COMPLETADAS ({hechas.length})</div>{hechas.map(ub=><TarjetaUbic key={ub.id} ub={ub} isSel={selId===ub.id} isExp={expandId===ub.id} onSelect={()=>sel(ub.id)} onExpand={()=>setExpandId(expandId===ub.id?null:ub.id)} onMarcar={()=>marcarUbic(ub.id,false)} onMarcarQR={(qr,v)=>marcarQR(ub.id,qr,v)} onNota={()=>{setNotaId(ub.id);setNotaText(ub.nota||"");}} onNavegar={()=>window.open(`https://maps.google.com/maps?daddr=${ub.lat},${ub.lng}&dirflg=d`,"_blank")} onParte={esPrev?()=>setParteUbicId(ub.id):undefined} done/>)}</>}
      </div>
      {notaId&&(
        <div style={{position:"fixed",inset:0,background:"#000b",zIndex:300,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={()=>setNotaId(null)}>
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:"16px 16px 0 0",padding:20,width:"100%",maxWidth:520}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:13,fontWeight:600,marginBottom:12}}>📝 Nota de la parada</div>
            <textarea value={notaText} onChange={e=>setNotaText(e.target.value)} rows={4} placeholder="Observaciones, incidencias..." style={{...S.input,resize:"none",marginBottom:12}}/>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setNotaId(null)} style={{...S.btnGhost,flex:1}}>Cancelar</button>
              <button onClick={guardarNota} style={{...S.btn,flex:1}}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── TIPOS DE TRABAJO ──────────────────────────────────────────────
const TIPOS_TRABAJO = [
  { key:"prev",   label:"Mantenimiento Preventivo", icon:"🛠️", color:"#3b82f6", kml:true  },
  { key:"corr",   label:"Mantenimiento Correctivo", icon:"🔩", color:"#f97316", kml:false },
  { key:"ext",    label:"Limpieza Exterior",         icon:"🚿", color:"#22c55e", kml:true  },
  { key:"int",    label:"Limpieza Interior",          icon:"🧹", color:"#8b5cf6", kml:true  },
];

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
    <div style={{...S.card,borderLeft:`3px solid ${statusColor}`}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tarea.titulo}</div>
          <div style={{fontSize:10,color:C.muted,marginBottom:4}}>{tarea.vehiculo||"Sin vehículo"} · {tarea.fecha?new Date(tarea.fecha).toLocaleDateString("es-ES"):"—"}</div>
          {tarea.descripcion&&<div style={{fontSize:11,color:C.muted,lineHeight:1.5,display:"-webkit-box",WebkitLineClamp:expandida?99:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{tarea.descripcion}</div>}
        </div>
        <span style={{fontSize:9,padding:"3px 8px",borderRadius:12,background:`${statusColor}22`,color:statusColor,border:`1px solid ${statusColor}44`,textTransform:"uppercase",flexShrink:0,marginLeft:8}}>{tarea.estado}</span>
      </div>
      {/* Estado */}
      <div style={{display:"flex",gap:5,marginBottom:8}}>
        {["pendiente","en curso","cerrada"].map(est=>(
          <button key={est} onClick={()=>cambiarEstado(est)} style={{flex:1,padding:"5px 4px",borderRadius:6,cursor:"pointer",fontSize:9,fontFamily:mono,textTransform:"capitalize",letterSpacing:0.5,background:tarea.estado===est?"#1e293b":"none",border:`1px solid ${tarea.estado===est?C.blue:C.border}`,color:tarea.estado===est?C.blueText:C.muted}}>{est}</button>
        ))}
      </div>
      {/* Expandir comentarios */}
      <button onClick={()=>setExpandida(v=>!v)} style={{...S.btnGhost,width:"100%",fontSize:10,padding:"4px 10px",display:"flex",justifyContent:"space-between"}}>
        <span>Comentarios ({tarea.comentarios?.length||0})</span><span>{expandida?"▲":"▼"}</span>
      </button>
      {expandida&&(
        <div style={{marginTop:8}}>
          {(tarea.comentarios||[]).map((c,i)=>{const u=getUser(c.usuarioId);return(
            <div key={i} style={{background:"#0a1628",borderRadius:6,padding:"7px 10px",marginBottom:5}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                <div style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:18,height:18,borderRadius:"50%",background:C.blueDim,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,color:C.blueText,fontWeight:700}}>{avatarOf(u)}</div><span style={{fontSize:11,color:C.muted}}>{u.nombre}</span></div>
                <span style={{fontSize:9,color:C.dim}}>{timeAgo(c.fecha)}</span>
              </div>
              <div style={{fontSize:12,color:"#cbd5e1",lineHeight:1.5}}>{c.texto}</div>
            </div>
          );})}
          <div style={{display:"flex",gap:6,marginTop:6}}>
            <input value={comentario} onChange={e=>setCom(e.target.value)} onKeyDown={e=>e.key==="Enter"&&agregarCom()} placeholder="Añadir comentario..." style={{...S.input,flex:1,fontSize:12,padding:"7px 10px"}}/>
            <button onClick={agregarCom} style={{...S.btnSm}}>↑</button>
          </div>
          {sesion.rol==="admin"&&<button onClick={onDelete} style={{background:"#2d1515",border:`1px solid ${C.red}44`,color:"#f87171",width:"100%",padding:"7px",borderRadius:6,fontSize:11,cursor:"pointer",fontFamily:mono,marginTop:6}}>Eliminar tarea</button>}
        </div>
      )}
    </div>
  );
}

// ── MÓDULO RUTAS POR TIPO ─────────────────────────────────────────
function ModuloRutas({planes,addPlan,updatePlan,deletePlan,sesion,usuarios}){
  const [tipoActivo,setTipoActivo]   = useState(null); // null = portada
  const [planActivo,setPlanActivo]   = useState(null);
  const [showUpload,setShowUpload]   = useState(false);
  const [showNuevaTarea,setShowNT]   = useState(false);
  const [subiendo,setSubiendo]       = useState(false);
  const [errorMsg,setErrorMsg]       = useState("");
  const [debugInfo,setDebugInfo]     = useState([]);
  const [mesFilter,setMesFilter]     = useState(null);
  const [formTarea,setFormTarea]     = useState({titulo:"",descripcion:"",vehiculo:"",estado:"pendiente"});
  const fileRef = useRef();
  const esAdmin = sesion.rol==="admin";

  // Separar planes KML de tareas correctivo
  const planesKML   = planes.filter(p=>p.tipo!=="corr");
  const tareasCorr  = planes.filter(p=>p.tipo==="corr");

  // Si hay plan KML activo, mostrar detalle
  if(planActivo){
    const live=planes.find(p=>p._id===planActivo._id)||planActivo;
    return <DetallePlan plan={live} sesion={sesion} onBack={()=>{setPlanActivo(null);}} onUpdate={async(updated)=>{await updatePlan(updated);setPlanActivo(updated);}}/>;
  }

  const tipo = TIPOS_TRABAJO.find(t=>t.key===tipoActivo);

  // ── PORTADA ──
  if(!tipoActivo) return(
    <div style={{paddingBottom:80}}>
      <div style={{padding:"12px 14px 0"}}>
        <div style={{fontSize:10,color:C.dim,letterSpacing:2,textTransform:"uppercase",marginBottom:14}}>Selecciona tipo de trabajo</div>
        {TIPOS_TRABAJO.map(t=>{
          const planesTipo=planes.filter(p=>p.tipo===t.key);
          const total=planesTipo.length;
          const completados=planesTipo.filter(p=>{
            if(p.tipo==="corr") return p.estado==="cerrada";
            const ubs=p.ubicaciones||[];
            return ubs.length>0&&ubs.every(u=>u.realizado);
          }).length;
          return(
            <div key={t.key} onClick={()=>setTipoActivo(t.key)} style={{...S.card,cursor:"pointer",borderLeft:`4px solid ${t.color}`,marginBottom:10}}
              onMouseEnter={e=>e.currentTarget.style.borderColor=C.blueText}
              onMouseLeave={e=>e.currentTarget.style.borderColor=t.color}>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <div style={{width:46,height:46,borderRadius:12,background:`${t.color}18`,border:`1px solid ${t.color}33`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>{t.icon}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:15,fontWeight:700,marginBottom:3}}>{t.label}</div>
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
    const planesT=planes.filter(p=>p.tipo===tipoActivo);
    const meses=[...new Set(planesT.map(p=>p.mes))].sort((a,b)=>b.localeCompare(a));
    const filtrados=mesFilter?planesT.filter(p=>p.mes===mesFilter):planesT;

    function handleFiles(e){
      const files=Array.from(e.target.files);
      if(!files.length)return;
      setSubiendo(true);setErrorMsg("");setDebugInfo([]);
      let done=0;
      files.forEach(file=>{
        const reader=new FileReader();
        reader.onload=ev=>{
          try{
            const {ubicaciones,recorrido,docName,debug}=parseKML(ev.target.result);
            setDebugInfo(debug||[]);
            if(ubicaciones.length===0){
              setErrorMsg(`Sin ubicaciones en "${file.name}". Ver debug.`);
            } else {
              const turno=ubicaciones[0]?.turno||"";
              const dia=ubicaciones[0]?.dia||"";
              let mes=new Date().toISOString().slice(0,7);
              if(dia){const p=dia.split("/");if(p.length===3)mes=p[2]+"-"+p[1].padStart(2,"0");}
              addPlan({tipo:tipoActivo,nombre:docName||file.name.replace(".kml",""),archivo:file.name,turno,mes,diaServicio:dia,ubicaciones,recorrido,fechaSubida:Date.now()});
              setShowUpload(false);setDebugInfo([]);
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
        <div style={{background:`${tipo.color}12`,borderBottom:`1px solid ${tipo.color}33`,padding:"10px 14px",display:"flex",alignItems:"center",gap:10}}>
          <button onClick={()=>{setTipoActivo(null);setShowUpload(false);setErrorMsg("");setDebugInfo([]);setMesFilter(null);}} style={{...S.btnGhost,fontSize:11,padding:"5px 10px",flexShrink:0}}>← Volver</button>
          <span style={{fontSize:18}}>{tipo.icon}</span>
          <div style={{flex:1}}>
            <div style={{fontSize:13,fontWeight:700,color:tipo.color}}>{tipo.label}</div>
            <div style={{fontSize:10,color:C.muted}}>{planesT.length} planes cargados</div>
          </div>
        </div>

        <div style={{padding:"12px 14px 0"}}>
          {esAdmin&&(
            <>
              <button onClick={()=>{setShowUpload(v=>!v);setErrorMsg("");setDebugInfo([]);}} style={{...S.btn,width:"100%",marginBottom:10,background:showUpload?"none":tipo.color+"22",borderColor:showUpload?C.border:tipo.color,color:showUpload?C.muted:tipo.color}}>
                {showUpload?"✕ Cancelar":"⬆ Subir KML"}
              </button>
              {showUpload&&(
                <div style={{...S.card,marginBottom:10}}>
                  <div style={{fontSize:11,color:C.muted,marginBottom:10,lineHeight:1.7}}>Sube archivos KML de {tipo.label.toLowerCase()}. La app detecta turno, fecha y paradas automáticamente.</div>
                  {errorMsg&&<div style={{background:"#2d1515",border:`1px solid ${C.red}44`,color:"#f87171",borderRadius:8,padding:"10px 12px",fontSize:12,marginBottom:10}}>⚠️ {errorMsg}</div>}
                  {debugInfo.length>0&&<div style={{background:"#080f1a",border:`1px solid ${C.blueDim}`,borderRadius:8,padding:"10px 12px",fontSize:11,marginBottom:10}}><div style={{color:C.blueText,fontWeight:700,marginBottom:6}}>🔍 Debug:</div>{debugInfo.map((l,i)=><div key={i} style={{color:l.startsWith("ERROR")?C.red:l.includes("Ubicaciones")?C.green:C.muted,marginBottom:2}}>{l}</div>)}</div>}
                  <div onClick={()=>fileRef.current.click()} style={{background:"#080f1a",border:`2px dashed ${tipo.color}44`,borderRadius:10,padding:"28px 20px",textAlign:"center",cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.borderColor=tipo.color} onMouseLeave={e=>e.currentTarget.style.borderColor=tipo.color+"44"}>
                    <div style={{fontSize:32,marginBottom:8}}>{tipo.icon}</div>
                    <div style={{fontSize:13,color:tipo.color,fontWeight:600,marginBottom:4}}>{subiendo?"Procesando…":"Seleccionar KML"}</div>
                    <div style={{fontSize:10,color:C.dim}}>Formato: 02-02-2026.kml</div>
                  </div>
                  <input ref={fileRef} type="file" accept=".kml" multiple onChange={handleFiles} style={{display:"none"}}/>
                </div>
              )}
            </>
          )}
          {meses.length>0&&<div style={{display:"flex",gap:6,overflowX:"auto",marginBottom:10,paddingBottom:2}}><button onClick={()=>setMesFilter(null)} style={{...S.btnGhost,fontSize:10,padding:"3px 10px",borderRadius:20,whiteSpace:"nowrap",borderColor:!mesFilter?tipo.color:C.border,color:!mesFilter?tipo.color:C.muted,background:!mesFilter?tipo.color+"18":"none"}}>Todos</button>{meses.map(m=><button key={m} onClick={()=>setMesFilter(m)} style={{...S.btnGhost,fontSize:10,padding:"3px 10px",borderRadius:20,whiteSpace:"nowrap",borderColor:mesFilter===m?tipo.color:C.border,color:mesFilter===m?tipo.color:C.muted,background:mesFilter===m?tipo.color+"18":"none"}}>{fmtMes(m)}</button>)}</div>}
          {filtrados.length===0&&<div style={{textAlign:"center",padding:"50px 0"}}><div style={{fontSize:40,marginBottom:12}}>{tipo.icon}</div><div style={{fontSize:14,color:C.dim}}>Sin planes de {tipo.label.toLowerCase()}</div>{esAdmin&&<div style={{fontSize:11,color:"#374151",marginTop:6}}>Sube un KML para empezar</div>}</div>}
          {filtrados.map(plan=>{
            const real=plan.ubicaciones.filter(u=>u.realizado).length,tot=plan.ubicaciones.length;
            const tasa=tot?Math.round(real/tot*100):0,col=tasa===100?C.green:tasa>0?C.orange:C.dim;
            const totalQR=plan.ubicaciones.reduce((s,u)=>s+u.elementos.length,0);
            return(
              <div key={plan._id} style={{...S.card,cursor:"pointer",borderLeft:`3px solid ${tasa===100?C.green:tipo.color}`}} onClick={()=>setPlanActivo(plan)} onMouseEnter={e=>e.currentTarget.style.borderColor=C.blueText} onMouseLeave={e=>e.currentTarget.style.borderColor=tasa===100?C.green:tipo.color}>
                <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:5}}>
                      {plan.turno&&<span style={{fontSize:11,background:tipo.color+"18",color:tipo.color,border:`1px solid ${tipo.color}44`,borderRadius:12,padding:"2px 9px"}}>{plan.turno}</span>}
                      <span style={{fontSize:11,color:C.dim}}>{plan.diaServicio}</span>
                      {tasa===100&&<span style={{fontSize:11,color:C.green}}>✓</span>}
                    </div>
                    <div style={{fontSize:14,fontWeight:700,marginBottom:5,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{plan.nombre}</div>
                    <div style={{fontSize:11,color:C.muted,marginBottom:8}}>{tot} paradas · {totalQR} elementos QR</div>
                    <div style={{height:5,background:"#0f1117",borderRadius:3,overflow:"hidden",marginBottom:4}}><div style={{height:"100%",background:col,borderRadius:3,width:`${tasa}%`,transition:"width 0.4s"}}/></div>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:C.dim}}><span>{real} de {tot} realizadas</span><span style={{color:col,fontWeight:700}}>{tasa}%</span></div>
                  </div>
                  {esAdmin&&<button onClick={e=>{e.stopPropagation();deletePlan(plan._id);}} style={{background:"#2d1515",border:`1px solid ${C.red}`,color:"#f87171",padding:"5px 8px",borderRadius:6,fontSize:11,cursor:"pointer",fontFamily:mono,flexShrink:0}}>✕</button>}
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
      <div style={{background:`${tipo.color}12`,borderBottom:`1px solid ${tipo.color}33`,padding:"10px 14px",display:"flex",alignItems:"center",gap:10}}>
        <button onClick={()=>setTipoActivo(null)} style={{...S.btnGhost,fontSize:11,padding:"5px 10px",flexShrink:0}}>← Volver</button>
        <span style={{fontSize:18}}>{tipo.icon}</span>
        <div style={{flex:1}}>
          <div style={{fontSize:13,fontWeight:700,color:tipo.color}}>{tipo.label}</div>
          <div style={{fontSize:10,color:C.muted}}>{tareasT.length} tareas · {tareasT.filter(t=>t.estado==="cerrada").length} cerradas</div>
        </div>
      </div>
      <div style={{padding:"12px 14px 0"}}>
        {/* Stats rápidas */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:12}}>
          {[
            {l:"Pendientes",v:tareasT.filter(t=>t.estado==="pendiente").length,c:C.red},
            {l:"En curso",v:tareasT.filter(t=>t.estado==="en curso").length,c:C.orange},
            {l:"Cerradas",v:tareasT.filter(t=>t.estado==="cerrada").length,c:C.green},
          ].map(s=><div key={s.l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px",textAlign:"center"}}><div style={{fontSize:18,fontWeight:800,color:s.c}}>{s.v}</div><div style={{fontSize:9,color:C.dim,textTransform:"uppercase",letterSpacing:1}}>{s.l}</div></div>)}
        </div>

        {/* Nueva tarea */}
        <button onClick={()=>setShowNT(v=>!v)} style={{...S.btn,width:"100%",marginBottom:10,background:showNuevaTarea?"none":tipo.color+"22",borderColor:showNuevaTarea?C.border:tipo.color,color:showNuevaTarea?C.muted:tipo.color}}>
          {showNuevaTarea?"✕ Cancelar":"+ Nueva tarea correctiva"}
        </button>
        {showNuevaTarea&&(
          <div style={{...S.card,marginBottom:12}}>
            <div style={{marginBottom:12}}><label style={S.label}>Título *</label><input value={formTarea.titulo} onChange={e=>setFormTarea({...formTarea,titulo:e.target.value})} placeholder="Ej: Cambio de frenos VH-002" style={S.input}/></div>
            <div style={{marginBottom:12}}><label style={S.label}>Vehículo</label><select value={formTarea.vehiculo} onChange={e=>setFormTarea({...formTarea,vehiculo:e.target.value})} style={S.input}><option value="">— Sin vehículo —</option>{VEHICULOS.map(v=><option key={v} value={v}>{v}</option>)}</select></div>
            <div style={{marginBottom:14}}><label style={S.label}>Descripción</label><textarea value={formTarea.descripcion} onChange={e=>setFormTarea({...formTarea,descripcion:e.target.value})} placeholder="Describe el trabajo a realizar..." rows={3} style={{...S.input,resize:"none"}}/></div>
            <button onClick={crearTarea} style={{...S.btn,width:"100%",background:tipo.color+"22",borderColor:tipo.color,color:tipo.color}}>CREAR TAREA</button>
          </div>
        )}

        {tareasT.length===0&&!showNuevaTarea&&<div style={{textAlign:"center",padding:"40px 0"}}><div style={{fontSize:40,marginBottom:12}}>{tipo.icon}</div><div style={{fontSize:14,color:C.dim}}>Sin tareas correctivas</div></div>}
        {/* Pendientes y en curso primero */}
        {tareasT.filter(t=>t.estado!=="cerrada").map(t=>(
          <TarjetaCorrectivo key={t._id||t.id} tarea={t} sesion={sesion} usuarios={usuarios}
            onUpdate={upd=>updatePlan(upd)}
            onDelete={()=>deletePlan(t._id)}/>
        ))}
        {tareasT.filter(t=>t.estado==="cerrada").length>0&&(
          <>
            <div style={{fontSize:9,color:C.green,letterSpacing:2,textTransform:"uppercase",marginBottom:6,marginTop:10,paddingLeft:4}}>✓ CERRADAS ({tareasT.filter(t=>t.estado==="cerrada").length})</div>
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

// ── LISTA PLANES (alias para compatibilidad) ───────────────────────
function ListaPlanes({planes,addPlan,updatePlan,deletePlan,sesion,usuarios}){
  return <ModuloRutas planes={planes} addPlan={addPlan} updatePlan={updatePlan} deletePlan={deletePlan} sesion={sesion} usuarios={usuarios}/>;
}

// ── INCIDENCIAS ───────────────────────────────────────────────────
function ModuloIncidencias({sesion,usuarios}){
  const {data:incidencias} = useCollection("incidencias","fecha",sesion.org_id);
  const [vista,setVista]=useState("feed");
  const [filtro,setFiltro]=useState("todas");
  const [selId,setSelId]=useState(null);
  const [form,setForm]=useState({titulo:"",descripcion:"",vehiculo:"",categoria:0,prioridad:"media"});
  const [comentario,setCom]=useState("");
  const [showAdmin,setShowAdmin]=useState(false);
  const [showStats,setShowStats]=useState(false);
  const esAdmin=sesion.rol==="admin";
  const getUser=id=>usuarios.find(u=>u._id===id||u.id===id)||{nombre:"?",apellidos:""};
  const incFilt=incidencias.filter(i=>filtro==="todas"?true:filtro==="mias"?i.usuarioId===sesion.uid:filtro==="alta"?i.prioridad==="alta":i.estado===filtro);
  const incActual=incidencias.find(i=>i._id===selId);

  async function crearInc(){
    if(!form.titulo.trim())return;
    await fbAdd("incidencias",{usuarioId:sesion.uid,vehiculo:form.vehiculo||null,categoria:parseInt(form.categoria),titulo:form.titulo,descripcion:form.descripcion,prioridad:form.prioridad,estado:"abierta",comentarios:[],org_id:sesion.org_id});
    setForm({titulo:"",descripcion:"",vehiculo:"",categoria:0,prioridad:"media"});
    setVista("feed");
  }
  async function agregarCom(inc){
    if(!comentario.trim())return;
    const nuevos=[...(inc.comentarios||[]),{usuarioId:sesion.uid,texto:comentario,fecha:Date.now()}];
    await fbUpdate("incidencias",inc._id,{comentarios:nuevos});
    setCom("");
  }
  async function cambiarEstado(inc,est){
    await fbUpdate("incidencias",inc._id,{estado:est});
  }

  if(showAdmin) return <PanelAdmin usuarios={usuarios} orgId={sesion.org_id} onClose={()=>setShowAdmin(false)}/>;
  if(showStats) return <PanelStats incidencias={incidencias} onClose={()=>setShowStats(false)}/>;

  return(
    <div style={{paddingBottom:80}}>
      {/* Sub-header con vistas */}
      {vista!=="feed"&&<div style={{padding:"10px 16px 0"}}><button onClick={()=>setVista("feed")} style={{...S.btnGhost,fontSize:11,padding:"5px 10px"}}>← Volver</button></div>}
      {vista==="feed"&&(
        <>
          <div style={{padding:"10px 16px 0",display:"flex",gap:8,alignItems:"center"}}>
            {esAdmin&&<><button onClick={()=>setShowStats(true)} style={{...S.btnGhost,fontSize:11,padding:"5px 10px"}}>📊 Stats</button><button onClick={()=>setShowAdmin(true)} style={{...S.btnGhost,fontSize:11,padding:"5px 10px"}}>⚙️ Usuarios</button></>}
          </div>
          <div style={{padding:"8px 16px 0",display:"flex",gap:6,overflowX:"auto"}}>
            {[["todas","Todas"],["alta","🔴 Urgentes"],["abierta","Abiertas"],["en revisión","En revisión"],["mias","Mis reportes"]].map(([k,l])=>(
              <button key={k} onClick={()=>setFiltro(k)} style={{background:filtro===k?C.blueDim:"none",border:`1px solid ${filtro===k?C.blue:C.border}`,color:filtro===k?C.blueText:C.muted,padding:"4px 12px",borderRadius:20,fontSize:11,cursor:"pointer",whiteSpace:"nowrap",fontFamily:mono}}>{l}</button>
            ))}
          </div>
          <div style={{display:"flex",padding:"10px 16px",gap:6}}>
            {[{l:"Abiertas",v:incidencias.filter(i=>i.estado==="abierta").length,c:C.red},{l:"En revisión",v:incidencias.filter(i=>i.estado==="en revisión").length,c:C.orange},{l:"Cerradas",v:incidencias.filter(i=>i.estado==="cerrada").length,c:C.green}].map(s=>(
              <div key={s.l} style={{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px",textAlign:"center"}}>
                <div style={{fontSize:20,fontWeight:800,color:s.c}}>{s.v}</div>
                <div style={{fontSize:9,color:C.dim,letterSpacing:1,textTransform:"uppercase"}}>{s.l}</div>
              </div>
            ))}
          </div>
        </>
      )}
      {vista==="feed"&&(
        <div style={{padding:"0 16px"}}>
          {incFilt.length===0&&<div style={{textAlign:"center",color:C.dim,padding:"50px 0",fontSize:13}}>Sin incidencias</div>}
          {incFilt.map(inc=>{
            const cat=CATS[inc.categoria]||CATS[0];const autor=getUser(inc.usuarioId);
            return(
              <div key={inc._id} onClick={()=>{setSelId(inc._id);setVista("detalle");}} style={{...S.card,borderLeft:`3px solid ${cat.color}`,cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.borderColor=C.blueText} onMouseLeave={e=>e.currentTarget.style.borderColor=cat.color}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}><span>{cat.icon}</span><span style={{fontSize:10,color:cat.color,letterSpacing:1,textTransform:"uppercase"}}>{cat.label}</span></div>
                  <div style={{display:"flex",gap:5}}>
                    <span style={{fontSize:9,padding:"2px 7px",borderRadius:20,background:`${PC[inc.prioridad]}22`,color:PC[inc.prioridad],border:`1px solid ${PC[inc.prioridad]}44`,textTransform:"uppercase"}}>{inc.prioridad}</span>
                    <span style={{fontSize:9,padding:"2px 7px",borderRadius:20,background:"#1e293b",color:C.muted,border:`1px solid ${C.border}`,textTransform:"uppercase"}}>{inc.estado}</span>
                  </div>
                </div>
                <div style={{fontSize:14,fontWeight:700,marginBottom:4}}>{inc.titulo}</div>
                {inc.vehiculo&&<div style={{fontSize:11,color:C.muted,marginBottom:6}}>🚛 {inc.vehiculo}</div>}
                <div style={{fontSize:12,color:C.muted,lineHeight:1.5,marginBottom:8,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{inc.descripcion}</div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:22,height:22,borderRadius:"50%",background:C.blueDim,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:C.blueText,fontWeight:700}}>{avatarOf(autor)}</div><span style={{fontSize:11,color:C.muted}}>{autor.nombre}</span></div>
                  <span style={{fontSize:11,color:C.dim}}>{timeAgo(inc.fecha)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {vista==="nueva"&&(
        <div style={{padding:"14px 16px"}}>
          <div style={{marginBottom:14}}><label style={S.label}>Categoría</label><div style={{display:"flex",flexWrap:"wrap",gap:8}}>{CATS.map((c,i)=><button key={i} onClick={()=>setForm({...form,categoria:i})} style={{background:parseInt(form.categoria)===i?`${c.color}22`:"none",border:`1px solid ${parseInt(form.categoria)===i?c.color:C.border}`,color:parseInt(form.categoria)===i?c.color:C.muted,padding:"6px 12px",borderRadius:20,fontSize:11,cursor:"pointer",fontFamily:mono}}>{c.icon} {c.label}</button>)}</div></div>
          <div style={{marginBottom:14}}><label style={S.label}>Vehículo</label><select value={form.vehiculo} onChange={e=>setForm({...form,vehiculo:e.target.value})} style={S.input}><option value="">— Sin vehículo —</option>{VEHICULOS.map(v=><option key={v} value={v}>{v}</option>)}</select></div>
          <div style={{marginBottom:14}}><label style={S.label}>Prioridad</label><div style={{display:"flex",gap:8}}>{["baja","media","alta"].map(p=><button key={p} onClick={()=>setForm({...form,prioridad:p})} style={{flex:1,padding:"8px",borderRadius:8,cursor:"pointer",fontSize:12,fontFamily:mono,background:form.prioridad===p?`${PC[p]}22`:"none",border:`1px solid ${form.prioridad===p?PC[p]:C.border}`,color:form.prioridad===p?PC[p]:C.muted,textTransform:"capitalize"}}>{p}</button>)}</div></div>
          <div style={{marginBottom:14}}><label style={S.label}>Título *</label><input value={form.titulo} onChange={e=>setForm({...form,titulo:e.target.value})} placeholder="Resumen breve" style={S.input}/></div>
          <div style={{marginBottom:22}}><label style={S.label}>Descripción</label><textarea value={form.descripcion} onChange={e=>setForm({...form,descripcion:e.target.value})} placeholder="Describe la incidencia..." rows={4} style={{...S.input,resize:"vertical"}}/></div>
          <button onClick={crearInc} style={{...S.btn,width:"100%",padding:13,fontSize:14}}>PUBLICAR INCIDENCIA</button>
        </div>
      )}
      {vista==="detalle"&&incActual&&(()=>{
        const cat=CATS[incActual.categoria]||CATS[0];const autor=getUser(incActual.usuarioId);
        return(
          <div style={{padding:"0 0 20px"}}>
            <div style={{background:C.card,borderBottom:`1px solid ${C.border}`,padding:"14px 16px",borderLeft:`4px solid ${cat.color}`}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}><span>{cat.icon}</span><span style={{fontSize:10,color:cat.color,letterSpacing:2,textTransform:"uppercase"}}>{cat.label}</span></div>
              <div style={{fontSize:18,fontWeight:700,marginBottom:6}}>{incActual.titulo}</div>
              {incActual.vehiculo&&<div style={{fontSize:12,color:C.muted,marginBottom:8}}>🚛 {incActual.vehiculo}</div>}
              <div style={{fontSize:13,color:"#94a3b8",lineHeight:1.6,marginBottom:14}}>{incActual.descripcion}</div>
              <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:esAdmin?14:0}}>
                <span style={{fontSize:10,padding:"3px 10px",borderRadius:20,background:`${PC[incActual.prioridad]}22`,color:PC[incActual.prioridad],border:`1px solid ${PC[incActual.prioridad]}44`,textTransform:"uppercase"}}>Prioridad {incActual.prioridad}</span>
                <span style={{fontSize:11,color:C.muted}}>{autor.nombre} · {timeAgo(incActual.fecha)}</span>
              </div>
              {esAdmin&&<div><label style={{...S.label,marginBottom:8}}>Estado</label><div style={{display:"flex",gap:6}}>{["abierta","en revisión","cerrada"].map(est=><button key={est} onClick={()=>cambiarEstado(incActual,est)} style={{flex:1,padding:"7px 4px",borderRadius:6,cursor:"pointer",fontSize:10,fontFamily:mono,textTransform:"capitalize",background:incActual.estado===est?"#1e293b":"none",border:`1px solid ${incActual.estado===est?C.blue:C.border}`,color:incActual.estado===est?C.blueText:C.muted}}>{est}</button>)}</div></div>}
            </div>
            <div style={{padding:"14px 16px"}}>
              <label style={{...S.label,marginBottom:10}}>Comentarios ({incActual.comentarios?.length||0})</label>
              {(incActual.comentarios||[]).map((c,i)=>{const cu=getUser(c.usuarioId);return(<div key={i} style={S.card}><div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:22,height:22,borderRadius:"50%",background:C.blueDim,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:C.blueText,fontWeight:700}}>{avatarOf(cu)}</div><span style={{fontSize:12,color:"#94a3b8",fontWeight:600}}>{cu.nombre}</span></div><span style={{fontSize:10,color:C.dim}}>{timeAgo(c.fecha)}</span></div><div style={{fontSize:13,color:"#cbd5e1",lineHeight:1.5}}>{c.texto}</div></div>);})}
              <div style={{display:"flex",gap:8,marginTop:10}}><input value={comentario} onChange={e=>setCom(e.target.value)} placeholder="Añadir comentario..." onKeyDown={e=>e.key==="Enter"&&agregarCom(incActual)} style={{...S.input,flex:1}}/><button onClick={()=>agregarCom(incActual)} style={{...S.btn,padding:"10px 14px"}}>↑</button></div>
            </div>
          </div>
        );
      })()}
      {vista==="feed"&&(
        <button onClick={()=>setVista("nueva")} style={{position:"fixed",bottom:72,left:"50%",transform:"translateX(-50%)",...S.btn,padding:"12px 28px",borderRadius:40,fontSize:13,boxShadow:"0 4px 24px #3b82f644",fontFamily:mono,zIndex:100}}>
          + NUEVA INCIDENCIA
        </button>
      )}
    </div>
  );
}

// ── PANEL STATS ───────────────────────────────────────────────────
function PanelStats({incidencias,onClose}){
  const [periodo,setPeriodo]=useState("todo");const now2=Date.now();
  const f=incidencias.filter(i=>{const c=periodo==="7d"?now2-86400000*7:periodo==="30d"?now2-86400000*30:0;return(i.fecha??0)>=c;});
  const ab=f.filter(i=>i.estado==="abierta").length,rev=f.filter(i=>i.estado==="en revisión").length,cer=f.filter(i=>i.estado==="cerrada").length,urg=f.filter(i=>i.prioridad==="alta").length;
  const evol=Array.from({length:7},(_,i)=>{const d=new Date(now2-86400000*(6-i));const s=new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();return{dia:d.toLocaleDateString("es-ES",{weekday:"short"}),total:incidencias.filter(x=>(x.fecha??0)>=s&&(x.fecha??0)<s+86400000).length,cerradas:incidencias.filter(x=>(x.fecha??0)>=s&&(x.fecha??0)<s+86400000&&x.estado==="cerrada").length};});
  const pie=[{name:"Abiertas",value:ab,color:C.red},{name:"En revisión",value:rev,color:C.orange},{name:"Cerradas",value:cer,color:C.green}].filter(x=>x.value>0);
  return(
    <div style={S.page}>
      <div style={S.header}><div><div style={{fontSize:10,color:C.dim,letterSpacing:3,textTransform:"uppercase"}}>Estadísticas</div><div style={{fontSize:17,fontWeight:700}}>Incidencias</div></div><button onClick={onClose} style={S.btnGhost}>← Volver</button></div>
      <div style={{padding:"12px 16px 0",display:"flex",gap:8}}>{[["7d","7d"],["30d","30d"],["todo","Todo"]].map(([k,l])=><button key={k} onClick={()=>setPeriodo(k)} style={{...S.btnGhost,fontSize:11,padding:"5px 12px",borderColor:periodo===k?C.blue:C.border,color:periodo===k?C.blueText:C.muted,background:periodo===k?C.blueDim:"none"}}>{l}</button>)}</div>
      <div style={{padding:"14px 16px 80px"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:14}}>{[{l:"Total",v:f.length,c:C.blueText},{l:"Abiertas",v:ab,c:C.red},{l:"Revisión",v:rev,c:C.orange},{l:"Urgentes",v:urg,c:"#f59e0b"}].map(k=><div key={k.l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 6px",textAlign:"center"}}><div style={{fontSize:20,fontWeight:800,color:k.c}}>{k.v}</div><div style={{fontSize:8,color:C.dim,letterSpacing:1,textTransform:"uppercase",marginTop:2}}>{k.l}</div></div>)}</div>
        <div style={{...S.card,marginBottom:12}}><label style={S.label}>Últimos 7 días</label><ResponsiveContainer width="100%" height={130}><BarChart data={evol} barGap={2}><XAxis dataKey="dia" tick={{fontSize:10,fill:C.dim}} axisLine={false} tickLine={false}/><YAxis tick={{fontSize:10,fill:C.dim}} axisLine={false} tickLine={false} allowDecimals={false} width={18}/><Tooltip content={<CTip/>} cursor={{fill:"#ffffff08"}}/><Bar dataKey="total" name="Total" fill={C.blue} radius={[4,4,0,0]}/><Bar dataKey="cerradas" name="Cerradas" fill={C.green} radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div>
        <div style={S.card}><label style={S.label}>Por estado</label><ResponsiveContainer width="100%" height={120}><PieChart><Pie data={pie} cx="50%" cy="50%" innerRadius={30} outerRadius={48} paddingAngle={3} dataKey="value">{pie.map((e,i)=><Cell key={i} fill={e.color}/>)}</Pie><Tooltip content={<CTip/>}/></PieChart></ResponsiveContainer>{pie.map(d=><div key={d.name} style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}><div style={{width:8,height:8,borderRadius:"50%",background:d.color}}/><span style={{fontSize:11,color:C.muted}}>{d.name}</span><span style={{fontSize:11,color:"#94a3b8",marginLeft:"auto"}}>{d.value}</span></div>)}</div>
      </div>
    </div>
  );
}

// ── PANEL ADMIN ───────────────────────────────────────────────────
function PanelAdmin({usuarios,orgId,onClose}){
  const [tab,setTab]=useState("lista");
  const [form,setForm]=useState({nombre:"",apellidos:"",email:"",password:"",rol:"conductor"});
  const [err,setErr]=useState("");
  const [saving,setSaving]=useState(false);

  async function crear(){
    if(!form.nombre||!form.email||!form.password){setErr("Nombre, email y contraseña son obligatorios");return;}
    if(form.password.length<6){setErr("La contraseña debe tener al menos 6 caracteres");return;}
    setSaving(true);setErr("");
    try{
      const cred=await createUserWithEmailAndPassword(secondaryAuth,form.email.trim().toLowerCase(),form.password);
      await setDoc(doc(db,"usuarios",cred.user.uid),{
        nombre:form.nombre.trim(),apellidos:form.apellidos.trim(),
        email:form.email.trim().toLowerCase(),rol:form.rol,
        org_id:orgId,activo:true,createdAt:serverTimestamp(),
      });
      await secondaryAuth.signOut();
      setForm({nombre:"",apellidos:"",email:"",password:"",rol:"conductor"});
      setErr("");setTab("lista");
    }catch(e){
      const msgs={"auth/email-already-in-use":"Ese email ya está en uso","auth/invalid-email":"Email inválido","auth/weak-password":"Contraseña demasiado débil"};
      setErr(msgs[e.code]||"Error al crear usuario: "+e.message);
    }
    setSaving(false);
  }

  async function toggleActivo(u){
    await updateDoc(doc(db,"usuarios",u._id),{activo:!u.activo});
  }

  return(
    <div style={S.page}>
      <div style={S.header}><div><div style={{fontSize:10,color:C.dim,letterSpacing:3,textTransform:"uppercase"}}>Admin</div><div style={{fontSize:17,fontWeight:700}}>Gestión de usuarios</div></div><button onClick={onClose} style={S.btnGhost}>← Volver</button></div>
      <div style={{display:"flex",gap:8,padding:"12px 16px 0"}}>{[["lista","Usuarios"],["nuevo","+ Nuevo"]].map(([k,l])=><button key={k} onClick={()=>setTab(k)} style={{...S.btnGhost,borderColor:tab===k?C.blue:C.border,color:tab===k?C.blueText:C.muted,background:tab===k?C.blueDim:"none"}}>{l}</button>)}</div>
      <div style={{padding:"14px 16px 80px"}}>
        {tab==="lista"&&usuarios.map(u=>(
          <div key={u._id} style={{...S.card,opacity:u.activo?1:0.4}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <div style={{width:38,height:38,borderRadius:"50%",background:C.blueDim,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:C.blueText}}>{avatarOf(u)}</div>
                <div><div style={{fontSize:14,fontWeight:600}}>{u.nombre} {u.apellidos}</div><div style={{fontSize:11,color:C.muted}}>{u.email} · <span style={{color:C.blueText}}>{u.rol}</span></div></div>
              </div>
              <button onClick={()=>toggleActivo(u)} style={{...S.btnGhost,fontSize:10,padding:"5px 9px",color:u.activo?C.green:C.muted,borderColor:u.activo?C.green+"44":C.border}}>{u.activo?"Activo":"Inactivo"}</button>
            </div>
          </div>
        ))}
        {tab==="nuevo"&&(
          <div style={S.card}>
            {[["Nombre *","nombre","text"],["Apellidos","apellidos","text"],["Email *","email","email"],["Contraseña *","password","password"]].map(([lbl,key,type])=>(
              <div key={key} style={{marginBottom:12}}><label style={S.label}>{lbl}</label><input value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})} type={type} style={S.input} autoComplete={type==="password"?"new-password":"off"}/></div>
            ))}
            <div style={{marginBottom:18}}><label style={S.label}>Rol</label><div style={{display:"flex",gap:8}}>{[["conductor","Conductor"],["admin","Supervisor"]].map(([v,l])=><button key={v} onClick={()=>setForm({...form,rol:v})} style={{flex:1,padding:"9px",borderRadius:7,cursor:"pointer",fontSize:12,fontFamily:font,background:form.rol===v?C.blueDim:"none",border:`1px solid ${form.rol===v?C.blue:C.border}`,color:form.rol===v?C.blueText:C.muted}}>{l}</button>)}</div></div>
            {err&&<div style={{background:"#2d1515",color:"#f87171",borderRadius:8,padding:"10px",fontSize:12,marginBottom:12}}>{err}</div>}
            <button onClick={crear} disabled={saving} style={{...S.btn,width:"100%",opacity:saving?0.6:1}}>{saving?"Creando…":"CREAR USUARIO"}</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── INVENTARIO ────────────────────────────────────────────────────
const CATS_INV = ["Filtros","Frenos","Neumáticos","Motor","Eléctrico","Carrocería","Fluidos","Otros"];
const PRODUCTOS_DEMO = [
  {id:"p1",nombre:"Filtro de aceite",referencia:"FO-4521",categoria:"Filtros",unidad:"ud",stock:8,stockMin:3,ubicacion:"Estante A1"},
  {id:"p2",nombre:"Pastillas de freno delanteras",referencia:"PF-7734",categoria:"Frenos",unidad:"juego",stock:2,stockMin:4,ubicacion:"Estante A2"},
  {id:"p3",nombre:"Aceite motor 5W-40 (5L)",referencia:"AM-5W40",categoria:"Fluidos",unidad:"bidón",stock:12,stockMin:5,ubicacion:"Estante B1"},
  {id:"p4",nombre:"Batería 12V 74Ah",referencia:"BA-7412",categoria:"Eléctrico",unidad:"ud",stock:1,stockMin:2,ubicacion:"Estante C1"},
  {id:"p5",nombre:"Correa de distribución",referencia:"CD-3310",categoria:"Motor",unidad:"ud",stock:4,stockMin:2,ubicacion:"Estante A3"},
  {id:"p6",nombre:"Líquido de frenos DOT4",referencia:"LF-DOT4",categoria:"Fluidos",unidad:"litro",stock:0,stockMin:3,ubicacion:"Estante B2"},
];

function ModuloInventario({sesion,usuarios}){
  const {data:productos}   = useCollection("inventario","nombre",sesion.org_id);
  const {data:movimientos} = useCollection("movimientos","fecha",sesion.org_id);
  const [vista,setVista]           = useState("lista");
  const [selId,setSelId]           = useState(null);
  const [catFilter,setCatFilter]   = useState("");
  const [busqueda,setBusqueda]     = useState("");
  const [soloAlertas,setSoloAlertas]=useState(false);
  const [formProd,setFormProd]     = useState({nombre:"",referencia:"",categoria:"Filtros",unidad:"ud",stock:0,stockMin:0,ubicacion:""});
  const [formMov,setFormMov]       = useState({tipo:"salida",cantidad:1,vehiculo:"",motivo:"",nota:""});
  const [errForm,setErrForm]       = useState("");
  const esAdmin = sesion.rol==="admin";

  const getUser = id => usuarios.find(u=>u._id===id||u.id===id)||{nombre:"?",apellidos:""};

  const prodFiltrados = productos.filter(p=>{
    if(soloAlertas && p.stock > p.stockMin) return false;
    if(catFilter && p.categoria !== catFilter) return false;
    if(busqueda && !p.nombre.toLowerCase().includes(busqueda.toLowerCase()) && !p.referencia.toLowerCase().includes(busqueda.toLowerCase())) return false;
    return true;
  });

  const alertas = productos.filter(p=>p.stock <= p.stockMin).length;
  const agotados = productos.filter(p=>p.stock===0).length;
  const prodActual = productos.find(p=>p._id===selId);
  const movsProd = movimientos.filter(m=>m.productoId===selId);

  function stockColor(p){
    if(p.stock===0) return C.red;
    if(p.stock<=p.stockMin) return C.orange;
    return C.green;
  }

  async function guardarProducto(){
    if(!formProd.nombre.trim()||!formProd.referencia.trim()){setErrForm("Nombre y referencia son obligatorios");return;}
    if(productos.find(p=>p.referencia===formProd.referencia)){setErrForm("Esa referencia ya existe");return;}
    await fbAdd("inventario",{...formProd,stock:parseInt(formProd.stock)||0,stockMin:parseInt(formProd.stockMin)||0,org_id:sesion.org_id});
    setFormProd({nombre:"",referencia:"",categoria:"Filtros",unidad:"ud",stock:0,stockMin:0,ubicacion:""});
    setErrForm(""); setVista("lista");
  }

  async function registrarMovimiento(){
    const cant=parseInt(formMov.cantidad)||0;
    if(cant<=0){setErrForm("La cantidad debe ser mayor que 0");return;}
    if(formMov.tipo==="salida" && cant > prodActual.stock){setErrForm(`Stock insuficiente. Disponible: ${prodActual.stock} ${prodActual.unidad}`);return;}
    const nuevoStock = formMov.tipo==="entrada" ? prodActual.stock+cant : prodActual.stock-cant;
    await fbUpdate("inventario",selId,{stock:nuevoStock});
    await fbAdd("movimientos",{
      productoId:selId,
      tipo:formMov.tipo, cantidad:cant,
      vehiculo:formMov.vehiculo, motivo:formMov.motivo, nota:formMov.nota,
      stockAntes:prodActual.stock, stockDespues:nuevoStock,
      usuarioId:sesion.uid, org_id:sesion.org_id,
    });
    setFormMov({tipo:"salida",cantidad:1,vehiculo:"",motivo:"",nota:""});
    setErrForm(""); setVista("detalle");
  }

  async function eliminarProducto(id){
    await fbDelete("inventario",id);
    setVista("lista"); setSelId(null);
  }

  // ── VISTA LISTA ──
  if(vista==="lista") return(
    <div style={{paddingBottom:80}}>
      <div style={{padding:"12px 14px 0"}}>
        {/* KPIs */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:12}}>
          {[
            {l:"Productos",v:productos.length,c:C.blueText},
            {l:"⚠️ Alertas",v:alertas,c:alertas>0?C.orange:C.green},
            {l:"🚫 Agotados",v:agotados,c:agotados>0?C.red:C.green},
          ].map(s=>(
            <div key={s.l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 8px",textAlign:"center",cursor:s.l.includes("Alertas")?"pointer":"default"}}
              onClick={()=>s.l.includes("Alertas")&&setSoloAlertas(v=>!v)}>
              <div style={{fontSize:20,fontWeight:800,color:s.c}}>{s.v}</div>
              <div style={{fontSize:9,color:soloAlertas&&s.l.includes("Alertas")?C.orange:C.dim,textTransform:"uppercase",letterSpacing:1}}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* Búsqueda */}
        <input value={busqueda} onChange={e=>setBusqueda(e.target.value)} placeholder="🔍 Buscar por nombre o referencia..." style={{...S.input,marginBottom:8}}/>

        {/* Filtro categoría */}
        <div style={{display:"flex",gap:6,overflowX:"auto",marginBottom:10,paddingBottom:2}}>
          <button onClick={()=>{setCatFilter("");setSoloAlertas(false);}} style={{...S.btnGhost,fontSize:10,padding:"3px 10px",borderRadius:20,whiteSpace:"nowrap",borderColor:!catFilter&&!soloAlertas?C.blue:C.border,color:!catFilter&&!soloAlertas?C.blueText:C.muted,background:!catFilter&&!soloAlertas?C.blueDim:"none"}}>Todos</button>
          <button onClick={()=>setSoloAlertas(v=>!v)} style={{...S.btnGhost,fontSize:10,padding:"3px 10px",borderRadius:20,whiteSpace:"nowrap",borderColor:soloAlertas?C.orange:C.border,color:soloAlertas?C.orange:C.muted,background:soloAlertas?"#2a1500":"none"}}>⚠️ Stock bajo</button>
          {CATS_INV.map(cat=>(
            <button key={cat} onClick={()=>setCatFilter(catFilter===cat?"":cat)} style={{...S.btnGhost,fontSize:10,padding:"3px 10px",borderRadius:20,whiteSpace:"nowrap",borderColor:catFilter===cat?C.blue:C.border,color:catFilter===cat?C.blueText:C.muted,background:catFilter===cat?C.blueDim:"none"}}>{cat}</button>
          ))}
        </div>

        {/* Lista productos */}
        {prodFiltrados.length===0&&<div style={{textAlign:"center",padding:"40px 0",color:C.dim}}>Sin productos</div>}
        {prodFiltrados.map(p=>(
          <div key={p._id} onClick={()=>{setSelId(p._id);setVista("detalle");}} style={{...S.card,cursor:"pointer",borderLeft:`3px solid ${stockColor(p)}`}}
            onMouseEnter={e=>e.currentTarget.style.borderColor=C.blueText}
            onMouseLeave={e=>e.currentTarget.style.borderColor=stockColor(p)}>
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:10}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:700,marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.nombre}</div>
                <div style={{fontSize:10,color:C.muted,marginBottom:4}}>Ref: {p.referencia} · {p.categoria} · {p.ubicacion}</div>
                {p.stock<=p.stockMin&&(
                  <div style={{fontSize:10,color:p.stock===0?C.red:C.orange,fontWeight:700}}>
                    {p.stock===0?"🚫 AGOTADO":`⚠️ Stock bajo (mín: ${p.stockMin} ${p.unidad})`}
                  </div>
                )}
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={{fontSize:22,fontWeight:800,color:stockColor(p),lineHeight:1}}>{p.stock}</div>
                <div style={{fontSize:10,color:C.dim}}>{p.unidad}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      {esAdmin&&(
        <button onClick={()=>setVista("nuevo")} style={{position:"fixed",bottom:72,left:"50%",transform:"translateX(-50%)",...S.btn,padding:"12px 28px",borderRadius:40,fontSize:13,boxShadow:"0 4px 24px #3b82f644",fontFamily:mono,zIndex:100}}>
          + NUEVO PRODUCTO
        </button>
      )}
    </div>
  );

  // ── VISTA DETALLE ──
  if(vista==="detalle"&&prodActual) return(
    <div style={{paddingBottom:80}}>
      <div style={{padding:"10px 14px 0"}}><button onClick={()=>setVista("lista")} style={{...S.btnGhost,fontSize:11,padding:"5px 10px"}}>← Volver</button></div>
      <div style={{padding:"10px 14px 0"}}>
        {/* Cabecera producto */}
        <div style={{...S.card,borderLeft:`3px solid ${stockColor(prodActual)}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
            <div style={{flex:1}}>
              <div style={{fontSize:16,fontWeight:800,marginBottom:4}}>{prodActual.nombre}</div>
              <div style={{fontSize:11,color:C.muted,marginBottom:2}}>Ref: <span style={{color:C.blueText}}>{prodActual.referencia}</span></div>
              <div style={{fontSize:11,color:C.muted,marginBottom:2}}>{prodActual.categoria} · {prodActual.ubicacion}</div>
              {prodActual.stock<=prodActual.stockMin&&(
                <div style={{fontSize:11,color:prodActual.stock===0?C.red:C.orange,fontWeight:700,marginTop:4}}>
                  {prodActual.stock===0?"🚫 AGOTADO":`⚠️ Stock mínimo: ${prodActual.stockMin} ${prodActual.unidad}`}
                </div>
              )}
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:36,fontWeight:800,color:stockColor(prodActual),lineHeight:1}}>{prodActual.stock}</div>
              <div style={{fontSize:12,color:C.muted}}>{prodActual.unidad}</div>
            </div>
          </div>
          {/* Barra stock */}
          <div style={{height:6,background:"#0f1117",borderRadius:3,overflow:"hidden"}}>
            <div style={{height:"100%",background:stockColor(prodActual),borderRadius:3,width:`${Math.min(100,prodActual.stockMin>0?(prodActual.stock/Math.max(prodActual.stock,prodActual.stockMin*2))*100:prodActual.stock>0?100:0)}%`,transition:"width 0.4s"}}/>
          </div>
          <div style={{fontSize:10,color:C.dim,marginTop:4}}>Stock mínimo: {prodActual.stockMin} {prodActual.unidad}</div>
        </div>

        {/* Botones movimiento */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
          <button onClick={()=>{setFormMov({tipo:"entrada",cantidad:1,vehiculo:"",motivo:"",nota:""});setErrForm("");setVista("movimiento");}}
            style={{...S.btn,padding:"12px",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
            ⬆ Entrada
          </button>
          <button onClick={()=>{setFormMov({tipo:"salida",cantidad:1,vehiculo:"",motivo:"",nota:""});setErrForm("");setVista("movimiento");}}
            style={{...S.btn,padding:"12px",fontSize:13,background:"#2a1500",borderColor:C.orange,color:C.orange,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
            ⬇ Salida
          </button>
        </div>

        {/* Historial movimientos */}
        <div style={{...S.label,marginBottom:8}}>Historial ({movsProd.length})</div>
        {movsProd.length===0&&<div style={{fontSize:12,color:C.dim,padding:"16px 0",textAlign:"center"}}>Sin movimientos registrados</div>}
        {movsProd.map(m=>{
          const u=getUser(m.usuarioId);
          return(
            <div key={m.id} style={{...S.card,borderLeft:`3px solid ${m.tipo==="entrada"?C.green:C.orange}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:16}}>{m.tipo==="entrada"?"⬆":"⬇"}</span>
                  <div>
                    <span style={{fontSize:13,fontWeight:700,color:m.tipo==="entrada"?C.green:C.orange}}>{m.tipo==="entrada"?"+":"-"}{m.cantidad} {prodActual.unidad}</span>
                    {m.vehiculo&&<span style={{fontSize:11,color:C.muted,marginLeft:8}}>🚛 {m.vehiculo.split("·")[0].trim()}</span>}
                  </div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:10,color:C.dim}}>{timeAgo(m.fecha)}</div>
                  <div style={{fontSize:10,color:C.muted}}>{m.stockAntes} → {m.stockDespues} {prodActual.unidad}</div>
                </div>
              </div>
              {m.motivo&&<div style={{fontSize:11,color:C.muted,marginBottom:2}}>{m.motivo}</div>}
              {m.nota&&<div style={{fontSize:11,color:"#8b5cf6"}}>📝 {m.nota}</div>}
              <div style={{display:"flex",alignItems:"center",gap:6,marginTop:4}}>
                <div style={{width:18,height:18,borderRadius:"50%",background:C.blueDim,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,color:C.blueText,fontWeight:700}}>{avatarOf(u)}</div>
                <span style={{fontSize:10,color:C.dim}}>{u.nombre}</span>
              </div>
            </div>
          );
        })}

        {esAdmin&&(
          <button onClick={()=>eliminarProducto(prodActual.id)} style={{background:"#2d1515",border:`1px solid ${C.red}44`,color:"#f87171",width:"100%",padding:"10px",borderRadius:8,fontSize:12,cursor:"pointer",fontFamily:mono,marginTop:8}}>
            Eliminar producto
          </button>
        )}
      </div>
    </div>
  );

  // ── VISTA MOVIMIENTO ──
  if(vista==="movimiento"&&prodActual) return(
    <div style={{paddingBottom:80}}>
      <div style={{padding:"10px 14px 0"}}><button onClick={()=>setVista("detalle")} style={{...S.btnGhost,fontSize:11,padding:"5px 10px"}}>← Volver</button></div>
      <div style={{padding:"10px 14px"}}>
        <div style={{...S.card,borderLeft:`3px solid ${formMov.tipo==="entrada"?C.green:C.orange}`,marginBottom:14}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:2}}>{prodActual.nombre}</div>
          <div style={{fontSize:11,color:C.muted}}>Stock actual: <span style={{color:stockColor(prodActual),fontWeight:700}}>{prodActual.stock} {prodActual.unidad}</span></div>
        </div>

        {/* Tipo */}
        <div style={{marginBottom:14}}>
          <label style={S.label}>Tipo de movimiento</label>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <button onClick={()=>setFormMov({...formMov,tipo:"entrada"})} style={{...S.btn,padding:"12px",background:formMov.tipo==="entrada"?C.greenDim:"none",borderColor:formMov.tipo==="entrada"?C.green:C.border,color:formMov.tipo==="entrada"?C.green:C.muted}}>⬆ Entrada</button>
            <button onClick={()=>setFormMov({...formMov,tipo:"salida"})} style={{...S.btn,padding:"12px",background:formMov.tipo==="salida"?"#2a1500":"none",borderColor:formMov.tipo==="salida"?C.orange:C.border,color:formMov.tipo==="salida"?C.orange:C.muted}}>⬇ Salida</button>
          </div>
        </div>

        {/* Cantidad */}
        <div style={{marginBottom:14}}>
          <label style={S.label}>Cantidad ({prodActual.unidad})</label>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <button onClick={()=>setFormMov({...formMov,cantidad:Math.max(1,(parseInt(formMov.cantidad)||1)-1)})} style={{...S.btnGhost,padding:"10px 16px",fontSize:18,fontWeight:700}}>−</button>
            <input type="number" min="1" value={formMov.cantidad} onChange={e=>setFormMov({...formMov,cantidad:e.target.value})} style={{...S.input,textAlign:"center",fontSize:20,fontWeight:800,flex:1}}/>
            <button onClick={()=>setFormMov({...formMov,cantidad:(parseInt(formMov.cantidad)||0)+1})} style={{...S.btnSm,padding:"10px 16px",fontSize:18,fontWeight:700}}>+</button>
          </div>
        </div>

        {/* Vehículo (para salidas) */}
        {formMov.tipo==="salida"&&(
          <div style={{marginBottom:14}}>
            <label style={S.label}>Vehículo (opcional)</label>
            <select value={formMov.vehiculo} onChange={e=>setFormMov({...formMov,vehiculo:e.target.value})} style={S.input}>
              <option value="">— Sin vehículo —</option>
              {VEHICULOS.map(v=><option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        )}

        {/* Motivo */}
        <div style={{marginBottom:14}}>
          <label style={S.label}>Motivo {formMov.tipo==="salida"?"(uso, reparación...)":"(compra, devolución...)"}</label>
          <input value={formMov.motivo} onChange={e=>setFormMov({...formMov,motivo:e.target.value})} placeholder={formMov.tipo==="salida"?"Ej: Cambio de aceite VH-001":"Ej: Pedido proveedor"} style={S.input}/>
        </div>

        {/* Nota */}
        <div style={{marginBottom:20}}>
          <label style={S.label}>Nota adicional</label>
          <textarea value={formMov.nota} onChange={e=>setFormMov({...formMov,nota:e.target.value})} placeholder="Observaciones..." rows={2} style={{...S.input,resize:"none"}}/>
        </div>

        {errForm&&<div style={{background:"#2d1515",color:"#f87171",borderRadius:8,padding:"10px",fontSize:12,marginBottom:12}}>{errForm}</div>}
        <button onClick={registrarMovimiento} style={{...S.btn,width:"100%",padding:13,fontSize:14,background:formMov.tipo==="entrada"?C.greenDim:"#2a1500",borderColor:formMov.tipo==="entrada"?C.green:C.orange,color:formMov.tipo==="entrada"?C.green:C.orange}}>
          {formMov.tipo==="entrada"?"⬆ REGISTRAR ENTRADA":"⬇ REGISTRAR SALIDA"}
        </button>
      </div>
    </div>
  );

  // ── VISTA NUEVO PRODUCTO ──
  if(vista==="nuevo") return(
    <div style={{paddingBottom:80}}>
      <div style={{padding:"10px 14px 0"}}><button onClick={()=>setVista("lista")} style={{...S.btnGhost,fontSize:11,padding:"5px 10px"}}>← Volver</button></div>
      <div style={{padding:"10px 14px"}}>
        <div style={{marginBottom:14}}><label style={S.label}>Nombre *</label><input value={formProd.nombre} onChange={e=>setFormProd({...formProd,nombre:e.target.value})} placeholder="Ej: Filtro de aceite Mann W713" style={S.input}/></div>
        <div style={{marginBottom:14}}><label style={S.label}>Referencia *</label><input value={formProd.referencia} onChange={e=>setFormProd({...formProd,referencia:e.target.value})} placeholder="Ej: FO-4521" style={S.input}/></div>
        <div style={{marginBottom:14}}>
          <label style={S.label}>Categoría</label>
          <select value={formProd.categoria} onChange={e=>setFormProd({...formProd,categoria:e.target.value})} style={S.input}>
            {CATS_INV.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
          <div><label style={S.label}>Unidad</label><input value={formProd.unidad} onChange={e=>setFormProd({...formProd,unidad:e.target.value})} placeholder="ud, litro, kg..." style={S.input}/></div>
          <div><label style={S.label}>Ubicación</label><input value={formProd.ubicacion} onChange={e=>setFormProd({...formProd,ubicacion:e.target.value})} placeholder="Estante A1" style={S.input}/></div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:20}}>
          <div><label style={S.label}>Stock inicial</label><input type="number" min="0" value={formProd.stock} onChange={e=>setFormProd({...formProd,stock:e.target.value})} style={S.input}/></div>
          <div><label style={S.label}>Stock mínimo ⚠️</label><input type="number" min="0" value={formProd.stockMin} onChange={e=>setFormProd({...formProd,stockMin:e.target.value})} style={S.input}/></div>
        </div>
        {errForm&&<div style={{background:"#2d1515",color:"#f87171",borderRadius:8,padding:"10px",fontSize:12,marginBottom:12}}>{errForm}</div>}
        <button onClick={guardarProducto} style={{...S.btn,width:"100%",padding:13,fontSize:14}}>AÑADIR PRODUCTO</button>
      </div>
    </div>
  );

  return null;
}

// ── PANEL ADMIN RUTAS ─────────────────────────────────────────────
function PanelAdminRutas({planes, usuarios, deletePlan}){
  const [tipoFiltro, setTipoFiltro] = useState("");
  const [mesFiltro,  setMesFiltro]  = useState("");
  const [expandId,   setExpandId]   = useState(null);

  const TIPOS = TIPOS_TRABAJO;
  const meses = [...new Set(planes.map(p=>p.mes).filter(Boolean))].sort((a,b)=>b.localeCompare(a));
  const filtrados = planes.filter(p =>
    (!tipoFiltro || p.tipo === tipoFiltro) &&
    (!mesFiltro  || p.mes  === mesFiltro)
  );

  // Estadísticas globales
  const planesKML = planes.filter(p => p.tipo !== "corr");
  const totalParadas = planesKML.reduce((s,p) => s + (p.ubicaciones?.length||0), 0);
  const realizadas   = planesKML.reduce((s,p) => s + (p.ubicaciones?.filter(u=>u.realizado).length||0), 0);
  const tasaGlobal   = totalParadas ? Math.round(realizadas/totalParadas*100) : 0;

  function getUser(id){ return usuarios.find(u=>u.id===id)||{nombre:"?",apellidos:""}; }

  function exportCSV(){
    const rows = [["Tipo","Nombre","Turno","Fecha","Total Paradas","Realizadas","% Completado"]];
    filtrados.forEach(p => {
      const tot  = p.ubicaciones?.length || 0;
      const real = p.ubicaciones?.filter(u=>u.realizado).length || 0;
      rows.push([
        TIPOS.find(t=>t.key===p.tipo)?.label||p.tipo,
        p.nombre, p.turno||"", p.diaServicio||"",
        tot, real, tot ? Math.round(real/tot*100)+"%" : "—"
      ]);
    });
    const csv = rows.map(r=>r.join(";")).join("\n");
    const blob = new Blob(["\uFEFF"+csv], {type:"text/csv;charset=utf-8"});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "operantia-rutas.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{paddingBottom:90}}>
      <div style={{padding:"12px 14px 0"}}>

        {/* KPIs globales */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6,marginBottom:14}}>
          {[
            {l:"Planes",    v:planesKML.length,   c:C.cyanText},
            {l:"Paradas",   v:totalParadas,        c:C.text},
            {l:"Realizadas",v:realizadas,          c:C.green},
            {l:"Global",    v:tasaGlobal+"%",      c:tasaGlobal===100?C.green:tasaGlobal>50?C.orange:C.red},
          ].map(s=>(
            <div key={s.l} style={{background:C.surface2,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 6px",textAlign:"center"}}>
              <div style={{fontSize:18,fontWeight:800,color:s.c}}>{s.v}</div>
              <div style={{fontSize:8,color:C.dim,textTransform:"uppercase",letterSpacing:1,marginTop:2}}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* Barra progreso global */}
        <div style={{height:5,background:C.surface2,borderRadius:3,overflow:"hidden",marginBottom:14}}>
          <div style={{height:"100%",borderRadius:3,width:`${tasaGlobal}%`,transition:"width .4s",
            background:`linear-gradient(90deg,${C.cyan},${C.green})`}}/>
        </div>

        {/* Filtros + exportar */}
        <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
          <select value={tipoFiltro} onChange={e=>setTipoFiltro(e.target.value)}
            style={{...S.input,flex:1,minWidth:140,fontSize:11,padding:"7px 10px"}}>
            <option value="">Todos los tipos</option>
            {TIPOS.map(t=><option key={t.key} value={t.key}>{t.icon} {t.label}</option>)}
          </select>
          <select value={mesFiltro} onChange={e=>setMesFiltro(e.target.value)}
            style={{...S.input,flex:1,minWidth:120,fontSize:11,padding:"7px 10px"}}>
            <option value="">Todos los meses</option>
            {meses.map(m=><option key={m} value={m}>{fmtMes(m)}</option>)}
          </select>
          <button onClick={exportCSV} style={{...S.btnSm,background:C.greenDim,borderColor:`${C.green}44`,color:C.green,whiteSpace:"nowrap"}}>
            ⬇ CSV
          </button>
        </div>

        {/* Lista planes */}
        {filtrados.length === 0 && (
          <div style={{textAlign:"center",padding:"40px 0",color:C.dim,fontSize:13}}>Sin planes para este filtro</div>
        )}

        {filtrados.map(plan => {
          const tipo = TIPOS.find(t=>t.key===plan.tipo);
          const ubs  = plan.ubicaciones||[];
          const tot  = ubs.length;
          const real = ubs.filter(u=>u.realizado).length;
          const tasa = tot ? Math.round(real/tot*100) : 0;
          const col  = tasa===100?C.green:tasa>50?C.orange:C.red;
          const isExp = expandId === plan._id;
          const totalQR = ubs.reduce((s,u)=>s+(u.elementos?.length||0),0);
          const realizadosQR = ubs.reduce((s,u)=>s+(u.elementos?.filter(e=>e.realizado).length||0),0);

          return (
            <div key={plan._id} style={{...S.card,marginBottom:8,borderLeft:`3px solid ${tasa===100?C.green:(tipo?.color||C.cyan)}`}}>
              {/* Cabecera */}
              <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                <div style={{flex:1,minWidth:0,cursor:"pointer"}} onClick={()=>setExpandId(isExp?null:plan._id)}>
                  <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:4,flexWrap:"wrap"}}>
                    <span style={{fontSize:13}}>{tipo?.icon||"📁"}</span>
                    <span style={{fontSize:10,padding:"2px 8px",borderRadius:10,background:(tipo?.color||C.cyan)+"18",color:tipo?.color||C.cyan,border:`1px solid ${(tipo?.color||C.cyan)}33`}}>
                      {tipo?.label||plan.tipo}
                    </span>
                    {plan.turno&&<span style={{fontSize:10,color:C.muted}}>{plan.turno}</span>}
                    <span style={{fontSize:10,color:C.dim}}>{plan.diaServicio}</span>
                    {tasa===100&&<span style={{fontSize:10,color:C.green}}>✓ Completado</span>}
                  </div>
                  <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {plan.nombre}
                  </div>
                  {/* Barra progreso */}
                  <div style={{height:3,background:C.surface2,borderRadius:2,overflow:"hidden",marginBottom:4}}>
                    <div style={{height:"100%",background:col,borderRadius:2,width:`${tasa}%`,transition:"width .4s"}}/>
                  </div>
                  <div style={{display:"flex",gap:16,fontSize:10,color:C.dim}}>
                    <span>{real}/{tot} paradas <span style={{color:col,fontWeight:700}}>({tasa}%)</span></span>
                    <span>{realizadosQR}/{totalQR} QRs</span>
                  </div>
                </div>
                <div style={{display:"flex",gap:6,flexShrink:0}}>
                  <button onClick={()=>setExpandId(isExp?null:plan._id)}
                    style={{...S.btnGhost,fontSize:10,padding:"4px 8px"}}>
                    {isExp?"▲":"▼"}
                  </button>
                  <button onClick={()=>{if(window.confirm("¿Eliminar este plan?"))deletePlan(plan._id);}}
                    style={{background:"#2d1515",border:`1px solid ${C.red}44`,color:"#f87171",padding:"4px 8px",borderRadius:6,fontSize:11,cursor:"pointer",fontFamily:font}}>
                    ✕
                  </button>
                </div>
              </div>

              {/* Detalle expandido — lista de paradas */}
              {isExp && ubs.length > 0 && (
                <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.border}`}}>
                  <div style={{fontSize:9,color:C.dim,letterSpacing:1.5,textTransform:"uppercase",marginBottom:8}}>
                    Paradas ({ubs.length})
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:300,overflowY:"auto"}}>
                    {[...ubs].sort((a,b)=>a.orden-b.orden).map((u,i)=>(
                      <div key={u.id||i} style={{
                        display:"flex",alignItems:"center",gap:10,
                        background:u.realizado?C.greenDim:C.surface2,
                        border:`1px solid ${u.realizado?C.green+"33":C.border}`,
                        borderRadius:7,padding:"7px 10px",
                      }}>
                        <div style={{width:22,height:22,borderRadius:"50%",flexShrink:0,
                          background:u.realizado?C.greenDim:C.blueDim,
                          border:`1px solid ${u.realizado?C.green:C.blue}44`,
                          display:"flex",alignItems:"center",justifyContent:"center",
                          fontSize:9,fontWeight:700,color:u.realizado?C.green:C.blueText}}>
                          {u.orden}
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:11,fontWeight:600,color:u.realizado?C.green:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                            {u.calle} {u.num}
                          </div>
                          <div style={{fontSize:9,color:C.muted}}>{u.barri} · {u.pa} · {u.elementos?.length||0} QRs</div>
                        </div>
                        <div style={{fontSize:10,color:u.realizado?C.green:C.dim,flexShrink:0}}>
                          {u.realizado
                            ? <span>✓ {u.realizadoEn ? timeAgo(u.realizadoEn) : ""}</span>
                            : <span style={{color:C.dim}}>Pendiente</span>
                          }
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── LOGIN ─────────────────────────────────────────────────────────
const AUTH_ERRORS = {
  "auth/invalid-credential":"Credenciales incorrectas",
  "auth/user-disabled":"Cuenta desactivada",
  "auth/too-many-requests":"Demasiados intentos, espera un momento",
  "auth/invalid-email":"Email inválido",
};

function Login(){
  const [email,setEmail]=useState("");const [pw,setPw]=useState("");
  const [err,setErr]=useState("");const [loading,setLoading]=useState(false);
  const go=async()=>{
    if(!email||!pw){setErr("Introduce email y contraseña");return;}
    setLoading(true);setErr("");
    try{ await signInWithEmailAndPassword(auth,email.trim().toLowerCase(),pw); }
    catch(e){ setErr(AUTH_ERRORS[e.code]||"Error al iniciar sesión"); setLoading(false); }
  };
  return(
    <div style={{fontFamily:font,background:C.bg,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:24,overflow:"hidden"}}>
      <div style={{width:"100%",maxWidth:360,animation:"fadeUp .3s ease both"}}>
        <div style={{marginBottom:32}}>
          <div style={{fontSize:11,color:C.dim,letterSpacing:2,textTransform:"uppercase",marginBottom:8,fontWeight:500}}>Fleet Management</div>
          <div style={{fontSize:26,fontWeight:700,color:C.text,letterSpacing:-.5,lineHeight:1}}>Operantia</div>
        </div>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:24,boxShadow:"0 16px 48px rgba(0,0,0,.5)"}}>
          <div style={{marginBottom:14}}>
            <label style={S.label}>Email</label>
            <input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="tu@empresa.com" autoComplete="email"
              onKeyDown={e=>e.key==="Enter"&&go()}
              style={{...S.input,borderColor:email?`${C.blue}44`:C.border}}
              onFocus={e=>e.target.style.borderColor=`${C.blue}66`}
              onBlur={e=>e.target.style.borderColor=email?`${C.blue}44`:C.border}/>
          </div>
          <div style={{marginBottom:20}}>
            <label style={S.label}>Contraseña</label>
            <input value={pw} onChange={e=>setPw(e.target.value)} type="password" placeholder="••••••••" autoComplete="current-password"
              onKeyDown={e=>e.key==="Enter"&&go()}
              style={{...S.input,borderColor:pw?`${C.blue}44`:C.border}}
              onFocus={e=>e.target.style.borderColor=`${C.blue}66`}
              onBlur={e=>e.target.style.borderColor=pw?`${C.blue}44`:C.border}/>
          </div>
          {err&&<div style={{background:"rgba(248,113,113,0.08)",border:"1px solid rgba(248,113,113,0.25)",color:C.red,borderRadius:7,padding:"9px 13px",fontSize:12,marginBottom:16}}>⚠ {err}</div>}
          <button onClick={go} disabled={loading} style={{...S.btn,width:"100%",padding:"12px",fontSize:13,fontWeight:600,background:loading?C.blueDim:C.blue,borderColor:"transparent",color:loading?C.blueText:"#fff"}}>
            {loading?<span style={{display:"flex",alignItems:"center",gap:8,justifyContent:"center"}}><span style={{display:"inline-block",width:13,height:13,border:"2px solid rgba(163,196,252,0.3)",borderTopColor:C.blueText,borderRadius:"50%",animation:"spin .6s linear infinite"}}/>Accediendo…</span>:"Acceder"}
          </button>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}`}</style>
        </div>
      </div>
    </div>
  );
}

// ── APP ───────────────────────────────────────────────────────────
export default function App(){
  const [sesion,setSesion]=useState(undefined); // undefined=cargando, null=no autenticado
  const [usuarios,setUsuarios]=useState([]);
  const [tab,setTab]=useState("rutas");

  // Firebase Auth — escuchar cambios de sesión
  useEffect(()=>{
    return onAuthStateChanged(auth,async user=>{
      if(user){
        try{
          const snap=await getDoc(doc(db,"usuarios",user.uid));
          if(snap.exists()&&snap.data().activo!==false){
            setSesion({uid:user.uid,...snap.data()});
          }else{
            await signOut(auth); setSesion(null);
          }
        }catch{ setSesion(null); }
      }else{ setSesion(null); }
    });
  },[]);

  // Cargar usuarios de la misma org en tiempo real
  useEffect(()=>{
    if(!sesion?.org_id) return;
    const q=query(collection(db,"usuarios"),where("org_id","==",sesion.org_id));
    return onSnapshot(q,snap=>{
      setUsuarios(snap.docs.map(d=>({...d.data(),_id:d.id,id:d.id})));
    });
  },[sesion?.org_id]);

  const {data:planes}=useCollection("planes","fechaSubida",sesion?.org_id);

  async function addPlan(plan){ await fbAdd("planes",{...plan,org_id:sesion.org_id}); }
  async function updatePlan(plan){ await fbUpdate("planes",plan._id,plan); }
  async function deletePlan(id){ await fbDelete("planes",id); }

  // Pantalla de carga mientras Firebase inicializa auth
  if(sesion===undefined) return(
    <div style={{background:C.bg,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:font}}>
      <div style={{color:C.muted,fontSize:13}}>Cargando…</div>
    </div>
  );

  if(!sesion) return <Login/>;

  const esAdmin=sesion.rol==="admin";
  const TABS=[
    {key:"rutas",      icon:"🗺️", label:"Rutas"},
    {key:"incidencias",icon:"📋", label:"Incidencias"},
    {key:"inventario", icon:"📦", label:"Inventario"},
    ...(esAdmin?[{key:"admin",icon:"⚙️",label:"Admin"}]:[]),
  ];
  const TAB_TITLES={rutas:"Rutas de servicio",incidencias:"Canal de incidencias",inventario:"Inventario",admin:"Panel de administración"};

  return(
    <div style={S.page}>
      <div style={{...S.header,background:"rgba(22,27,39,0.96)",borderBottom:`1px solid ${C.border}`}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{fontSize:11,color:C.dim,letterSpacing:2,textTransform:"uppercase",fontWeight:600}}>Operantia</div>
          <div style={{width:1,height:16,background:C.border2}}/>
          <div style={{fontSize:14,fontWeight:600,color:C.text}}>{TAB_TITLES[tab]||tab}</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:11,color:C.text,fontWeight:500}}>{sesion.nombre}</div>
            <div style={{fontSize:9,color:C.dim,letterSpacing:.5,textTransform:"uppercase"}}>{sesion.rol}</div>
          </div>
          <div onClick={()=>signOut(auth)} title="Cerrar sesión" style={{width:34,height:34,borderRadius:"50%",cursor:"pointer",background:C.surface2,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:600,color:C.muted,transition:"all .15s"}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor=C.border2;e.currentTarget.style.color=C.text;}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.color=C.muted;}}>
            {avatarOf(sesion)}
          </div>
        </div>
      </div>

      {tab==="rutas"&&<ListaPlanes planes={planes} addPlan={addPlan} updatePlan={updatePlan} deletePlan={deletePlan} sesion={sesion} usuarios={usuarios}/>}
      {tab==="incidencias"&&<ModuloIncidencias sesion={sesion} usuarios={usuarios}/>}
      {tab==="inventario"&&<ModuloInventario sesion={sesion} usuarios={usuarios}/>}
      {tab==="admin"&&esAdmin&&<PanelAdminRutas planes={planes} usuarios={usuarios} deletePlan={deletePlan}/>}

      <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:520,background:"rgba(22,27,39,0.97)",borderTop:`1px solid ${C.border}`,display:"flex",zIndex:200,backdropFilter:"blur(16px)"}}>
        {TABS.map(t=>{
          const active=tab===t.key;
          return(
            <button key={t.key} onClick={()=>setTab(t.key)} style={{flex:1,padding:"10px 0 9px",background:"none",border:"none",cursor:"pointer",fontFamily:font,display:"flex",flexDirection:"column",alignItems:"center",gap:3,position:"relative",transition:"all .15s"}}>
              {active&&<div style={{position:"absolute",top:0,left:"50%",transform:"translateX(-50%)",width:24,height:2,background:C.blue,borderRadius:1}}/>}
              <span style={{fontSize:19,lineHeight:1,filter:active?"none":"grayscale(1) opacity(.4)",transition:"filter .15s"}}>{t.icon}</span>
              <span style={{fontSize:9,letterSpacing:.5,textTransform:"uppercase",fontWeight:600,color:active?C.blueText:C.dim,transition:"color .15s"}}>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}