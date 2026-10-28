// App del conductor: piezas de pantalla compartidas (botón, tooltip de gráficos, mapa).
import { useState, useRef, useEffect } from "react";
import { C, barrioColor, font, mono } from "./comun.js";
import { useUltimo } from "../use-ultimo.js";
import { alfa } from "../tema.js";
import { tono } from "../tema.js";
import { lineaDe } from "../viaria/callejero.js";

// Componente base de botón con hover
export const Btn = ({children, onClick, style={}, variant="primary", size="md", disabled=false, title=""}) => {
  const [hov, setHov] = useState(false);
  const base = {
    fontFamily: font, fontWeight:600, cursor: disabled?"not-allowed":"pointer",
    border:"none", display:"inline-flex", alignItems:"center", justifyContent:"center",
    gap:6, transition:"all .15s ease", letterSpacing:.3,
    opacity: disabled ? .45 : 1,
  };
  const sizes = {
    xs: {padding:"4px 10px", fontSize:10, borderRadius:4},
    sm: {padding:"6px 12px", fontSize:11, borderRadius:8},
    md: {padding:"10px 18px", fontSize:13, borderRadius:8},
    lg: {padding:"12px 22px", fontSize:15, borderRadius:8},
    xl: {padding:"14px 30px", fontSize:15, borderRadius:8},
  };
  const variants = {
    primary:  { background: hov?tono("#263166", "#e7e9f6"):C.blueDim, color:C.blueText, border:`1px solid ${C.blue}44` },
    success:  { background: hov?"rgba(63,207,142,0.15)":C.greenDim, color:C.green, border:`1px solid ${C.green}44` },
    danger:   { background: hov?"rgba(242,109,109,0.15)":"rgba(242,109,109,0.06)", color:C.red, border:`1px solid ${C.red}44` },
    ghost:    { background: hov?alfa(0.06):"transparent", color: hov?C.text:C.muted, border:`1px solid ${C.border}` },
    warning:  { background: hov?"rgba(245,158,91,0.15)":"rgba(245,158,91,0.06)", color:C.orange, border:`1px solid ${C.orange}44` },
    subtle:   { background: hov?alfa(0.06):C.surface2, color:C.muted, border:`1px solid ${C.border}` },
  };
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{...base, ...sizes[size], ...variants[variant], ...style}}>
      {children}
    </button>
  );
};

export const CTip = ({active,payload,label}) => {
  if(!active||!payload?.length) return null;
  return (
    <div style={{background:C.card,border:`1px solid ${C.border2}`,borderRadius:8,padding:"10px 14px",fontSize:12,color:C.text,boxShadow:"0 8px 32px rgba(0,0,0,.5)"}}>
      {label&&<div style={{color:C.muted,marginBottom:5,fontSize:12,letterSpacing:0,textTransform:"none"}}>{label}</div>}
      {payload.map((p,i)=><div key={i} style={{color:p.color||C.blueText,fontWeight:600}}>{p.name}: {p.value}</div>)}
    </div>
  );
};

// ── MAPA LEAFLET ──────────────────────────────────────────────────
// El recorrido por carretera de las paradas, en orden (OSRM, en tramos de 80
// puntos): la línea sigue las calles, no va recta de una parada a otra.
const TRAZADOS = new Map();
async function trazadoPorCarretera(pts){
  const clave=pts.map(p=>`${(+p.lng).toFixed(5)},${(+p.lat).toFixed(5)}`).join(";");
  if(TRAZADOS.has(clave))return TRAZADOS.get(clave);
  const linea=[];
  let km=0,min=0;
  for(let i=0;i<pts.length-1;i+=79){
    const tramo=pts.slice(i,i+80);
    const r=await fetch(`https://router.project-osrm.org/route/v1/driving/${tramo.map(p=>`${p.lng},${p.lat}`).join(";")}?overview=full&geometries=geojson`);
    const j=await r.json();
    if(j.code!=="Ok"||!j.routes?.[0]?.geometry)return null;
    linea.push(...j.routes[0].geometry.coordinates.map(([lng,lat])=>[lat,lng]));
    km+=j.routes[0].distance/1000; min+=j.routes[0].duration/60;
  }
  const r={linea,km,min};
  TRAZADOS.set(clave,r);
  return r;
}

