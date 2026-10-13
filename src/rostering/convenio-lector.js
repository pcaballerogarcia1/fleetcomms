// Rostering → Reglas: leer un convenio colectivo (su texto) y proponer las
// reglas del cuadrante, cada una con el artículo y la frase de donde sale.
// Sin IA: busca las formas habituales en que los convenios fijan la jornada,
// los descansos, los días seguidos… Lo que no encuentra no se inventa: queda
// para buscarlo a mano en el PDF. Sin React ni Firebase.

// Números escritos con letra (lo habitual en los convenios: «doce horas»)
const PALABRAS = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, treinta: 30,
  "treinta y seis": 36, "cuarenta y ocho": 48, "setenta y dos": 72,
};
const PAL = Object.keys(PALABRAS).sort((a, b) => b.length - a.length).join("|");
// un número: «12», «1.750», «doce», «doce (12)»
const NUM = `(\\d{1,2}\\.\\d{3}|\\d{1,4}|${PAL})(?:\\s*\\(\\d{1,4}\\))?`;
const leerNum = t => {
  const s = String(t).trim();
  if (/^\d{1,2}\.\d{3}$/.test(s)) return Number(s.replace(".", ""));
  if (/^\d+$/.test(s)) return Number(s);
  return PALABRAS[s] ?? null;
};

// Texto para buscar: minúsculas y sin tildes, con la misma longitud que el
// original (así la frase que se enseña sale del texto de verdad)
function paraBuscar(t) {
  let o = "";
  for (const c of t) {
    const b = c.normalize("NFD")[0] || c;
    o += c.length === 1 ? b.toLowerCase() : c.toLowerCase().padEnd(c.length, " ");
  }
  return o;
}

// «descanso semanal», «descanso mínimo semanal», «descanso ininterrumpido semanal»…
const SEMANAL = "descanso (?:minimo |ininterrumpido )?semanal";

// Cada regla: patrones (sobre el texto normalizado) → valor; rango razonable
const R = (patron, valor = m => leerNum(m[1])) => ({ re: new RegExp(patron, "g"), valor });
const REGLAS = {
  jornadaAnualH: {
    rango: [1200, 2200],
    pat: [
      R(`(\\d{1,2}\\.\\d{3}|\\d{4})\\s*horas[^.;]{0,70}?(?:anuales|al ano|en computo anual|anualmente|de trabajo efectivo al ano)`),
      R(`jornada[^.;]{0,40}?anual[^.;]{0,140}?(\\d{1,2}\\.\\d{3}|\\d{4})\\s*horas`),
      R(`(?:computo|calculo) anual[^.;]{0,60}?(\\d{1,2}\\.\\d{3}|\\d{4})\\s*horas`),
    ],
  },
  maxHorasMes: {
    rango: [80, 260],
    pat: [R(`(\\d{2,3})\\s*horas[^.;]{0,35}?(?:mensuales|al mes|en computo mensual|cada mes)`)],
  },
  maxHorasDia: {
    rango: [5, 14],
    pat: [
      R(`(?:jornada|trabajo efectivo|horas ordinarias)[^.;]{0,80}?(?:diaria|al dia|por dia|cada dia)[^.;]{0,80}?${NUM}\\s*horas`),
      R(`(?<!descanso[^.;]{0,40})${NUM}\\s*horas[^.;]{0,30}?(?:diarias|al dia|por dia|de trabajo efectivo diario)`),
    ],
  },
  descansoMinH: {
    rango: [8, 24],
    pat: [
      R(`entre (?:el final|el fin|la terminacion|la finalizacion)[^.;]{0,60}?jornada[^.;]{0,90}?${NUM}\\s*horas`),
      R(`descanso[^.;]{0,30}?entre jornadas[^.;]{0,90}?${NUM}\\s*horas`),
      R(`${NUM}\\s*horas[^.;]{0,40}?entre (?:una |cada )?jornadas?`),
    ],
  },
  descansoSemanalH: {
    rango: [24, 72],
    pat: [
      R(`${SEMANAL}[^.;]{0,140}?(dia y medio)`, () => 36),
      R(`${SEMANAL}[^.;]{0,140}?${NUM}\\s*horas`),
      R(`${SEMANAL}[^.;]{0,140}?(dos|2) dias`, () => 48),
    ],
  },
  maxDiasSeguidos: {
    rango: [3, 14],
    pat: [
      R(`(?:mas de|maximo de|superior a|exceder de|sobrepasar(?: los)?|no podra trabajar(?: mas de)?)\\s*${NUM}\\s*dias[^.;]{0,25}?(?:consecutivos|seguidos|continuados|ininterrumpidos|de trabajo consecutivo)`),
      R(`${NUM}\\s*dias (?:consecutivos|seguidos) de trabajo como maximo`),
    ],
  },
  minLibresSeguidos: {
    rango: [2, 4],
    pat: [
      R(`${NUM}\\s*dias[^.;]{0,25}?(?:de descanso|libres)[^.;]{0,25}?(?:consecutivos|seguidos|ininterrumpidos)`),
      R(`${SEMANAL}[^.;]{0,140}?(dos|2) dias[^.;]{0,30}?(?:consecutivos|seguidos|ininterrumpidos)`),
    ],
  },
  minFindesLibres: {
    rango: [1, 4],
    pat: [
      R(`${NUM}\\s*fin(?:es)? de semana[^.;]{0,50}?(?:libres?|de descanso)[^.;]{0,40}?(?:al mes|cada mes|mensual)`),
      R(`(?:al menos|como minimo|un minimo de)\\s*${NUM}\\s*fin(?:es)? de semana`),
    ],
  },
  maxNochesSeguidas: {
    rango: [1, 14],
    pat: [R(`${NUM}\\s*noches[^.;]{0,20}?(?:consecutivas|seguidas)`)],
  },
  maxNochesMes: {
    rango: [1, 31],
    pat: [R(`${NUM}\\s*noches[^.;]{0,30}?(?:al mes|mensuales|cada mes)`)],
  },
  maxDomingosFestivos: {
    rango: [1, 5],
    pat: [R(`(?:no podra|como maximo|maximo de|mas de)[^.;]{0,40}?${NUM}\\s*(?:domingos|festivos)[^.;]{0,40}?(?:al mes|cada mes|mensuales)`)],
  },
};

