// App del conductor → Rutas: el detalle de una ruta (paradas, inspección, mapa).
import { Printer, Save, Scale } from "lucide-react";
import { Check, CheckCheck, ChevronLeft, ClipboardCheck, ClipboardList, Map as MapIcon, MessageCircle, MessageSquare, Mic, MicOff, Navigation, Phone, StickyNote } from "lucide-react";
import { useRef, useState } from "react";
import { C, PUNTOS_INSPECCION, S, timeAgo } from "./comun.js";
import { buscarEtiqueta, hayNfc } from "./rfid.js";
import { leerKg } from "../pesadas.js";
import { apuntarPesada } from "../pesadas-store.js";
import { MapaLeaflet } from "./ui.jsx";
import { NAVEGADORES, abrirNavegacion, elegirNavegador, enlacesContacto, navegadorElegido, telefonoDe, useDictado } from "./contacto.js";
import { sectorDe } from "../sector.js";

// Botón de dictar con la voz (solo si el móvil lo permite)
function BotonDictar({ d }) {
  if (!d.disponible) return null;
  return (
    <button type="button" onClick={d.alternar} style={{...S.btnGhost,display:"inline-flex",alignItems:"center",gap:6,borderColor:d.escuchando?C.red:C.border,color:d.escuchando?C.red:C.muted}} title="Dictar con la voz">
      {d.escuchando?<><MicOff size={14}/> Escuchando… toca para parar</>:<><Mic size={14}/> Dictar</>}
    </button>
  );
}

// Llamar, WhatsApp o SMS al cliente de la parada (si trae teléfono)
function ContactoParada({ ub }) {
  const t = telefonoDe(ub), e = enlacesContacto(t);
  if (!e) return null;
  const b = {...S.btnGhost,fontSize:10,padding:"4px 8px",display:"inline-flex",alignItems:"center",gap:4,textDecoration:"none"};
  return (
    <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:5,alignItems:"center"}} onClick={ev=>ev.stopPropagation()}>
      {ub.contacto&&<span style={{fontSize:10,color:C.muted,marginRight:2}}>{ub.contacto}</span>}
      <a href={e.llamar} style={b} title={`Llamar al ${t.ver}`}><Phone size={12}/> Llamar</a>
      <a href={e.whatsapp} target="_blank" rel="noreferrer" style={{...b,color:"#25d366",borderColor:"#25d36655"}} title="WhatsApp"><MessageCircle size={12}/> WhatsApp</a>
      <a href={e.sms} style={b} title="SMS"><MessageSquare size={12}/> SMS</a>
    </div>
  );
}

// ── LECTOR RFID ───────────────────────────────────────────────────
// Lector por USB/Bluetooth (escribe el código + Intro) o NFC del móvil: la
// etiqueta leída marca su contenedor y, si era el último, la parada.
function LectorRfid({ubicaciones,onLeido,codigo="código"}){
  const [texto,setTexto]=useState("");
  const [aviso,setAviso]=useState(null);
  const [nfc,setNfc]=useState(false);
  const nfcRef=useRef(null);
  function leer(codigo){
    const r=buscarEtiqueta(ubicaciones,codigo);
    if(!r){setAviso({ok:false,t:`${codigo}: no es de esta ruta`});return;}
    const ub=ubicaciones.find(u=>u.id===r.ubicId);
    if(!r.yaHecho) onLeido(r.ubicId,r.codiQR);
    setAviso({ok:true,t:`${r.yaHecho?"Ya estaba":"✓"} ${r.codiQR} · parada ${ub?.orden??""} ${ub?.calle||ub?.pa||""}`});
  }
  async function activarNfc(){
    if(nfc){nfcRef.current?.abort();setNfc(false);return;}
    try{
      const ctrl=new AbortController();nfcRef.current=ctrl;
      const lector=new window.NDEFReader();
      await lector.scan({signal:ctrl.signal});
      lector.onreading=e=>leer(e.serialNumber||"");
      setNfc(true);
    }catch(e){setAviso({ok:false,t:`NFC: ${e.message||e}`});}
  }
  return(
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"8px 10px",marginBottom:10}}>
      <div style={{display:"flex",gap:6,alignItems:"center"}}>
        <input value={texto} onChange={e=>setTexto(e.target.value)} placeholder={`Leer RFID / ${codigo}`}
          onKeyDown={e=>{if(e.key==="Enter"&&texto.trim()){leer(texto.trim());setTexto("");}}}
          style={{flex:1,minWidth:0,background:"#0d0f14",border:`1px solid ${C.border}`,color:C.text,borderRadius:7,padding:"8px 10px",fontSize:13,outline:"none"}}/>
        {hayNfc()&&<button onClick={activarNfc} style={{...(nfc?S.btnOk:S.btnGhost),fontSize:11,padding:"7px 10px",flexShrink:0}}>{nfc?"NFC activo":"NFC"}</button>}
      </div>
      {aviso&&<div style={{fontSize:11,marginTop:6,color:aviso.ok?C.green:C.red}}>{aviso.t}</div>}
    </div>
  );
}