export function MapaLeaflet({ubicaciones,recorrido,selId,onSelect,height=260}) {
  const [trazado,setTrazado]=useState(null); // { clave, linea }
  const clavePts=ubicaciones.filter(u=>u.lat&&u.lng).map(u=>`${u.lat},${u.lng}`).join(";");
  useEffect(()=>{
    const pts=ubicaciones.filter(u=>u.lat&&u.lng);
    if(pts.length<2)return;
    let vivo=true;
    trazadoPorCarretera(pts).then(r=>{if(vivo)setTrazado({clave:clavePts,linea:r?.linea||null,km:r?.km??null});}).catch(()=>{if(vivo)setTrazado({clave:clavePts,linea:null,km:null});});
    return()=>{vivo=false;};
  },[clavePts]); // eslint-disable-line react-hooks/exhaustive-deps
  const divRef=useRef(null);
  const mapRef=useRef(null);
  const layersRef=useRef([]);

  // el mapa se crea una vez; pinta siempre con las funciones de ahora
  const initMapRef = useUltimo(initMap);
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
      js.onload=()=>initMapRef.current();
      document.head.appendChild(js);
    } else { initMapRef.current(); }
  },[initMapRef]);

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
    const porCarretera=trazado?.clave===clavePts?trazado.linea:null;
    if(porCarretera?.length>1){
      // por las calles, como irá el camión
      const l=L.polyline(porCarretera,{color:C.blue,weight:4,opacity:0.75}).addTo(map);
      layersRef.current.push(l);
    } else if(pts.length>1){
      // mientras llega (o si no hay servicio de rutas): de parada a parada, a trazos
      const l=L.polyline(pts.map(u=>[u.lat,u.lng]),{color:tono("#2a3142", "#ebedf2"),weight:1.5,opacity:0.4,dashArray:"4,8"}).addTo(map);
      layersRef.current.push(l);
    }
    // limpieza viaria: cada tramo de calle como una línea (verde si ya está hecho)
    pts.forEach(u=>{
      const linea=lineaDe(u.geom);
      if(!linea)return;
      const l=L.polyline(linea,{color:u.realizado?C.green:selId===u.id?C.orange:C.blue,weight:6,opacity:0.85}).addTo(map).on("click",()=>onSelect(u.id));
      layersRef.current.push(l);
    });
    pts.forEach((u)=>{
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

  const drawLayersRef = useUltimo(drawLayers);
  useEffect(()=>{
    if(window.L&&mapRef.current) drawLayersRef.current();
    else { const t=setTimeout(()=>{if(window.L&&!mapRef.current)initMapRef.current();else if(window.L)drawLayersRef.current();},600); return()=>clearTimeout(t); }
  },[ubicaciones, selId, recorrido, trazado, drawLayersRef, initMapRef]);

  const ubicacionesRef = useUltimo(ubicaciones);
  useEffect(()=>{
    if(!mapRef.current||!selId)return;
    const u=ubicacionesRef.current.find(x=>x.id===selId);
    if(u) mapRef.current.setView([u.lat,u.lng],17,{animate:true});
  },[selId, ubicacionesRef]);

  return (
    <div style={{borderRadius:12,overflow:"hidden",border:`1px solid ${C.border}`}}>
      <div ref={divRef} style={{height,background:tono("#151a26", "#eaecf3")}}/>
      <div style={{background:C.card,padding:"7px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8,borderTop:`1px solid ${C.border}`}}>
        <div style={{display:"flex",gap:12}}>
          {[[C.green,"Realizada"],[C.blue,"Pendiente"],[C.orange,"Seleccionada"]].map(([c,l])=>(
            <div key={l} style={{display:"flex",alignItems:"center",gap:4}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:c}}/>
              <span style={{fontSize:10,color:C.muted}}>{l}</span>
            </div>
          ))}
        </div>
        {/* los km del recorrido por carretera (de la primera parada a la última, en orden) */}
        <span style={{fontSize:11,color:C.text,fontWeight:650,fontFamily:mono}} title="Recorrido por carretera de la primera parada a la última, en orden">
          {trazado?.clave===clavePts&&trazado.km!=null?`${trazado.km.toLocaleString("es-ES",{maximumFractionDigits:1})} km por carretera`:ubicaciones.filter(u=>u.lat&&u.lng).length>1?<span style={{color:C.dim,fontWeight:400}}>calculando km…</span>:null}
        </span>
        <span style={{fontSize:10,color:C.dim}}>{ubicaciones.filter(u=>u.realizado).length}/{ubicaciones.length}</span>
      </div>
    </div>
  );
}
