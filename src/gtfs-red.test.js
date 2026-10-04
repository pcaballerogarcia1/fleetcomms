import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { parseGtfsRed, franjaDe, kmTrazado, nombreCalendario } from "./gtfs-red.js";
import { salidasDe, generarServicio, nombreDia } from "./lineas-sched.js";
import { tiempoEfectivo } from "./lineas-store.js";
import { vi } from "vitest";
vi.mock("./firebase.js", () => ({ db: {} }));

// Red mínima: línea 1 con ida y vuelta, laborable y sábado; un viaje partido en stop_times
function red({ conCalendario = true } = {}) {
  const f = {
    "agency.txt": "agency_id,agency_name\nA,EMT Prueba\n",
    "routes.txt": "route_id,agency_id,route_short_name,route_long_name,route_type,route_color\nL1,A,1,,3,\nC2,A,C2,Circular,3,00AA00\n",
    "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\nP1,Plaza Mayor,40.40,-3.70\nP2,Ayuntamiento,40.41,-3.71\nP3,Estación,40.42,-3.72\nP9,Sin usar,40.5,-3.8\n",
    "trips.txt": "route_id,service_id,trip_id,direction_id,trip_headsign,shape_id\n" +
      "L1,LAB,i1,0,Estación,S0\nL1,LAB,i2,0,Estación,S0\nL1,LAB,v1,1,Plaza Mayor,\nL1,SAB,i3,0,Estación,S0\nC2,LAB,c1,0,,\n",
    "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n" +
      "i1,07:00:00,07:00:00,P1,1\ni1,07:10:00,07:10:00,P2,2\n" +           // i1 partido: sigue más abajo
      "i2,17:00:00,17:00:00,P1,1\ni2,17:15:00,17:15:00,P2,2\ni2,17:40:00,17:40:00,P3,3\n" +
      "i1,07:30:00,07:30:00,P3,3\n" +
      "v1,24:10:00,24:10:00,P3,1\nv1,24:30:00,24:30:00,P1,2\n" +
      "i3,09:00:00,09:00:00,P1,1\ni3,09:20:00,09:20:00,P3,2\n" +
      "c1,10:00:00,10:00:00,P2,1\nc1,10:05:00,10:05:00,P3,2\nc1,10:12:00,10:12:00,P2,3\n",
    "shapes.txt": "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nS0,40.40,-3.70,1\nS0,40.415,-3.71,2\nS0,40.42,-3.72,3\n",
  };
  if (conCalendario) {
    // 2026-10-05 lunes · 2026-10-10 sábado
    f["calendar.txt"] = "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nLAB,1,1,1,1,1,0,0,20261005,20261009\n";
    f["calendar_dates.txt"] = "service_id,date,exception_type\nSAB,20261010,1\nLAB,20261007,2\n";
  }
  return new Blob([zipSync(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, strToU8(v)])))]);
}

