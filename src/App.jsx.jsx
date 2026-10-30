import { Bus, Map as MapIcon, MessageSquareWarning, Package, Settings } from "lucide-react";
import { Logo } from "./ui/marca.jsx";
import { Loader2 } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { db, auth, getUserProfileSafe } from "./firebase.js";
import { collection, onSnapshot, query, where, orderBy, limit } from "firebase/firestore";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { roleLabel, puedeGestionarRutas as puedeGestionarRutasRol } from "./roles.js";
import { repararPlanesSinConductor } from "./reparar-planes.js";
import { limpiarEmail, mensajeAuth } from "./auth-mensajes.js";
import { setErrorUser } from "./error-report.js";
import { parcheDe } from "./concurrencia.js";
import { MiTurno } from "./turno-conductor.jsx";
import { watchServiciosFechas, watchMisCuadrantes } from "./lineas-servicio-store.js";
import { fechaLocal, sumarDias, servicioVigente } from "./lineas-servicio.js";
import { PanelAdminRutas } from "./conductor/admin.jsx";
import { AvatarPerfil } from "./foto-perfil.jsx";
import { OpcionesPerfilApp, PantallaAvisos } from "./conductor/menu-perfil-app.jsx";
import { PantallaDocumentos } from "./documentos/app-trabajador.jsx";
import { useMisDocumentos } from "./documentos/usar-documentos.js";
import { OlvideClave } from "./olvide-clave.jsx";
import { C, S, fbAdd, fbDelete, fbUpdate, font, useCollection } from "./conductor/comun.js";
import { ModuloIncidencias } from "./conductor/incidencias.jsx";
import { ModuloInventario } from "./conductor/inventario.jsx";
import { ListaPlanes } from "./conductor/rutas.jsx";
import { alfa } from "./tema.js";
import { tono } from "./tema.js";

