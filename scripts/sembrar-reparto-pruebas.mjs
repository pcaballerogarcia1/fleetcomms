// Proyecto de ejemplo de reparto en el ENTORNO DE PRUEBAS (operanzia-pruebas,
// nunca el real): una distribuidora con almacén en Murcia, 14 camiones de 3 a
// 32 palés y una semana de pedidos (alrededores de Murcia, toda la península,
// Baleares y Canarias), algunos con «solo este día». Para ver Rutas › Semana
// de reparto. Se puede repetir: rehace el proyecto y los pedidos de la semana.
//
//   node scripts/sembrar-reparto-pruebas.mjs
//
// Entra como scripts/sembrar-pruebas.mjs: cuenta temporal de siembra, reglas
// temporales, datos y vuelta a las reglas de verdad (también si falla).
import { randomBytes } from "node:crypto";
import { CLAVE_WEB, DOMINIO, ID, ORG, PROYECTO, cuenta, escribirLote, firebase } from "./sembrar-pruebas.mjs";

const PID = "reparto-semana-ejemplo";
const BASE = { nombre: "Almacén Murcia", lat: 37.9922, lng: -1.1307 };
const CAMIONES = [32, 32, 26, 26, 24, 20, 18, 16, 14, 12, 10, 8, 6, 3];

// [población, lat, lng, palés, día (0 = lunes), solo ese día]
const CERCA = [
  ["Murcia (El Carmen)", 37.9790, -1.1290, 4, 0, true], ["Murcia (Espinardo)", 38.0090, -1.1500, 3, 0], ["Molina de Segura", 38.0546, -1.2075, 5, 0, true],
  ["Alcantarilla", 37.9692, -1.2170, 2, 0], ["Cartagena", 37.6257, -0.9966, 6, 1, true], ["Torre-Pacheco", 37.7430, -0.9530, 3, 1],
  ["San Javier", 37.8060, -0.8370, 2, 1], ["Lorca", 37.6771, -1.7006, 5, 1, true], ["Totana", 37.7690, -1.5040, 2, 2],
  ["Alhama de Murcia", 37.8510, -1.4250, 3, 2], ["Cieza", 38.2390, -1.4190, 4, 2, true], ["Orihuela", 38.0848, -0.9440, 3, 2],
  ["Elche", 38.2669, -0.6983, 6, 3, true], ["Alicante", 38.3452, -0.4810, 7, 3], ["Torrevieja", 37.9780, -0.6820, 3, 3],
  ["Mazarrón", 37.5990, -1.3150, 2, 3], ["Yecla", 38.6140, -1.1150, 3, 4, true], ["Jumilla", 38.4760, -1.3260, 2, 4], ["Caravaca", 38.1060, -1.8610, 3, 4],
];
const LEJOS = [
  ["Madrid (Mercamadrid)", 40.3600, -3.6700, 12, 0], ["Getafe", 40.3050, -3.7320, 6, 1], ["Valencia", 39.4699, -0.3763, 9, 0], ["Castellón", 39.9864, -0.0513, 5, 1],
  ["Barcelona", 41.3874, 2.1686, 10, 0], ["Tarragona", 41.1189, 1.2445, 4, 1], ["Zaragoza", 41.6488, -0.8891, 8, 1], ["Bilbao", 43.2630, -2.9350, 7, 0],
  ["Vitoria", 42.8467, -2.6716, 4, 1], ["Valladolid", 41.6523, -4.7245, 6, 1], ["A Coruña", 43.3623, -8.4115, 8, 0], ["Vigo", 42.2406, -8.7207, 5, 1],
  ["Oviedo", 43.3603, -5.8448, 6, 1], ["Sevilla", 37.3891, -5.9845, 10, 0], ["Huelva", 37.2614, -6.9447, 4, 2], ["Málaga", 36.7213, -4.4214, 9, 1],
  ["Granada", 37.1773, -3.5986, 6, 2], ["Córdoba", 37.8882, -4.7794, 5, 2], ["Almería", 36.8340, -2.4637, 5, 3, true], ["Albacete", 38.9943, -1.8585, 6, 3],
  ["Badajoz", 38.8794, -6.9707, 4, 2], ["Toledo", 39.8628, -4.0273, 4, 3],
  ["Palma (Baleares)", 39.5696, 2.6502, 6, 0], ["Ibiza (Baleares)", 38.9067, 1.4206, 3, 0], ["Las Palmas (Canarias)", 28.1235, -15.4363, 5, 0], ["Santa Cruz de Tenerife (Canarias)", 28.4636, -16.2518, 4, 0],
];
const TIPOS = ["Bodega", "Supermercado", "Mayorista", "Hostelería", "Cash & carry"];

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** El lunes de esta semana o, en fin de semana, el de la siguiente (lo que abre la pantalla) */
function lunes() {
  const d = new Date(), w = d.getDay();
  d.setDate(d.getDate() + (w === 0 ? 1 : w === 6 ? 2 : 1 - w));
  return d;
}