// Los artículos del texto: posición → «art. 23»
function articulos(norm) {
  const out = [];
  const re = /(?:^|[\s\n])art(?:iculo|\.)\s*(\d{1,3}(?:\.\d{1,2})?(?:\s*bis)?)\b/g;
  let m;
  while ((m = re.exec(norm))) out.push({ pos: m.index, art: `art. ${m[1].replace(/\s+/g, " ")}` });
  return out;
}
const articuloEn = (arts, pos) => { let a = null; for (const x of arts) { if (x.pos > pos) break; a = x.art; } return a; };

// La frase de alrededor, del texto original (para enseñarla)
function frase(orig, ini, fin) {
  let a = ini, b = fin;
  while (a > 0 && ini - a < 160 && !/[.;\n]/.test(orig[a - 1])) a--;
  while (b < orig.length && b - fin < 160 && !/[.;\n]/.test(orig[b])) b++;
  // si se ha cortado por largo, en un espacio (no a mitad de palabra) y con «…»
  const cortadoAntes = a > 0 && !/[.;\n]/.test(orig[a - 1]);
  const cortadoDespues = b < orig.length && !/[.;\n]/.test(orig[b]);
  if (cortadoAntes) { const e = orig.indexOf(" ", a); if (e >= a && e < ini) a = e + 1; }
  if (cortadoDespues) { const e = orig.lastIndexOf(" ", b); if (e > fin) b = e - 1; }
  const t = orig.slice(a, b + 1).replace(/\s+/g, " ").trim();
  return (cortadoAntes ? "…" : "") + t + (cortadoDespues ? "…" : "");
}

/**
 * Lee el convenio: paginas = [texto de cada página].
 * → { reglas: { clave: { valor, art, frase, pagina } }, meta: { nombre, codigo, vigencia }, sinTexto }
 */
export function leerConvenio(paginas) {
  const orig = (paginas || []).join("\n\f\n");
  const sinTexto = orig.replace(/\s/g, "").length < 200;
  const norm = paraBuscar(orig).replace(/-\n/g, "  ").replace(/­/g, " ");
  const plano = norm.replace(/[\n\f]/g, " ");
  const arts = articulos(plano);
  const inicios = []; // dónde empieza cada página
  { let p = 0; for (const t of paginas || []) { inicios.push(p); p += t.length + 3; } }
  const paginaEn = pos => { let k = 0; for (let i = 0; i < inicios.length; i++) if (inicios[i] <= pos) k = i; return k + 1; };

  const reglas = {};
  for (const [clave, def] of Object.entries(REGLAS)) {
    for (const p of def.pat) {
      p.re.lastIndex = 0;
      let m, hallado = null;
      while ((m = p.re.exec(plano))) {
        const v = p.valor(m);
        if (v != null && v >= def.rango[0] && v <= def.rango[1]) { hallado = { m, v }; break; }
      }
      if (hallado) {
        const ini = hallado.m.index, fin = ini + hallado.m[0].length;
        reglas[clave] = { valor: hallado.v, art: articuloEn(arts, ini), frase: frase(orig.replace(/[\n\f]/g, " "), ini, fin), pagina: paginaEn(ini) };
        break;
      }
    }
  }

  const meta = {};
  const cod = /codigo de convenio[^\d]{0,40}(\d{2}\s?\d{6}\s?\d{2}\s?\d{4}|\d{14})/.exec(plano);
  if (cod) meta.codigo = cod[1].replace(/\s/g, "");
  const vig = /vigencia[^.;]{0,120}?(20\d\d)[^.;]{0,60}?(20\d\d)/.exec(plano);
  if (vig && Number(vig[2]) >= Number(vig[1])) meta.vigencia = `${vig[1]}–${vig[2]}`;
  const nom = /convenio colectivo (?:de |del |para |estatal |provincial |autonomico )[^.(\n]{5,140}/.exec(plano);
  if (nom) {
    let t = orig.replace(/[\n\f]/g, " ").slice(nom.index, nom.index + nom[0].length).replace(/\s+/g, " ").trim();
    t = t.replace(/\s+c[oó]digo de convenio.*$/i, "").trim();
    meta.nombre = t.charAt(0).toUpperCase() + t.slice(1);
  }
  // Convenios estatales que no fijan cifras y las dejan a los de ámbito
  // inferior (provinciales) o al Estatuto: se avisa en vez de dar 0 sin más
  const remite = {
    inferior: /convenios? colectivos? (?:sectoriales|provinciales|subsectoriales)[^.;]{0,80}?(?:ambito inferior|provincial)|(?:establecida|fijada|que se establezca) [^.;]{0,60}?convenios? [^.;]{0,60}?ambito inferior/.test(plano),
    estatuto: /(?:establecid[oa]s?|previst[oa]s?|dispuesto) en el estatuto de los trabajadores/.test(plano),
  };
  return { reglas, meta, sinTexto, remite };
}
