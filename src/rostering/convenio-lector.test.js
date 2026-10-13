import { describe, it, expect } from "vitest";
import { leerConvenio } from "./convenio-lector.js";

// Trozos con la redacción habitual de convenios reales (limpieza, transporte, residuos)
const PAGINA1 = `CONVENIO COLECTIVO DE LIMPIEZA PÚBLICA VIARIA Y RECOGIDA DE RESIDUOS DE LA PROVINCIA DE SALAMANCA (Código de convenio n.º 37 000375 01 1997).
Artículo 3. Vigencia y duración.
El presente convenio tendrá vigencia desde el 1 de enero de 2025 hasta el 31 de diciembre de 2027.
Artículo 18. Jornada de trabajo.
La jornada laboral será de 1.750 horas de trabajo efectivo en cómputo anual. La jornada diaria no podrá exceder de nueve (9) horas de trabajo efectivo.`;
const PAGINA2 = `Artículo 19. Descansos.
Entre el final de una jornada y el comienzo de la siguiente deberán mediar, como mínimo, doce horas.
Los trabajadores tendrán derecho a un descanso semanal de día y medio ininterrumpido. Ningún trabajador podrá trabajar más de seis días consecutivos.
Se garantizan dos días de descanso consecutivos cada semana y al menos un fin de semana libre al mes.
Artículo 21. Trabajo nocturno.
No se podrán realizar más de cinco noches consecutivas.`;

describe("leer un convenio", () => {
  const r = leerConvenio([PAGINA1, PAGINA2]);
  it("saca las reglas con su artículo, la frase y la página", () => {
    expect(r.reglas.jornadaAnualH).toMatchObject({ valor: 1750, art: "art. 18", pagina: 1 });
    expect(r.reglas.jornadaAnualH.frase).toContain("1.750 horas de trabajo efectivo");
    expect(r.reglas.maxHorasDia).toMatchObject({ valor: 9, art: "art. 18" });
    expect(r.reglas.descansoMinH).toMatchObject({ valor: 12, art: "art. 19", pagina: 2 });
    expect(r.reglas.descansoSemanalH).toMatchObject({ valor: 36, art: "art. 19" });
    expect(r.reglas.maxDiasSeguidos).toMatchObject({ valor: 6, art: "art. 19" });
    expect(r.reglas.minLibresSeguidos).toMatchObject({ valor: 2 });
    expect(r.reglas.minFindesLibres).toMatchObject({ valor: 1 });
    expect(r.reglas.maxNochesSeguidas).toMatchObject({ valor: 5, art: "art. 21" });
  });
  it("lo que no dice, no se lo inventa", () => {
    expect(r.reglas.maxHorasMes).toBeUndefined();
    expect(r.reglas.maxDomingosFestivos).toBeUndefined();
  });
  it("nombre, código y vigencia", () => {
    expect(r.meta.vigencia).toBe("2025–2027");
    expect(r.meta.codigo).toBe("37000375011997");
    expect(r.meta.nombre).toMatch(/^Convenio colectivo de limpieza pública viaria/i);
  });
  it("otras redacciones", () => {
    const x = leerConvenio([`Art. 12. Las horas ordinarias de trabajo efectivo no podrán ser superiores a 8 horas diarias.
Art. 13. Se establece un descanso mínimo entre jornadas de 14 horas. El descanso semanal será de 48 horas.
Art. 14. La jornada máxima será de 160 horas mensuales. No se podrán trabajar más de 3 domingos al mes.`]);
    expect(x.reglas.maxHorasDia).toMatchObject({ valor: 8, art: "art. 12" });
    expect(x.reglas.descansoMinH).toMatchObject({ valor: 14, art: "art. 13" });
    expect(x.reglas.descansoSemanalH).toMatchObject({ valor: 48 });
    expect(x.reglas.maxHorasMes).toMatchObject({ valor: 160, art: "art. 14" });
    expect(x.reglas.maxDomingosFestivos).toMatchObject({ valor: 3 });
  });
  it("valores fuera de lo razonable no se toman (p. ej. «2 horas diarias» de formación)", () => {
    const x = leerConvenio(["La formación será de 2 horas diarias. El descanso entre jornadas será de 30 horas para el turno especial."]);
    expect(x.reglas.maxHorasDia).toBeUndefined();
    expect(x.reglas.descansoMinH).toBeUndefined();
  });
  it("un PDF escaneado (sin texto) se reconoce", () => {
    expect(leerConvenio(["", " "]).sinTexto).toBe(true);
    expect(r.sinTexto).toBe(false);
  });
});

describe("más formas de decirlo (sacadas de un PDF de prueba)", () => {
  const x = leerConvenio([`CONVENIO COLECTIVO DE LIMPIEZA PÚBLICA VIARIA DE LA PROVINCIA DE EJEMPLO Código de convenio n.º 37000375011997.
Artículo 15. Jornada laboral. La jornada de trabajo para todo el personal afectado por el presente convenio será de treinta y siete horas y media semanales de trabajo efectivo, lo que supone en cómputo anual un total de 1.712 horas de trabajo efectivo.
Artículo 16. Descansos. El personal tendrá derecho a un descanso mínimo semanal de dos días ininterrumpidos.`]);
  it("cómputo anual, descanso mínimo semanal y el nombre sin el código", () => {
    expect(x.reglas.jornadaAnualH).toMatchObject({ valor: 1712, art: "art. 15" });
    expect(x.reglas.descansoSemanalH).toMatchObject({ valor: 48, art: "art. 16" });
    expect(x.reglas.minLibresSeguidos).toMatchObject({ valor: 2, art: "art. 16" });
    expect(x.meta.nombre).toBe("CONVENIO COLECTIVO DE LIMPIEZA PÚBLICA VIARIA DE LA PROVINCIA DE EJEMPLO");
  });
});

describe("la frase citada", () => {
  it("si es muy larga, se corta en un espacio y con «…», nunca a mitad de palabra", () => {
    const largo = "La jornada de trabajo para todo el personal afectado por el presente convenio colectivo provincial de limpieza será de treinta y siete horas y media semanales de trabajo efectivo, lo que supone en cómputo anual un total de 1.712 horas de trabajo efectivo";
    const f = leerConvenio([largo + "."]).reglas.jornadaAnualH.frase;
    expect(f.startsWith("…")).toBe(true);
    expect(f).toMatch(/^… ?[A-Za-zÁÉÍÓÚáéíóúñ]+ /);
    expect(largo).toContain(f.slice(1).split(" ")[0] + " ");
    expect(f).toContain("1.712 horas");
  });
});