// ── PESADA EN BÁSCULA ─────────────────────────────────────────────
// El conductor apunta el ticket de la planta: kg, planta, fracción y nº.
function ApuntarPesada({plan,sesion}){
  const [abierto,setAbierto]=useState(false);
  const [f,setF]=useState({kg:"",planta:"",fraccion:"",ticket:""});
  const [aviso,setAviso]=useState(null);
  async function guardar(){
    const kg=leerKg(f.kg);
    if(!kg){setAviso({ok:false,t:"Pon los kg del ticket"});return;}
    try{
      await apuntarPesada(plan.org_id||sesion.org_id,{...f,kg,vehiculo:plan.vehiculoNombre||"",projectId:plan.projectId||null,hora:new Date().toTimeString().slice(0,5)},{id:sesion.id,nombre:[sesion.nombre,sesion.apellidos].filter(Boolean).join(" ")});
      setF({kg:"",planta:f.planta,fraccion:f.fraccion,ticket:""});setAviso({ok:true,t:`✓ ${kg.toLocaleString("es-ES")} kg apuntados`});
    }catch(e){setAviso({ok:false,t:e.message||String(e)});}
  }
  const inp={background:"#0d0f14",border:`1px solid ${C.border}`,color:C.text,borderRadius:7,padding:"8px 10px",fontSize:13,outline:"none",minWidth:0};
  if(!abierto) return <button onClick={()=>setAbierto(true)} style={{...S.btnGhost,width:"100%",marginBottom:8}}><Scale size={15} style={{verticalAlign:"-3px",marginRight:6}}/>Apuntar pesada de báscula</button>;
  return(
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px",marginBottom:10}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
        <input inputMode="decimal" value={f.kg} onChange={e=>setF({...f,kg:e.target.value})} placeholder="Kg netos" style={inp}/>
        <input value={f.ticket} onChange={e=>setF({...f,ticket:e.target.value})} placeholder="Nº ticket" style={inp}/>
        <input value={f.planta} onChange={e=>setF({...f,planta:e.target.value})} placeholder="Planta" style={inp}/>
        <input value={f.fraccion} onChange={e=>setF({...f,fraccion:e.target.value})} placeholder="Fracción" style={inp}/>
      </div>
      <div style={{display:"flex",gap:6,marginTop:8}}>
        <button onClick={guardar} style={{...S.btnOk,flex:1}}>Guardar</button>
        <button onClick={()=>{setAbierto(false);setAviso(null);}} style={{...S.btnGhost}}>Cerrar</button>
      </div>
      {aviso&&<div style={{fontSize:11,marginTop:6,color:aviso.ok?C.green:C.red}}>{aviso.t}</div>}
    </div>
  );
}

