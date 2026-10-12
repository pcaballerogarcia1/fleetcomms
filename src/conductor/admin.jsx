// App del conductor → Admin: usuarios y KPIs de rutas (gestores).
import { useState } from "react";
import { db, secondaryAuth } from "../firebase.js";
import { updateDoc, doc, serverTimestamp, setDoc, getDoc } from "firebase/firestore";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { roleLabel, rolesAsignablesPor } from "../roles.js";
import { C, S, TIPOS_TRABAJO, avatarOf, fmtMes, font, timeAgo } from "./comun.js";

// ── PANEL ADMIN ───────────────────────────────────────────────────
export function PanelAdmin({usuarios,orgId,onClose,rolesCreables}){
  const [tab,setTab]=useState("lista");
  const [form,setForm]=useState({nombre:"",apellidos:"",email:"",password:"",rol:rolesCreables[0]});
  const [err,setErr]=useState("");
  const [saving,setSaving]=useState(false);
  // Intermedio solo gestiona Field: la lista (y el toggle activo/inactivo,
  // que usa el mismo endpoint) se limita a los roles que puede asignar, no
  // a todos los usuarios de la org.
  const usuariosVisibles = usuarios.filter(u=>rolesCreables.includes(u.rol));

  async function crear(){
    if(!form.nombre||!form.email||!form.password){setErr("Nombre, email y contraseña son obligatorios");return;}
    if(form.password.length<6){setErr("La contraseña debe tener al menos 6 caracteres");return;}
    setSaving(true);setErr("");
    try{
      // Verificar cuota de usuarios de la org
      const orgSnap=await getDoc(doc(db,"orgs",orgId));
      if(orgSnap.exists()){
        const maxUsuarios=orgSnap.data().max_usuarios||0;
        const activos=usuarios.filter(u=>u.activo).length;
        if(activos>=maxUsuarios){
          setErr(`Has alcanzado el límite de ${maxUsuarios} usuario${maxUsuarios===1?"":"s"} de tu plan. Contacta con Operanzia para ampliarlo.`);
          setSaving(false);return;
        }
      }
      const cred=await createUserWithEmailAndPassword(secondaryAuth,form.email.trim().toLowerCase(),form.password);
      await setDoc(doc(db,"usuarios",cred.user.uid),{
        nombre:form.nombre.trim(),apellidos:form.apellidos.trim(),
        email:form.email.trim().toLowerCase(),rol:form.rol,
        org_id:orgId,activo:true,createdAt:serverTimestamp(),
      });
      await secondaryAuth.signOut();
      setForm({nombre:"",apellidos:"",email:"",password:"",rol:rolesCreables[0]});
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
        {tab==="lista"&&usuariosVisibles.map(u=>(
          <div key={u._id} style={{...S.card,opacity:u.activo?1:0.4}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <div style={{width:38,height:38,borderRadius:"50%",background:C.blueDim,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:C.blueText}}>{avatarOf(u)}</div>
                <div><div style={{fontSize:14,fontWeight:600}}>{u.nombre} {u.apellidos}</div><div style={{fontSize:11,color:C.muted}}>{u.email} · <span style={{color:C.blueText}}>{roleLabel(u.rol)}</span></div></div>
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
            <div style={{marginBottom:18}}><label style={S.label}>Rol</label><div style={{display:"flex",gap:8}}>{rolesCreables.map(v=><button key={v} onClick={()=>setForm({...form,rol:v})} style={{flex:1,padding:"9px",borderRadius:7,cursor:"pointer",fontSize:12,fontFamily:font,background:form.rol===v?C.blueDim:"none",border:`1px solid ${form.rol===v?C.blue:C.border}`,color:form.rol===v?C.blueText:C.muted}}>{roleLabel(v)}</button>)}</div></div>
            {err&&<div style={{background:"#2d1515",color:"#f87171",borderRadius:8,padding:"10px",fontSize:12,marginBottom:12}}>{err}</div>}
            <button onClick={crear} disabled={saving} style={{...S.btn,width:"100%",opacity:saving?0.6:1}}>{saving?"Creando…":"CREAR USUARIO"}</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── PANEL ADMIN RUTAS ─────────────────────────────────────────────
export function PanelAdminRutas({planes, usuarios, deletePlan, sesion}){
  const [tipoFiltro, setTipoFiltro] = useState("");
  const [mesFiltro,  setMesFiltro]  = useState("");
  const [expandId,   setExpandId]   = useState(null);
  // Usuarios vive aquí (y no solo dentro de Incidencias) porque Intermedio
  // tiene acceso a esta pestaña "Admin" de Rutas pero no a Incidencias — sin
  // esto, Intermedio no tendría ningún sitio desde el que dar de alta a
  // Field, pese a que sí puede hacerlo (ver roles.js rolesAsignablesPor).
  const [showUsuarios, setShowUsuarios] = useState(false);

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
    a.href = url; a.download = "operanzia-rutas.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  if (showUsuarios) return <PanelAdmin usuarios={usuarios} orgId={sesion.org_id} onClose={()=>setShowUsuarios(false)} rolesCreables={rolesAsignablesPor(sesion.rol)}/>;

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
          <button onClick={()=>setShowUsuarios(true)} style={{...S.btnSm,whiteSpace:"nowrap"}}>
            ⚙️ Usuarios
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