function datos() {
  const l = lunes(), docs = [];
  const fecha = n => { const d = new Date(l); d.setDate(d.getDate() + n); return ymd(d); };
  docs.push([`scheduling_projects/${PID}`, { org_id: ORG, nombre: "Reparto semanal (ejemplo)", tipo: "puntos", sector: "distribucion", mes: fecha(0).slice(0, 7), createdAt: Date.now(), status: "borrador" }]);
  docs.push([`planning_depots/${PID}`, { projectId: PID, orgId: ORG, depots: [{ id: "almacen", ...BASE }], updatedAt: Date.now() }]);
  CAMIONES.forEach((palets, i) => docs.push([`scheduling_vehicles/rep-c${i + 1}`, {
    org_id: ORG, nombre: `Camión ${String(i + 1).padStart(2, "0")}`, matricula: `${4100 + i}REP`, tipo: palets >= 20 ? "Tráiler" : palets >= 10 ? "Rígido" : "Furgón", cargaMax: palets, activo: true,
  }]));
  [...CERCA, ...LEJOS].forEach(([pob, lat, lng, palets, dia, fija], i) => {
    const nombre = `${TIPOS[i % TIPOS.length]} ${pob.replace(/ \(.*\)$/, "")}`;
    docs.push([`pedidos/rep-${i + 1}`, {
      org_id: ORG, projectId: PID, fecha: fecha(dia), fechaFija: !!fija,
      cliente: { clave: null, nombre, direccion: pob, lat, lng, telefono: "", contacto: "" },
      ref: `PED-${String(1001 + i)}`, bultos: palets, kg: palets * 550, desde: "", hasta: "", duracion: null, notas: "",
      estado: "pendiente", origen: "manual", fijoId: null, creadoEn: Date.now() + i,
    }]);
  });
  return { docs, desde: fecha(0) };
}

async function main() {
  const s = await cuenta(`siembra@${DOMINIO}`, randomBytes(12).toString("hex"));
  try {
    console.log(`Entorno de pruebas (${PROYECTO}): reglas temporales de siembra…`);
    firebase("deploy --only firestore:rules --config scripts/pruebas/firebase.siembra.json");
    const { docs, desde } = datos();
    await escribirLote(s.idToken, docs);
    console.log(`${docs.length} documentos: proyecto «Reparto semanal (ejemplo)», ${CAMIONES.length} camiones, ${CERCA.length + LEJOS.length} pedidos de la semana del ${desde}.`);
  } finally {
    console.log("Volviendo a poner las reglas de verdad…");
    firebase("deploy --only firestore:rules");
    await fetch(`${ID}/accounts:delete?key=${CLAVE_WEB}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: s.idToken }) });
  }
}

main().catch(e => { console.error(e.message || e); process.exitCode = 1; });
