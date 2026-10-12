// App del conductor → Inventario (almacén).
import { useState, useEffect } from "react";
import { db } from "../firebase.js";
import { collection, onSnapshot, doc, serverTimestamp, query, where, orderBy, limit, runTransaction } from "firebase/firestore";
import { C, CATS_INV, S, VEHICULOS, avatarOf, fbAdd, fbDelete, mono, timeAgo, useCollection } from "./comun.js";

export function ModuloInventario({sesion,usuarios}){
  const {data:productos}   = useCollection("inventario","nombre",sesion.org_id);
  const [vista,setVista]           = useState("lista");
  const [selId,setSelId]           = useState(null);
  // Solo los movimientos del producto abierto (antes se descargaban los de
  // toda la organización para enseñar la lista de productos)
  const [movimientos,setMovimientos]=useState([]);
  useEffect(()=>{
    if(!selId||!sesion.org_id) return; // movsProd ya filtra por el producto abierto
    const q=query(collection(db,"movimientos"),where("org_id","==",sesion.org_id),where("productoId","==",selId),orderBy("fecha","desc"),limit(50));
    return onSnapshot(q,snap=>setMovimientos(snap.docs.map(d=>({...d.data(),_id:d.id}))),e=>console.error("movimientos:",e));
  },[selId,sesion.org_id]);
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
    // En una transacción: con el stock REAL del servidor (otro puede haber
    // movido stock mientras), y el movimiento se escribe a la vez.
    let antes, despues;
    try{
      await runTransaction(db, async tx=>{
        const ref=doc(db,"inventario",selId);
        const s=await tx.get(ref);
        antes=s.data()?.stock||0;
        if(formMov.tipo==="salida" && cant>antes) throw Object.assign(new Error(`Stock insuficiente. Disponible: ${antes} ${prodActual.unidad}`),{stock:true});
        despues=formMov.tipo==="entrada"?antes+cant:antes-cant;
        tx.update(ref,{stock:despues});
        tx.set(doc(collection(db,"movimientos")),{
          productoId:selId, tipo:formMov.tipo, cantidad:cant,
          vehiculo:formMov.vehiculo, motivo:formMov.motivo, nota:formMov.nota,
          stockAntes:antes, stockDespues:despues,
          usuarioId:sesion.uid, org_id:sesion.org_id, fecha:serverTimestamp(),
        });
      });
    }catch(e){ setErrForm(e.stock?e.message:"No se pudo registrar el movimiento (¿sin conexión?): "+(e.message||e)); return; }
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