// ── TARJETA UBICACIÓN ─────────────────────────────────────────────
function TarjetaUbic({ub,isSel,isExp,onSelect,onExpand,onMarcar,onMarcarQR,onNota,onNavegar,onParte,done}){
  const elReal=ub.elementos.filter(e=>e.realizado).length;
  const tieneParteIniciado = ub.parte && Object.values(ub.parte.checks||{}).some(Boolean);
  const parteFirmado = ub.parte?.firmado;
  return (
    <div id={"u-"+ub.id} style={{...S.card,opacity:done?0.85:1}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:9}}>
        <div onClick={onSelect} style={{width:30,height:30,borderRadius:"50%",flexShrink:0,cursor:"pointer",background:done?C.greenDim:isSel?"#2a1f00":C.blueDim,border:`2px solid ${done?C.green:isSel?C.orange:C.blue}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:done?C.green:isSel?C.orange:C.blueText}}>
          {ub.orden}
        </div>
        <div style={{flex:1,minWidth:0,cursor:"pointer"}} onClick={onSelect}>
          <div style={{fontSize:13,color:C.text,fontWeight:700,marginBottom:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ub.calle} {ub.num}</div>
          <div style={{fontSize:10,color:C.muted}}>{ub.barri}{ub.districte?" · "+ub.districte:""}</div>
          {ub.comentari&&<div style={{fontSize:10,color:C.dim,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ub.comentari}</div>}
          <ContactoParada ub={ub}/>
          {done&&ub.realizadoEn&&<div style={{fontSize:10,color:C.green,marginTop:2}}>✓ {timeAgo(ub.realizadoEn)}</div>}
          {ub.nota&&<div style={{fontSize:11,color:"#a78bfa",marginTop:2,display:"flex",alignItems:"center",gap:4}}><StickyNote size={12}/> {ub.nota}</div>}
          <div style={{fontSize:10,color:C.dim,marginTop:2}}>{ub.pa}</div>
          {onParte&&(
            <div style={{marginTop:4}}>
              {parteFirmado
                ? <span style={{fontSize:9,color:C.green,background:C.greenDim,border:`1px solid ${C.green}44`,borderRadius:10,padding:"2px 7px"}}><ClipboardCheck size={11} style={{verticalAlign:"-2px"}}/> Parte firmado</span>
                : tieneParteIniciado
                  ? <span style={{fontSize:9,color:C.orange,background:"#2a1500",border:`1px solid ${C.orange}44`,borderRadius:10,padding:"2px 7px"}}><ClipboardList size={11} style={{verticalAlign:"-2px"}}/> Parte en curso</span>
                  : <span style={{fontSize:9,color:C.dim,background:"#0d0f14",border:`1px solid ${C.border}`,borderRadius:10,padding:"2px 7px"}}><ClipboardList size={11} style={{verticalAlign:"-2px"}}/> Sin parte</span>
              }
            </div>
          )}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0}}>
          <div style={{display:"flex",gap:4}}>
            <button onClick={onNavegar} style={{...S.btnOk,display:"inline-flex",alignItems:"center",justifyContent:"center"}} title="Navegar"><Navigation size={15}/></button>
            <button onClick={onMarcar} style={{...(done?S.btnOk:S.btnSm),display:"inline-flex",alignItems:"center",justifyContent:"center"}}>{done?<Check size={16}/>:"Marcar"}</button>
          </div>
          <div style={{display:"flex",gap:4}}>
            {onParte&&<button onClick={onParte} style={{...S.btnGhost,fontSize:10,padding:"4px 6px",flex:1,borderColor:parteFirmado?C.green:tieneParteIniciado?C.orange:C.border,color:parteFirmado?C.green:tieneParteIniciado?C.orange:C.muted}}><ClipboardList size={13} style={{verticalAlign:"-2px",marginRight:4}}/>Parte</button>}
            <button onClick={onNota} style={{...S.btnGhost,fontSize:10,padding:"4px 8px",borderColor:ub.nota?"#8b5cf6":C.border,color:ub.nota?"#a78bfa":C.muted,display:"inline-flex",alignItems:"center",justifyContent:"center"}} title="Nota"><StickyNote size={14}/></button>
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
                <div key={el.codiQR} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:el.realizado?C.greenDim:"#0d0f14",border:`1px solid ${el.realizado?C.green+"44":"#1c2d45"}`,borderRadius:6,padding:"7px 10px"}}>
                  <div><span style={{fontSize:12,color:el.realizado?C.green:C.blueText,fontWeight:700}}>{el.codiQR}</span><span style={{fontSize:10,color:C.dim,marginLeft:8}}>{el.model}</span></div>
                  <button onClick={()=>onMarcarQR(el.codiQR,!el.realizado)} style={{...(el.realizado?S.btnOk:S.btnSm),display:"inline-flex",alignItems:"center",justifyContent:"center"}}>{el.realizado?<Check size={15}/>:"Marcar"}</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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
  const dictadoObs = useDictado(t => setObs(x => (x ? x.trim() + " " : "") + t));
  const [firmado]   = useState(ub.parte?.firmado || false);

  const total  = PUNTOS_INSPECCION.reduce((s,g)=>s+g.puntos.length,0);
  const marcados = Object.values(checks).filter(Boolean).length;
  const pct    = Math.round(marcados/total*100);

  function toggle(pt){ setChecks(prev=>({...prev,[pt]:!prev[pt]})); }

  function guardar(finalizar=false){
    const parte = { checks, observaciones:obs, firmado: finalizar||firmado, fechaFirma: finalizar?Date.now():(ub.parte?.fechaFirma??null), operarioId: sesion.id };
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
    <br/><button onclick="window.print()">Imprimir / Guardar PDF</button>
    </body></html>`;
    const w=window.open("","_blank");
    w.document.write(html);
    w.document.close();
  }

  return(
    <div style={{...S.page,paddingBottom:100}}>
      {/* Header */}
      <div style={{...S.header}}>
        <button onClick={onClose} style={{...S.btnGhost,fontSize:12,padding:"5px 10px 5px 6px",flexShrink:0,display:"inline-flex",alignItems:"center",gap:2}}><ChevronLeft size={16}/> Volver</button>
        <div style={{flex:1,minWidth:0,padding:"0 8px"}}>
          <div style={{fontSize:12,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>Parte — {ub.pa}</div>
          <div style={{fontSize:10,color:C.muted}}>{ub.calle} {ub.num} · {marcados}/{total} puntos</div>
        </div>
        <div style={{fontSize:15,fontWeight:800,color:pct===100?C.green:pct>50?C.orange:C.red}}>{pct}%</div>
      </div>

      <div style={{padding:"10px 14px 0"}}>
        {/* Info PA */}
        <div style={{...S.card,marginBottom:10}}>
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
        <div style={{height:6,background:"#0b0d12",borderRadius:3,overflow:"hidden",marginBottom:14}}>
          <div style={{height:"100%",background:pct===100?C.green:pct>50?C.orange:C.red,borderRadius:3,width:`${pct}%`,transition:"width 0.3s"}}/>
        </div>

        {/* Tabla puntos de inspección */}
        {PUNTOS_INSPECCION.map(g=>(
          <div key={g.grupo} style={{marginBottom:12}}>
            {/* Cabecera grupo */}
            <div style={{background:"#151a26",borderRadius:"6px 6px 0 0",padding:"7px 12px",fontSize:11,fontWeight:700,color:C.blueText,borderBottom:`1px solid ${C.border}`}}>
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
                  background:checks[pt]?C.green:"#0d0f14",
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
          <div style={{marginTop:6}}><BotonDictar d={dictadoObs}/></div>
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
            <Save size={15} style={{verticalAlign:"-3px",marginRight:6}}/>Guardar borrador
          </button>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <button onClick={generarPDF} style={{...S.btnGhost,padding:12,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
              <Printer size={15} style={{verticalAlign:"-3px",marginRight:6}}/>Generar PDF
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
export function DetallePlan({plan,sesion,onBack,onUpdate}){
  const [selId,setSelId]=useState(null);
  const [verMapa,setVerMapa]=useState(true);
  const [expandId,setExpandId]=useState(null);
  const [notaId,setNotaId]=useState(null);
  const [notaText,setNotaText]=useState("");
  const [nav,setNav]=useState(()=>navegadorElegido().id);
  const dictadoNota=useDictado(t=>setNotaText(x=>(x?x.trim()+" ":"")+t));
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

  // Cada cambio es de UNA parada: se pinta ya en pantalla y se guarda
  // aplicado sobre lo que haya en el servidor (concurrencia.js), para no
  // pisar las paradas que otra persona marque a la vez en el mismo plan.
  function cambiarParada(id,cambio){
    onUpdate({...plan,ubicaciones:ubicaciones.map(u=>u.id!==id?u:cambio(u))},{ubicId:id,cambio});
  }
  function marcarUbic(id,val){
    cambiarParada(id,u=>({...u,realizado:val,realizadoPor:val?sesion.id:null,realizadoEn:val?Date.now():null,elementos:val?(u.elementos||[]).map(e=>({...e,realizado:true})):u.elementos}));
  }
  function marcarQR(ubicId,qr,val){
    cambiarParada(ubicId,u=>{
      const elems=(u.elementos||[]).map(e=>e.codiQR===qr?{...e,realizado:val}:e);
      const todos=elems.length>0&&elems.every(e=>e.realizado);
      return{...u,elementos:elems,realizado:todos,realizadoPor:todos?sesion.id:null,realizadoEn:todos?Date.now():null};
    });
  }
  function guardarNota(){
    const texto=notaText;
    cambiarParada(notaId,u=>({...u,nota:texto}));
    setNotaId(null);setNotaText("");
  }
  function guardarParte(ubicId, parte, finalizar){
    cambiarParada(ubicId,u=>({
      ...u,
      parte,
      // Si se finaliza, marcar la parada como realizada
      realizado: finalizar?true:u.realizado,
      realizadoPor: finalizar?sesion.id:u.realizadoPor,
      realizadoEn: finalizar?Date.now():u.realizadoEn,
    }));
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
        <button onClick={onBack} style={{...S.btnGhost,fontSize:12,padding:"5px 10px 5px 6px",display:"inline-flex",alignItems:"center",gap:2}}><ChevronLeft size={16}/> Volver</button>
        <div style={{flex:1,minWidth:0,padding:"0 10px"}}>
          <div style={{fontSize:13,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{plan.nombre}</div>
          <div style={{fontSize:12.5,color:C.muted}}>{[plan.turno,plan.diaServicio,`${realizadas}/${ubicaciones.length}`].filter(Boolean).join(" · ")}</div>
        </div>
        <div style={{fontSize:18,fontWeight:800,color:tasaColor}}>{tasa}%</div>
      </div>
      <div style={{padding:"10px 14px 0"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5,marginBottom:10}}>
          {[{l:"Paradas",v:ubicaciones.length,c:C.blueText},{l:"Hechas",v:realizadas,c:C.green},{l:"Pendient.",v:ubicaciones.length-realizadas,c:tasaColor},{l:"QR",v:`${realizadosQR}/${totalQR}`,c:"#8b5cf6"}].map(s=>(
            <div key={s.l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 4px",textAlign:"center"}}>
              <div style={{fontSize:15,fontWeight:800,color:s.c}}>{s.v}</div>
              <div style={{fontSize:12,color:C.dim,textTransform:"none",letterSpacing:0}}>{s.l}</div>
            </div>
          ))}
        </div>
        <div style={{height:6,background:"#0b0d12",borderRadius:3,overflow:"hidden",marginBottom:10}}>
          <div style={{height:"100%",background:tasaColor,borderRadius:3,width:`${tasa}%`,transition:"width 0.4s"}}/>
        </div>
        {proxima&&(
          <div style={{background:"#151a26",border:`1px solid ${C.blue}33`,borderRadius:10,padding:"10px 14px",marginBottom:10,display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:32,height:32,borderRadius:"50%",background:C.blueDim,border:`2px solid ${C.blue}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:C.blueText,flexShrink:0}}>{proxima.orden}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,color:C.muted,marginBottom:1}}>Próxima parada</div>
              <div style={{fontSize:13,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{proxima.calle} {proxima.num}</div>
              <div style={{fontSize:10,color:C.dim}}>{proxima.barri} · {proxima.elementos.length} elementos</div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:4,alignItems:"stretch",flexShrink:0}}>
              <button onClick={()=>abrirNavegacion(proxima.lat,proxima.lng)} style={{...S.btnOk,display:"inline-flex",alignItems:"center",justifyContent:"center",gap:6}}><Navigation size={15}/> Ir</button>
              <select value={nav} onChange={e=>{elegirNavegador(e.target.value);setNav(e.target.value);}} title="Con qué app navegar (se recuerda en este móvil)"
                style={{background:"#0d0f14",border:`1px solid ${C.border}`,color:C.muted,borderRadius:6,fontSize:10,padding:"3px 4px"}}>
                {NAVEGADORES.map(n=><option key={n.id} value={n.id}>{n.nombre}</option>)}
              </select>
            </div>
          </div>
        )}
        {plan.origenVRP&&sectorDe(plan).ver.pesadas&&<ApuntarPesada plan={plan} sesion={sesion}/>}
        {totalQR>0&&<LectorRfid ubicaciones={ubicaciones} codigo={sectorDe(plan).t.codigo} onLeido={(ubicId,qr)=>marcarQR(ubicId,qr,true)}/>}
        <button onClick={()=>setVerMapa(v=>!v)} style={{...S.btnGhost,width:"100%",marginBottom:8,borderColor:verMapa?C.blue:C.border,color:verMapa?C.blueText:C.muted}}>
          <MapIcon size={15} style={{verticalAlign:"-3px",marginRight:6}}/>{verMapa?"Ocultar mapa":"Ver mapa del recorrido"}
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
            {ubics.every(u=>u.realizado)?"Desmarcar todas":<><CheckCheck size={14} style={{verticalAlign:"-3px",marginRight:4}}/>Marcar todas</>}
          </button>
        </div>
        {pendientes.length>0&&<><div style={{fontSize:12,color:C.dim,letterSpacing:0,textTransform:"none",marginBottom:6,paddingLeft:4}}>Pendientes ({pendientes.length})</div>{pendientes.map(ub=><TarjetaUbic key={ub.id} ub={ub} isSel={selId===ub.id} isExp={expandId===ub.id} onSelect={()=>sel(ub.id)} onExpand={()=>setExpandId(expandId===ub.id?null:ub.id)} onMarcar={()=>marcarUbic(ub.id,true)} onMarcarQR={(qr,v)=>marcarQR(ub.id,qr,v)} onNota={()=>{setNotaId(ub.id);setNotaText(ub.nota||"");}} onNavegar={()=>abrirNavegacion(ub.lat,ub.lng)} onParte={esPrev?()=>setParteUbicId(ub.id):undefined}/>)}</>}
        {hechas.length>0&&<><div style={{fontSize:12,color:C.green,letterSpacing:0,textTransform:"none",marginBottom:6,marginTop:12,paddingLeft:4}}>Completadas ({hechas.length})</div>{hechas.map(ub=><TarjetaUbic key={ub.id} ub={ub} isSel={selId===ub.id} isExp={expandId===ub.id} onSelect={()=>sel(ub.id)} onExpand={()=>setExpandId(expandId===ub.id?null:ub.id)} onMarcar={()=>marcarUbic(ub.id,false)} onMarcarQR={(qr,v)=>marcarQR(ub.id,qr,v)} onNota={()=>{setNotaId(ub.id);setNotaText(ub.nota||"");}} onNavegar={()=>abrirNavegacion(ub.lat,ub.lng)} onParte={esPrev?()=>setParteUbicId(ub.id):undefined} done/>)}</>}
      </div>
      {notaId&&(
        <div style={{position:"fixed",inset:0,background:"#000b",zIndex:300,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={()=>setNotaId(null)}>
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:"16px 16px 0 0",padding:20,width:"100%",maxWidth:520}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:13,fontWeight:600,marginBottom:12}}><StickyNote size={15} style={{verticalAlign:"-3px",marginRight:6}}/>Nota de la parada</div>
            <textarea value={notaText} onChange={e=>setNotaText(e.target.value)} rows={4} placeholder="Observaciones, incidencias..." style={{...S.input,resize:"none",marginBottom:8}}/>
            <div style={{marginBottom:12}}><BotonDictar d={dictadoNota}/></div>
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