describe("red de líneas desde GTFS", () => {
  it("ida y vuelta, secuencia, cabecera, recorrido y viajes por tipo de día", async () => {
    const r = await parseGtfsRed(red());
    expect(r.dias).toEqual({ laborable: "2026-10-05", sabado: "2026-10-10", festivo: null });
    expect(r.paradas.map(p => p.id).sort()).toEqual(["P1", "P2", "P3"]); // P9 no la usa ninguna línea
    const l1 = r.lineas.find(l => l.id === "L1");
    expect(l1.sentidos.map(s => s.nombre)).toEqual(["Ida", "Vuelta"]);
    const [ida, vuelta] = l1.sentidos;
    expect(ida).toMatchObject({ cabecera: "Estación", paradas: ["P1", "P2", "P3"], viajes: { laborable: 2, sabado: 1, festivo: 0 }, primera: "07:00", ultima: "17:00" });
    expect(ida.trazado).toHaveLength(3);
    expect(ida.km).toBeGreaterThan(2);
    // vuelta sin recorrido en el GTFS: se une la secuencia de paradas; madrugada como (+1)
    expect(vuelta).toMatchObject({ cabecera: "Plaza Mayor", paradas: ["P3", "P1"], primera: "00:10 (+1)" });
    expect(vuelta.trazado).toHaveLength(2);
    // tiempos por franja (viaje partido i1 recompuesto con lo que hay)
    expect(ida.tiempos.find(t => t.franja === "16-20")).toEqual({ franja: "16-20", min: 40, viajes: 1 });
    expect(ida.tiempos.find(t => t.franja === "06-09")?.viajes).toBe(1);
    expect(vuelta.tiempos).toEqual([{ franja: "00-06", min: 20, viajes: 1 }]);
    expect(r.viajesPartidos).toBe(1);
    const c2 = r.lineas.find(l => l.id === "C2");
    expect(c2).toMatchObject({ nombre: "C2", largo: "Circular", color: "#00aa00", agencia: "EMT Prueba" });
    expect(c2.sentidos[0]).toMatchObject({ cabecera: "Ayuntamiento", paradas: ["P2", "P3", "P2"] });
  });

  it("calendarios: días con los mismos servicios, con nombre, y sus salidas", async () => {
    const r = await parseGtfsRed(red());
    // LAB funciona lun 5, mar 6, jue 8 y vie 9 (el mié 7 quitado); SAB el sáb 10
    expect(r.calendarios.map(c => ({ id: c.id, fechas: c.fechas, codigos: c.codigos, viajes: c.viajes }))).toEqual([
      { id: "cal:1", fechas: ["2026-10-05", "2026-10-06", "2026-10-08", "2026-10-09"], codigos: ["LAB"], viajes: 4 },
      { id: "cal:2", fechas: ["2026-10-10"], codigos: ["SAB"], viajes: 1 },
    ]);
    expect(r.calendarios[1].nombre).toBe("Solo el sábado 10 oct");
    const ida = r.lineas.find(l => l.id === "L1").sentidos[0];
    expect(salidasDe(ida, "cal:1", r)).toEqual({ lista: [420, 1020], aproximado: false });
    expect(salidasDe(ida, "cal:2", r).lista).toEqual([540]);
    expect(salidasDe(ida, "laborable", r).lista).toEqual([420, 1020]); // los tipos de día siguen igual
    expect(generarServicio(r, {}, { dia: "cal:2" }).kpis.viajes).toBe(1);
    expect(nombreDia("cal:2", r)).toBe("Solo el sábado 10 oct");
    expect(nombreDia("cal:9", r)).toMatch(/ya no está/);
  });

  it("nombre de los calendarios", () => {
    const dias = (desde, n, paso = 1) => Array.from({ length: n }, (_, k) => new Date(Date.UTC(2026, 8, desde + k * paso)).toISOString().slice(0, 10));
    const lab = dias(7, 5).concat(dias(14, 5), dias(21, 5)); // lun 7 – vie 25 sep
    expect(nombreCalendario(lab)).toBe("Lunes a viernes · 7 sep – 25 sep");
    expect(nombreCalendario(dias(13, 4, 7).concat(["2026-10-12"]).sort())).toBe("Domingos y festivos · 13 sep – 12 oct");
    expect(nombreCalendario(dias(12, 3, 7))).toBe("Sábados · 12 sep – 26 sep");
    expect(nombreCalendario(["2026-09-24", "2026-09-26", "2026-10-02"])).toBe("Días 24, 26 sep y 2 oct");
    expect(nombreCalendario(["2026-09-24", "2026-09-26", "2026-10-01"])).toBe("Jueves y 1 día más · 24 sep – 1 oct");
    expect(nombreCalendario(dias(11, 4, 7))).toBe("Viernes · 11 sep – 2 oct");
  });

  it("sin calendario: todo cuenta como laborable", async () => {
    const r = await parseGtfsRed(red({ conCalendario: false }));
    const ida = r.lineas.find(l => l.id === "L1").sentidos[0];
    expect(ida.viajes).toEqual({ laborable: 3, sabado: 0, festivo: 0 });
  });

  it("utilidades: franja horaria y km", () => {
    expect([franjaDe(7 * 60), franjaDe(23 * 60), franjaDe(25 * 60), franjaDe(0)]).toEqual(["06-09", "20-24", "00-06", "00-06"]);
    expect(kmTrazado([[40.4, -3.7], [40.5, -3.7]])).toBeCloseTo(11.1, 0);
  });

  it("tiempo efectivo: el corregido a mano manda sobre el calculado", () => {
    const s = { dir: 0, tiempos: [{ franja: "06-09", min: 39, viajes: 30 }] };
    expect(tiempoEfectivo(s, "06-09", null)).toEqual({ min: 39, manual: false, viajes: 30 });
    expect(tiempoEfectivo(s, "06-09", { tiempos: { "0|06-09": 45 } })).toEqual({ min: 45, manual: true });
    expect(tiempoEfectivo(s, "13-16", {})).toEqual({ min: null, manual: false, viajes: 0 });
  });
});
