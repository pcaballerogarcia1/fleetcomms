// App del conductor → Incidencias.
import { BarChart3, ChevronLeft, Plus, Truck, Users } from "lucide-react";
import { useState } from "react";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { arrayUnion } from "firebase/firestore";
import { rolesAsignablesPor } from "../roles.js";
import { PanelAdmin } from "./admin.jsx";
import { enviarAvisos } from "../avisos.js";
import { C, CATS, PC, S, VEHICULOS, avatarOf, fbAdd, fbUpdate, mono, nuevoComentario, timeAgo, useCollection } from "./comun.js";
import { CTip } from "./ui.jsx";
import { tono } from "../tema.js";

// ── INCIDENCIAS ───────────────────────────────────────────────────
export function ModuloIncidencias({sesion,usuarios}){
  const {data:incidencias} = useCollection("incidencias","fecha",sesion.org_id,false,100); // las 100 más recientes
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
    // arrayUnion: se añade al servidor, no se pisa lo que haya escrito otro
    await fbUpdate("incidencias",inc._id,{comentarios:arrayUnion(nuevoComentario(sesion.uid,comentario))});
    setCom("");
  }
  async function cambiarEstado(inc,est){
    await fbUpdate("incidencias",inc._id,{estado:est});
    // aviso al móvil de quien la abrió (si no es uno mismo)
    if(inc.usuarioId&&inc.usuarioId!==sesion.uid) enviarAvisos(sesion.org_id,[inc.usuarioId],{titulo:`Incidencia ${est}`,cuerpo:inc.titulo||"",url:"/incidencias",etiqueta:`inc-${inc._id}`}).catch(e=>console.warn("Aviso de incidencia:",e));
  }

  if(showAdmin) return <PanelAdmin usuarios={usuarios} orgId={sesion.org_id} onClose={()=>setShowAdmin(false)} rolesCreables={rolesAsignablesPor(sesion.rol)}/>;
  if(showStats) return <PanelStats incidencias={incidencias} onClose={()=>setShowStats(false)}/>;

  return(
    <div style={{paddingBottom:80}}>
      {/* Sub-header con vistas */}
      {vista!=="feed"&&<div style={{padding:"10px 16px 0"}}><button onClick={()=>setVista("feed")} style={{...S.btnGhost,fontSize:11,padding:"5px 10px"}}><ChevronLeft size={16} style={{verticalAlign:"-3px",marginLeft:-3}}/> Volver</button></div>}
      {vista==="feed"&&(
        <>
          <div style={{padding:"10px 16px 0",display:"flex",gap:8,alignItems:"center"}}>
            {esAdmin&&<><button onClick={()=>setShowStats(true)} style={{...S.btnGhost,fontSize:11,padding:"5px 10px"}}><BarChart3 size={14} style={{verticalAlign:"-2px",marginRight:5}}/>Estadísticas</button><button onClick={()=>setShowAdmin(true)} style={{...S.btnGhost,fontSize:11,padding:"5px 10px"}}><Users size={14} style={{verticalAlign:"-2px",marginRight:5}}/>Usuarios</button></>}
          </div>
          <div style={{padding:"8px 16px 0",display:"flex",gap:6,overflowX:"auto"}}>
            {[["todas","Todas"],["alta","Urgentes"],["abierta","Abiertas"],["en revisión","En revisión"],["mias","Mis reportes"]].map(([k,l])=>(
              <button key={k} onClick={()=>setFiltro(k)} style={{background:filtro===k?C.blueDim:"none",border:`1px solid ${filtro===k?C.blue:C.border}`,color:filtro===k?C.blueText:C.muted,padding:"4px 12px",borderRadius:20,fontSize:11,cursor:"pointer",whiteSpace:"nowrap",fontFamily:mono}}>{l}</button>
            ))}
          </div>
          <div style={{display:"flex",padding:"10px 16px",gap:6}}>
            {[{l:"Abiertas",v:incidencias.filter(i=>i.estado==="abierta").length,c:C.red},{l:"En revisión",v:incidencias.filter(i=>i.estado==="en revisión").length,c:C.orange},{l:"Cerradas",v:incidencias.filter(i=>i.estado==="cerrada").length,c:C.green}].map(s=>(
              <div key={s.l} style={{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px",textAlign:"center"}}>
                <div style={{fontSize:20,fontWeight:800,color:s.c}}>{s.v}</div>
                <div style={{fontSize:12,color:C.dim,letterSpacing:0,textTransform:"none"}}>{s.l}</div>
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
              <div key={inc._id} onClick={()=>{setSelId(inc._id);setVista("detalle");}} style={{...S.card,cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.borderColor=C.blueText} onMouseLeave={e=>e.currentTarget.style.borderColor=cat.color}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}><cat.Icono size={14} color={cat.color}/><span style={{fontSize:12,color:cat.color,letterSpacing:0,textTransform:"none"}}>{cat.label}</span></div>
                  <div style={{display:"flex",gap:5}}>
                    <span style={{fontSize:12,padding:"2px 7px",borderRadius:20,background:`${PC[inc.prioridad]}22`,color:PC[inc.prioridad],border:`1px solid ${PC[inc.prioridad]}44`,textTransform:"capitalize"}}>{inc.prioridad}</span>
                    <span style={{fontSize:12,padding:"2px 7px",borderRadius:20,background:tono("#1d222d", "#ebedf2"),color:C.muted,border:`1px solid ${C.border}`,textTransform:"capitalize"}}>{inc.estado}</span>
                  </div>
                </div>
                <div style={{fontSize:15,fontWeight:700,marginBottom:4}}>{inc.titulo}</div>
                {inc.vehiculo&&<div style={{fontSize:11,color:C.muted,marginBottom:6}}><Truck size={13} style={{verticalAlign:"-2px",marginRight:5}}/>{inc.vehiculo}</div>}
                <div style={{fontSize:12,color:C.muted,lineHeight:1.5,marginBottom:8,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{inc.descripcion}</div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:22,height:22,borderRadius:"50%",background:C.blueDim,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:C.blueText,fontWeight:700}}>{autor?.foto?<img src={autor.foto} alt="" style={{width:"100%",height:"100%",objectFit:"cover",borderRadius:"50%",display:"block"}}/>:avatarOf(autor)}</div><span style={{fontSize:11,color:C.muted}}>{autor.nombre}</span></div>
                  <span style={{fontSize:11,color:C.dim}}>{timeAgo(inc.fecha)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {vista==="nueva"&&(
        <div style={{padding:"14px 16px"}}>
          <div style={{marginBottom:14}}><label style={S.label}>Categoría</label><div style={{display:"flex",flexWrap:"wrap",gap:8}}>{CATS.map((c,i)=><button key={i} onClick={()=>setForm({...form,categoria:i})} style={{background:parseInt(form.categoria)===i?`${c.color}22`:"none",border:`1px solid ${parseInt(form.categoria)===i?c.color:C.border}`,color:parseInt(form.categoria)===i?c.color:C.muted,padding:"6px 12px",borderRadius:20,fontSize:11,cursor:"pointer",fontFamily:mono}}><c.Icono size={13} style={{verticalAlign:"-2px",marginRight:5}}/>{c.label}</button>)}</div></div>
          <div style={{marginBottom:14}}><label style={S.label}>Vehículo</label><select value={form.vehiculo} onChange={e=>setForm({...form,vehiculo:e.target.value})} style={S.input}><option value="">— Sin vehículo —</option>{VEHICULOS.map(v=><option key={v} value={v}>{v}</option>)}</select></div>
          <div style={{marginBottom:14}}><label style={S.label}>Prioridad</label><div style={{display:"flex",gap:8}}>{["baja","media","alta"].map(p=><button key={p} onClick={()=>setForm({...form,prioridad:p})} style={{flex:1,padding:"8px",borderRadius:8,cursor:"pointer",fontSize:12,fontFamily:mono,background:form.prioridad===p?`${PC[p]}22`:"none",border:`1px solid ${form.prioridad===p?PC[p]:C.border}`,color:form.prioridad===p?PC[p]:C.muted,textTransform:"capitalize"}}>{p}</button>)}</div></div>
          <div style={{marginBottom:14}}><label style={S.label}>Título *</label><input value={form.titulo} onChange={e=>setForm({...form,titulo:e.target.value})} placeholder="Resumen breve" style={S.input}/></div>
          <div style={{marginBottom:22}}><label style={S.label}>Descripción</label><textarea value={form.descripcion} onChange={e=>setForm({...form,descripcion:e.target.value})} placeholder="Describe la incidencia..." rows={4} style={{...S.input,resize:"vertical"}}/></div>
          <button onClick={crearInc} style={{...S.btn,width:"100%",padding:13,fontSize:15}}>PUBLICAR INCIDENCIA</button>
        </div>
      )}
      {vista==="detalle"&&incActual&&(()=>{
        const cat=CATS[incActual.categoria]||CATS[0];const autor=getUser(incActual.usuarioId);
        return(
          <div style={{padding:"0 0 20px"}}>
            <div style={{background:C.card,borderBottom:`1px solid ${C.border}`,padding:"14px 16px"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}><cat.Icono size={14} color={cat.color}/><span style={{fontSize:12,color:cat.color,letterSpacing:0,textTransform:"none"}}>{cat.label}</span></div>
              <div style={{fontSize:20,fontWeight:700,marginBottom:6}}>{incActual.titulo}</div>
              {incActual.vehiculo&&<div style={{fontSize:12,color:C.muted,marginBottom:8}}><Truck size={14} style={{verticalAlign:"-2px",marginRight:5}}/>{incActual.vehiculo}</div>}
              <div style={{fontSize:13,color:C.muted,lineHeight:1.6,marginBottom:14}}>{incActual.descripcion}</div>
              <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:esAdmin?14:0}}>
                <span style={{fontSize:12,padding:"3px 10px",borderRadius:20,background:`${PC[incActual.prioridad]}22`,color:PC[incActual.prioridad],border:`1px solid ${PC[incActual.prioridad]}44`,textTransform:"none"}}>Prioridad {incActual.prioridad}</span>
                <span style={{fontSize:11,color:C.muted}}>{autor.nombre} · {timeAgo(incActual.fecha)}</span>
              </div>
              {esAdmin&&<div><label style={{...S.label,marginBottom:8}}>Estado</label><div style={{display:"flex",gap:6}}>{["abierta","en revisión","cerrada"].map(est=><button key={est} onClick={()=>cambiarEstado(incActual,est)} style={{flex:1,padding:"7px 4px",borderRadius:8,cursor:"pointer",fontSize:10,fontFamily:mono,textTransform:"capitalize",background:incActual.estado===est?tono("#1d222d", "#ebedf2"):"none",border:`1px solid ${incActual.estado===est?C.blue:C.border}`,color:incActual.estado===est?C.blueText:C.muted}}>{est}</button>)}</div></div>}
            </div>
            <div style={{padding:"14px 16px"}}>
              <label style={{...S.label,marginBottom:10}}>Comentarios ({incActual.comentarios?.length||0})</label>
              {(incActual.comentarios||[]).map((c,i)=>{const cu=getUser(c.usuarioId);return(<div key={i} style={S.card}><div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:22,height:22,borderRadius:"50%",background:C.blueDim,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:C.blueText,fontWeight:700}}>{cu?.foto?<img src={cu.foto} alt="" style={{width:"100%",height:"100%",objectFit:"cover",borderRadius:"50%",display:"block"}}/>:avatarOf(cu)}</div><span style={{fontSize:12,color:"#94a3b8",fontWeight:600}}>{cu.nombre}</span></div><span style={{fontSize:10,color:C.dim}}>{timeAgo(c.fecha)}</span></div><div style={{fontSize:13,color:C.muted,lineHeight:1.5}}>{c.texto}</div></div>);})}
              <div style={{display:"flex",gap:8,marginTop:10}}><input value={comentario} onChange={e=>setCom(e.target.value)} placeholder="Añadir comentario..." onKeyDown={e=>e.key==="Enter"&&agregarCom(incActual)} style={{...S.input,flex:1}}/><button onClick={()=>agregarCom(incActual)} style={{...S.btn,padding:"10px 14px"}}>↑</button></div>
            </div>
          </div>
        );
      })()}
      {vista==="feed"&&(
        <button onClick={()=>setVista("nueva")} className="op-btn op-primario" style={{position:"fixed",bottom:"calc(78px + env(safe-area-inset-bottom))",left:"50%",transform:"translateX(-50%)",height:46,padding:"0 22px",borderRadius:999,fontSize:15,zIndex:100,boxShadow:"0 10px 30px rgba(91,124,250,0.35)"}}>
          <Plus size={17}/> Nueva incidencia
        </button>
      )}
    </div>
  );
}

// ── PANEL STATS ───────────────────────────────────────────────────
function PanelStats({incidencias,onClose}){
  const [periodo,setPeriodo]=useState("todo");const [now2]=useState(()=>Date.now()); // la hora al abrir el panel
  const f=incidencias.filter(i=>{const c=periodo==="7d"?now2-86400000*7:periodo==="30d"?now2-86400000*30:0;return(i.fecha??0)>=c;});
  const ab=f.filter(i=>i.estado==="abierta").length,rev=f.filter(i=>i.estado==="en revisión").length,cer=f.filter(i=>i.estado==="cerrada").length,urg=f.filter(i=>i.prioridad==="alta").length;
  const evol=Array.from({length:7},(_,i)=>{const d=new Date(now2-86400000*(6-i));const s=new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();return{dia:d.toLocaleDateString("es-ES",{weekday:"short"}),total:incidencias.filter(x=>(x.fecha??0)>=s&&(x.fecha??0)<s+86400000).length,cerradas:incidencias.filter(x=>(x.fecha??0)>=s&&(x.fecha??0)<s+86400000&&x.estado==="cerrada").length};});
  const pie=[{name:"Abiertas",value:ab,color:C.red},{name:"En revisión",value:rev,color:C.orange},{name:"Cerradas",value:cer,color:C.green}].filter(x=>x.value>0);
  return(
    <div style={S.page}>
      <div style={S.header}><div><div style={{fontSize:12,color:C.dim,letterSpacing:0,textTransform:"none"}}>Estadísticas</div><div style={{fontSize:20,fontWeight:700}}>Incidencias</div></div><button onClick={onClose} style={S.btnGhost}><ChevronLeft size={16} style={{verticalAlign:"-3px",marginLeft:-3}}/> Volver</button></div>
      <div style={{padding:"12px 16px 0",display:"flex",gap:8}}>{[["7d","7d"],["30d","30d"],["todo","Todo"]].map(([k,l])=><button key={k} onClick={()=>setPeriodo(k)} style={{...S.btnGhost,fontSize:11,padding:"5px 12px",borderColor:periodo===k?C.blue:C.border,color:periodo===k?C.blueText:C.muted,background:periodo===k?C.blueDim:"none"}}>{l}</button>)}</div>
      <div style={{padding:"14px 16px 80px"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:14}}>{[{l:"Total",v:f.length,c:C.blueText},{l:"Abiertas",v:ab,c:C.red},{l:"Revisión",v:rev,c:C.orange},{l:"Urgentes",v:urg,c:C.amber}].map(k=><div key={k.l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 6px",textAlign:"center"}}><div style={{fontSize:20,fontWeight:800,color:k.c}}>{k.v}</div><div style={{fontSize:12,color:C.dim,letterSpacing:0,textTransform:"none",marginTop:2}}>{k.l}</div></div>)}</div>
        <div style={{...S.card,marginBottom:12}}><label style={S.label}>Últimos 7 días</label><ResponsiveContainer width="100%" height={130}><BarChart data={evol} barGap={2}><XAxis dataKey="dia" tick={{fontSize:10,fill:C.dim}} axisLine={false} tickLine={false}/><YAxis tick={{fontSize:10,fill:C.dim}} axisLine={false} tickLine={false} allowDecimals={false} width={18}/><Tooltip content={<CTip/>} cursor={{fill:"#ffffff08"}}/><Bar dataKey="total" name="Total" fill={C.blue} radius={[4,4,0,0]}/><Bar dataKey="cerradas" name="Cerradas" fill={C.green} radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div>
        <div style={S.card}><label style={S.label}>Por estado</label><ResponsiveContainer width="100%" height={120}><PieChart><Pie data={pie} cx="50%" cy="50%" innerRadius={30} outerRadius={48} paddingAngle={3} dataKey="value">{pie.map((e,i)=><Cell key={i} fill={e.color}/>)}</Pie><Tooltip content={<CTip/>}/></PieChart></ResponsiveContainer>{pie.map(d=><div key={d.name} style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}><div style={{width:8,height:8,borderRadius:"50%",background:d.color}}/><span style={{fontSize:11,color:C.muted}}>{d.name}</span><span style={{fontSize:11,color:"#94a3b8",marginLeft:"auto"}}>{d.value}</span></div>)}</div>
      </div>
    </div>
  );
}