function Login({aviso=""}){
  const [email,setEmail]=useState("");const [pw,setPw]=useState("");
  const [err,setErr]=useState(aviso);const [loading,setLoading]=useState(false);
  const go=async()=>{
    if(!email||!pw){setErr("Introduce tu usuario (o email) y tu contraseña");return;}
    setLoading(true);setErr("");
    try{ await signInWithEmailAndPassword(auth,limpiarEmail(email),pw); }
    catch(e){ setErr(mensajeAuth(e)); setLoading(false); }
  };
  return(
    <div style={{fontFamily:font,background:`radial-gradient(600px 420px at 50% -8%, rgba(91,124,250,0.18), transparent 70%), ${C.bg}`,minHeight:"100vh",width:"100%",display:"flex",alignItems:"center",justifyContent:"center",padding:24,overflow:"hidden"}}>
      <div style={{width:"100%",maxWidth:360,animation:"fadeUp .3s ease both"}}>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",marginBottom:26}}>
          <Logo size={48}/>
          <div style={{fontSize:24,fontWeight:650,color:C.text,letterSpacing:"-0.02em",marginTop:16}}>Operanzia</div>
          <div style={{fontSize:13,color:C.muted,marginTop:6}}>Tus rutas, tu turno y tus avisos</div>
        </div>
        <div style={{background:tono("rgba(18,21,28,0.85)", "rgba(255,255,255,0.85)"),border:`1px solid ${C.border}`,borderRadius:12,padding:22,boxShadow:`0 24px 64px rgba(0,0,0,.45), inset 0 1px 0 ${alfa(0.04)}`}}>
          <div style={{marginBottom:14}}>
            <label className="op-label">Email o usuario</label>
            <input className="op-input" style={{height:44,fontSize:15}} value={email} onChange={e=>setEmail(e.target.value)} type="text" placeholder="tu@empresa.com o tu usuario" autoComplete="username" autoCapitalize="none" onKeyDown={e=>e.key==="Enter"&&go()}/>
          </div>
          <div style={{marginBottom:20}}>
            <label className="op-label">Contraseña</label>
            <input className="op-input" style={{height:44,fontSize:15}} value={pw} onChange={e=>setPw(e.target.value)} type="password" placeholder="••••••••" autoComplete="current-password" onKeyDown={e=>e.key==="Enter"&&go()}/>
          </div>
          {err&&<div style={{background:"rgba(242,109,109,0.08)",border:"1px solid rgba(242,109,109,0.25)",color:C.red,borderRadius:12,padding:"10px 12px",fontSize:13,marginBottom:16}}>{err}</div>}
          <button onClick={go} disabled={loading} className="op-btn op-primario" style={{width:"100%",height:46,fontSize:15}}>
            {loading?<><Loader2 size={16} className="op-girando"/> Accediendo…</>:"Acceder"}
          </button>
          <OlvideClave texto={email} color={C.muted}/>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}`}</style>
        </div>
      </div>
    </div>
  );
}

// ── APP ───────────────────────────────────────────────────────────
export default function App(){
  const [sesion,setSesion]=useState(undefined); // undefined=cargando, null=no autenticado
  const [bloqueado,setBloqueado]=useState(false); // su perfil está inactivo: se le dice al volver a la entrada
  const [usuarios,setUsuarios]=useState([]);
  const [tab,setTab]=useState("rutas");
  // Documentos y avisos al móvil: en el menú de la foto; se abren encima de la pestaña
  const misDocs = useMisDocumentos(sesion);
  const [verDocs,setVerDocs] = useState(false);
  const [verAvisos,setVerAvisos] = useState(false);

  // Firebase Auth — escuchar cambios de sesión
  useEffect(()=>{
    return onAuthStateChanged(auth,async user=>{
      if(user){
        try{
          // getUserProfileSafe: fuerza servidor para evitar caché
          // desactualizada justo tras iniciar sesión, pero con timeout —
          // en mala cobertura (muy típico de un conductor en la calle) ya
          // no se queda cargando para siempre.
          const snap=await getUserProfileSafe(user.uid);
          if(snap.exists()&&snap.data().activo!==false){
            setBloqueado(false); setSesion({uid:user.uid,id:user.uid,...snap.data()});
            setErrorUser({uid:user.uid,...snap.data()});
          }else{
            setBloqueado(snap.exists());
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

  // Autobuses (proyectos de líneas): el servicio publicado de hoy (y el de
  // ayer, que puede seguir de madrugada). Si hay, aparece «Mi turno»; a los
  // conductores se les abre ahí directamente la primera vez.
  const [servicios,setServicios]=useState([]);
  const abiertoTurno=useRef(false);
  useEffect(()=>{
    if(!sesion?.org_id) return;
    const hoy=fechaLocal();
    return watchServiciosFechas(sesion.org_id,[hoy,sumarDias(hoy,-1)],l=>{
      setServicios(l);
      if(!abiertoTurno.current && servicioVigente(l).length && !puedeGestionarRutasRol(sesion.rol)){ abiertoTurno.current=true; setTab(t=>t==="rutas"?"turno":t); }
    });
  },[sesion?.org_id,sesion?.rol]);
  // y su cuadrante de líneas (turnos de los próximos días, del Rostering)
  const [misCuadrantes,setMisCuadrantes]=useState([]);
  useEffect(()=>watchMisCuadrantes(sesion?.org_id,sesion?.uid,setMisCuadrantes),[sesion?.org_id,sesion?.uid]);
  const cuadrantesBus=misCuadrantes.filter(c=>c.lineas);
  const hayBus=servicioVigente(servicios).length>0||cuadrantesBus.length>0;

  const isSA = sesion?.rol === "superadmin";
  const verTodosPlanes = isSA || puedeGestionarRutasRol(sesion?.rol);
  // Planes antiguos sin conductorUid: los arregla quien gestiona rutas (ver reparar-planes.js)
  useEffect(()=>{ repararPlanesSinConductor(sesion).catch(e=>console.warn("[planes] arreglo de planes antiguos:",e)); },[sesion]);
  // Gestores: los 300 planes más recientes de la organización (lo de siempre).
  // Conductores: solo lo que pueden ver — los suyos y los compartidos (sin
  // conductor, conductorUid: null) del mes anterior, el actual y el siguiente,
  // y las tareas correctivas recientes. Antes descargaban los 300 más
  // recientes de TODA la organización para quedarse con unos pocos (medido
  // con npm run medir). Los planes antiguos sin el campo conductorUid se
  // migran con scripts/migrar-planes-sin-conductor.mjs.
  const {data:planesOrg}=useCollection("planes","fechaSubida",verTodosPlanes?sesion?.org_id:null, isSA, 300);
  const mesesCercanos=(()=>{const d=new Date();return [-1,0,1].map(k=>{const x=new Date(d.getFullYear(),d.getMonth()+k,1);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}`;});})();
  const [compartidos,setCompartidos]=useState([]);
  const [correctivos,setCorrectivos]=useState([]);
  const clavesMeses=mesesCercanos.join(",");
  useEffect(()=>{
    if(verTodosPlanes||!sesion?.org_id) return;
    const meses=clavesMeses.split(",");
    const q=query(collection(db,"planes"),where("org_id","==",sesion.org_id),where("conductorUid","==",null),where("mes","in",meses));
    return onSnapshot(q,snap=>setCompartidos(snap.docs.map(d=>({...d.data(),_id:d.id}))),err=>console.error("planes compartidos",err));
  },[verTodosPlanes,sesion?.org_id,clavesMeses]);
  useEffect(()=>{
    if(verTodosPlanes||!sesion?.org_id) return;
    const q=query(collection(db,"planes"),where("org_id","==",sesion.org_id),where("tipo","==","corr"),orderBy("fecha","desc"),limit(100));
    return onSnapshot(q,snap=>setCorrectivos(snap.docs.map(d=>({...d.data(),_id:d.id}))),err=>console.error("correctivos",err));
  },[verTodosPlanes,sesion?.org_id]);

  // Planes publicados a un trabajador concreto desde Rostering (conductorUid):
  // el conductor ve los suyos + los que no tienen conductor (lo de siempre);
  // gestores ven todos. Sus propios planes se piden aparte porque, con uno
  // por trabajador y día, en una plantilla grande pueden quedar fuera de los
  // 300 más recientes de la organización.
  const [misPlanes,setMisPlanes]=useState([]);
  useEffect(()=>{
    if(!sesion?.org_id||!sesion?.uid) return;
    const meses=clavesMeses.split(",");
    const q=query(collection(db,"planes"),where("org_id","==",sesion.org_id),where("conductorUid","==",sesion.uid),where("mes","in",meses));
    return onSnapshot(q,snap=>setMisPlanes(snap.docs.map(d=>({...d.data(),_id:d.id}))),err=>console.error("misPlanes",err));
  },[sesion?.org_id,sesion?.uid,clavesMeses]);
  const planes = (()=>{
    const byId=new Map();
    for(const p of [...(sesion?.uid?misPlanes:[]),...planesOrg,...(verTodosPlanes?[]:[...compartidos,...correctivos])]) byId.set(p._id,p);
    const all=[...byId.values()].sort((a,b)=>(b.fechaSubida||0)-(a.fechaSubida||0));
    return verTodosPlanes ? all : all.filter(p=>!p.conductorUid||p.conductorUid===sesion?.uid);
  })();

  // conductorUid: null explícito en los que no son de nadie, para que los
  // conductores puedan pedir solo los compartidos (ver más arriba)
  async function addPlan(plan){
    // el superadmin elige la empresa (plan.org_id); los demás, siempre la suya
    const org=sesion?.rol==="superadmin"?(plan.org_id||sesion?.org_id):sesion?.org_id;
    if(!org) throw new Error("tu usuario no tiene empresa asignada. Entra con un usuario de la empresa o asígnale una en Admin.");
    await fbAdd("planes",{conductorUid:null,...plan,org_id:org});
  }
  // Solo los campos que han cambiado, y los comentarios se AÑADEN (antes se
  // guardaba el plan entero y pisaba lo que hubiera cambiado otro, p. ej.
  // las paradas que un conductor marcaba a la vez).
  async function updatePlan(plan){
    const orig=planes.find(p=>p._id===plan._id);
    const parche=parcheDe(orig||{},plan);
    if(Object.keys(parche).length) await fbUpdate("planes",plan._id,parche);
  }
  async function deletePlan(id){ await fbDelete("planes",id); }

  // Pantalla de carga mientras Firebase inicializa auth
  if(sesion===undefined) return(
    <div style={{background:C.bg,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:font}}>
      <div style={{color:C.muted,fontSize:13}}>Cargando…</div>
    </div>
  );

  if(!sesion) return <Login key={bloqueado?"b":"n"} aviso={bloqueado?"Tu acceso a la app está bloqueado. Habla con tu empresa.":""}/>;

  const esIntermedio = sesion.rol==="intermedio";
  const esAdmin = puedeGestionarRutasRol(sesion.rol); // admin/intermedio/superadmin
  // Intermedio solo tiene Rutas (gestión completa) + Admin (KPIs de rutas y
  // Usuarios, ver PanelAdminRutas) — Incidencias/Inventario no están en su
  // alcance (roles.js). Field/Admin/Superadmin siguen viendo esas dos tal
  // cual las veían antes de este cambio.
  const TABS=[
    ...(hayBus?[{key:"turno",Icono:Bus,label:"Mi turno"}]:[]),
    {key:"rutas",      Icono:MapIcon, label:"Rutas"},
    ...(esIntermedio ? [] : [
      {key:"incidencias",Icono:MessageSquareWarning, label:"Incidencias"},
      {key:"inventario", Icono:Package, label:"Inventario"},
    ]),
    ...(esAdmin?[{key:"admin",Icono:Settings,label:"Admin"}]:[]),
  ];
  const TAB_TITLES={documentos:"Documentos",avisos:"Avisos en el móvil",turno:"Mi turno",rutas:"Rutas de servicio",incidencias:"Canal de incidencias",inventario:"Inventario",admin:"Panel de administración"};

  return(
    <div style={S.page}>
      <div style={{...S.header,paddingTop:"calc(12px + env(safe-area-inset-top))",paddingLeft:"calc(20px + env(safe-area-inset-left))",paddingRight:"calc(20px + env(safe-area-inset-right))",background:tono("rgba(11,13,18,0.86)", "rgba(255,255,255,0.86)"),borderBottom:`1px solid ${C.border}`,backdropFilter:"blur(16px)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <Logo size={26}/>
          <div style={{fontSize:15,fontWeight:650,color:C.text,letterSpacing:"-0.01em"}}>{TAB_TITLES[verDocs?"documentos":verAvisos?"avisos":tab]||tab}</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:11,color:C.text,fontWeight:500}}>{sesion.nombre}</div>
            <div style={{fontSize:11,color:C.dim}}>{roleLabel(sesion.rol)}</div>
          </div>
          <AvatarPerfil sesion={sesion} size={34} onCerrarSesion={()=>signOut(auth)} marca={(misDocs||[]).filter(d=>!d.leido).length}
            extra={cerrar=><OpcionesPerfilApp docs={misDocs} onDocumentos={()=>{cerrar();setVerAvisos(false);setVerDocs(true);}} onAvisos={()=>{cerrar();setVerDocs(false);setVerAvisos(true);}}/>}/>
        </div>
      </div>

      {verDocs&&<PantallaDocumentos docs={misDocs} sesion={sesion} onBack={()=>setVerDocs(false)}/>}
      {verAvisos&&!verDocs&&<PantallaAvisos sesion={sesion} onBack={()=>setVerAvisos(false)}/>}
      {!verDocs&&!verAvisos&&tab==="turno"&&<MiTurno sesion={sesion} servicios={servicios} cuadrantes={cuadrantesBus}/>}
      {!verDocs&&!verAvisos&&tab==="rutas"&&<ListaPlanes planes={planes} addPlan={addPlan} updatePlan={updatePlan} deletePlan={deletePlan} sesion={sesion} usuarios={usuarios}/>}
      {!verDocs&&!verAvisos&&tab==="incidencias"&&<ModuloIncidencias sesion={sesion} usuarios={usuarios}/>}
      {!verDocs&&!verAvisos&&tab==="inventario"&&<ModuloInventario sesion={sesion} usuarios={usuarios}/>}
      {!verDocs&&!verAvisos&&tab==="admin"&&esAdmin&&<PanelAdminRutas planes={planes} usuarios={usuarios} deletePlan={deletePlan} sesion={sesion}/>}

      <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:520,background:tono("rgba(11,13,18,0.9)", "rgba(255,255,255,0.9)"),borderTop:`1px solid ${C.border}`,display:"flex",zIndex:200,backdropFilter:"blur(16px)",paddingBottom:"env(safe-area-inset-bottom)"}}>
        {TABS.map(t=>{
          const active=tab===t.key;
          return(
            <button key={t.key} onClick={()=>{setTab(t.key);setVerDocs(false);setVerAvisos(false);}} style={{flex:1,padding:"10px 0 9px",background:"none",border:"none",cursor:"pointer",fontFamily:font,display:"flex",flexDirection:"column",alignItems:"center",gap:3,position:"relative",transition:"all .15s"}}>
              {active&&<div style={{position:"absolute",top:0,left:"50%",transform:"translateX(-50%)",width:28,height:2,background:"linear-gradient(90deg,#2563eb,#6d28d9)",borderRadius:4}}/>}
              <t.Icono size={21} strokeWidth={active?2.1:1.7} color={active?C.text:C.dim}/>
              <span style={{fontSize:11,fontWeight:active?600:500,color:active?C.text:C.dim,transition:"color .15s"}}>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
