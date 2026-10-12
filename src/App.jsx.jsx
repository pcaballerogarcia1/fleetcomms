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
import { C, S, avatarOf, fbAdd, fbDelete, fbUpdate, font, useCollection } from "./conductor/comun.js";
import { ModuloIncidencias } from "./conductor/incidencias.jsx";
import { ModuloInventario } from "./conductor/inventario.jsx";
import { ListaPlanes } from "./conductor/rutas.jsx";

function Login(){
  const [email,setEmail]=useState("");const [pw,setPw]=useState("");
  const [err,setErr]=useState("");const [loading,setLoading]=useState(false);
  const go=async()=>{
    if(!email||!pw){setErr("Introduce email y contraseña");return;}
    setLoading(true);setErr("");
    try{ await signInWithEmailAndPassword(auth,limpiarEmail(email),pw); }
    catch(e){ setErr(mensajeAuth(e)); setLoading(false); }
  };
  return(
    <div style={{fontFamily:font,background:C.bg,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:24,overflow:"hidden"}}>
      <div style={{width:"100%",maxWidth:360,animation:"fadeUp .3s ease both"}}>
        <div style={{marginBottom:32}}>
          <div style={{fontSize:11,color:C.dim,letterSpacing:2,textTransform:"uppercase",marginBottom:8,fontWeight:500}}>Fleet Management</div>
          <div style={{fontSize:26,fontWeight:700,color:C.text,letterSpacing:-.5,lineHeight:1}}>Operanzia</div>
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
          // getUserProfileSafe: fuerza servidor para evitar caché
          // desactualizada justo tras iniciar sesión, pero con timeout —
          // en mala cobertura (muy típico de un conductor en la calle) ya
          // no se queda cargando para siempre.
          const snap=await getUserProfileSafe(user.uid);
          if(snap.exists()&&snap.data().activo!==false){
            setSesion({uid:user.uid,id:user.uid,...snap.data()});
            setErrorUser({uid:user.uid,...snap.data()});
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
  async function addPlan(plan){ await fbAdd("planes",{conductorUid:null,...plan,org_id:sesion.org_id}); }
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

  if(!sesion) return <Login/>;

  const esIntermedio = sesion.rol==="intermedio";
  const esAdmin = puedeGestionarRutasRol(sesion.rol); // admin/intermedio/superadmin
  // Intermedio solo tiene Rutas (gestión completa) + Admin (KPIs de rutas y
  // Usuarios, ver PanelAdminRutas) — Incidencias/Inventario no están en su
  // alcance (roles.js). Field/Admin/Superadmin siguen viendo esas dos tal
  // cual las veían antes de este cambio.
  const TABS=[
    ...(hayBus?[{key:"turno",icon:"🚌",label:"Mi turno"}]:[]),
    {key:"rutas",      icon:"🗺️", label:"Rutas"},
    ...(esIntermedio ? [] : [
      {key:"incidencias",icon:"📋", label:"Incidencias"},
      {key:"inventario", icon:"📦", label:"Inventario"},
    ]),
    ...(esAdmin?[{key:"admin",icon:"⚙️",label:"Admin"}]:[]),
  ];
  const TAB_TITLES={turno:"Mi turno",rutas:"Rutas de servicio",incidencias:"Canal de incidencias",inventario:"Inventario",admin:"Panel de administración"};

  return(
    <div style={S.page}>
      <div style={{...S.header,background:"rgba(22,27,39,0.96)",borderBottom:`1px solid ${C.border}`}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{fontSize:11,color:C.dim,letterSpacing:2,textTransform:"uppercase",fontWeight:600}}>Operanzia</div>
          <div style={{width:1,height:16,background:C.border2}}/>
          <div style={{fontSize:14,fontWeight:600,color:C.text}}>{TAB_TITLES[tab]||tab}</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:11,color:C.text,fontWeight:500}}>{sesion.nombre}</div>
            <div style={{fontSize:9,color:C.dim,letterSpacing:.5,textTransform:"uppercase"}}>{roleLabel(sesion.rol)}</div>
          </div>
          <div onClick={()=>signOut(auth)} title="Cerrar sesión" style={{width:34,height:34,borderRadius:"50%",cursor:"pointer",background:C.surface2,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:600,color:C.muted,transition:"all .15s"}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor=C.border2;e.currentTarget.style.color=C.text;}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.color=C.muted;}}>
            {avatarOf(sesion)}
          </div>
        </div>
      </div>

      {tab==="turno"&&<MiTurno sesion={sesion} servicios={servicios} cuadrantes={cuadrantesBus}/>}
      {tab==="rutas"&&<ListaPlanes planes={planes} addPlan={addPlan} updatePlan={updatePlan} deletePlan={deletePlan} sesion={sesion} usuarios={usuarios}/>}
      {tab==="incidencias"&&<ModuloIncidencias sesion={sesion} usuarios={usuarios}/>}
      {tab==="inventario"&&<ModuloInventario sesion={sesion} usuarios={usuarios}/>}
      {tab==="admin"&&esAdmin&&<PanelAdminRutas planes={planes} usuarios={usuarios} deletePlan={deletePlan} sesion={sesion}/>}

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
