// Ayudas comunes de las pruebas de extremo a extremo
import { expect } from "@playwright/test";
import { zipSync, strToU8 } from "fflate";
import { CLAVE } from "./semilla.mjs";

// el navegador de pruebas no da la ubicación: ese aviso no es un fallo
const IGNORAR = [/geolocalizaci/i, /Geolocation/i];
export function vigilarErrores(page) {
  const errores = [];
  page.on("pageerror", e => errores.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !IGNORAR.some(r => r.test(m.text()))) errores.push(m.text()); });
  return errores;
}

export async function entrarOficina(page, email = "admin@demo.test") {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', CLAVE);
  await page.getByRole("button", { name: "Acceder" }).click();
  await page.waitForURL(/\/projects/);
}

export async function entrarCampo(page, email) {
  await page.goto("/rutas");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', CLAVE);
  await page.keyboard.press("Enter");
  await expect(page.getByText("Selecciona tipo de trabajo", { exact: false })).toBeVisible();
}

/**
 * GTFS pequeño: líneas L1 (A↔B) y L2 (C↔D), con B y C a ~1 km (para que haya
 * vacíos entre cabeceras), servicio de lunes a viernes cada 20 min de 6 a 22 h.
 * Devuelve el .zip como Buffer.
 */
export function gtfsMini() {
  const paradas = [["A", 40.40, -3.70], ["M1", 40.41, -3.70], ["B", 40.42, -3.70], ["C", 40.429, -3.70], ["M2", 40.44, -3.70], ["D", 40.45, -3.70]];
  const lineas = [["L1", ["A", "M1", "B"], 25], ["L2", ["C", "M2", "D"], 20]];
  const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`;
  let trips = "route_id,service_id,trip_id,direction_id,trip_headsign\n", times = "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n";
  for (const [ruta, secuencia, dur] of lineas) {
    for (const dir of [0, 1]) {
      const seq = dir ? [...secuencia].reverse() : secuencia;
      for (let t = 6 * 60 + dir * 10; t <= 22 * 60; t += 20) {
        const id = `${ruta}_${dir}_${t}`;
        trips += `${ruta},LAB,${id},${dir},${seq.at(-1)}\n`;
        seq.forEach((s, i) => { const m = t + Math.round((dur * i) / (seq.length - 1)); times += `${id},${hhmm(m)},${hhmm(m)},${s},${i + 1}\n`; });
      }
    }
  }
  const hoy = new Date();
  const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, "");
  const fin = new Date(hoy.getTime() + 60 * 86400000);
  const f = {
    "agency.txt": "agency_id,agency_name\nE2E,Autobuses de prueba\n",
    "routes.txt": "route_id,agency_id,route_short_name,route_long_name,route_type,route_color\nL1,E2E,L1,A - B,3,1F77B4\nL2,E2E,L2,C - D,3,D62728\n",
    "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\n" + paradas.map(([id, la, lo]) => `${id},Parada ${id},${la},${lo}`).join("\n") + "\n",
    "trips.txt": trips,
    "stop_times.txt": times,
    "calendar.txt": `service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nLAB,1,1,1,1,1,0,0,${ymd(hoy)},${ymd(fin)}\n`,
  };
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, strToU8(v)]))));
}
