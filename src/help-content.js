// Ayuda de cada módulo (botón "Ayuda" de la cabecera): preguntas frecuentes
// con respuesta corta y pasos. Basado en el Manual de Usuario y en las
// funciones añadidas después. Al cambiar un botón o un texto visible de un
// módulo, revisa aquí que la ayuda siga diciendo lo mismo que la pantalla.
//
// { q: pregunta, a: respuesta, pasos?: [..], tags?: "palabras para el buscador" }

export const AYUDA = {
  planning: [
    {
      q: "¿Cómo importo mis puntos desde un Excel?",
      a: "En la pestaña Mapa, sección \"Cargar capa\" del panel izquierdo. Cada archivo crea una capa nueva con su propio color.",
      pasos: [
        "Pulsa \"Subir CSV / KML / Excel\" (puedes elegir varios archivos a la vez).",
        "El archivo necesita columnas de coordenadas: Latitud / Longitud en Excel, lat / lon en CSV, o una columna Coordenadas con el formato lat,lng.",
        "Los puntos aparecen en el mapa y la capa en la sección \"Capas\".",
      ],
      tags: "subir cargar archivo csv kml xlsx capa paradas contenedores",
    },
    {
      q: "¿Puedo importar un GTFS de autobuses aquí?",
      a: "No: las redes de autobuses (GTFS) van en un proyecto de \"Líneas regulares\", que tiene su propio Planning con ida y vuelta, tiempos de recorrido y tipos de vehículo por línea. Créalo desde Proyectos → \"+ Nuevo proyecto\" eligiendo \"Líneas regulares\". Las capas GTFS importadas antes en este Planning se siguen viendo.",
      tags: "gtfs autobús autobuses líneas red transporte zip operador",
    },
    {
      q: "Subí el archivo pero no aparece ningún punto",
      a: "Casi siempre es que la app no reconoce las columnas de coordenadas, o que las coordenadas están en otro sistema (UTM).",
      pasos: [
        "Revisa que las columnas se llamen Latitud / Longitud (Excel) o lat / lon (CSV).",
        "Si sale un aviso de coordenadas en UTM, convierte el archivo a grados decimales y vuelve a subirlo.",
        "Comprueba que el archivo tiene filas de datos, no solo la cabecera.",
      ],
      tags: "error no se ven puntos coordenadas utm columnas",
    },
    {
      q: "Los puntos salen en un sitio que no es",
      a: "Suele ser que latitud y longitud están intercambiadas, o que las coordenadas no están en grados. Las filas con coordenadas imposibles (vacías o 0,0) se descartan solas, y los puntos muy alejados del resto se marcan en la capa como \"muy lejos del resto\".",
      tags: "mapa lejos mal ubicados invertidas",
    },
    {
      q: "¿Cómo añado la cochera o depósito?",
      a: "En la sección \"Depots\" del panel izquierdo de la pestaña Mapa. El depósito es el punto de salida y vuelta de los vehículos.",
      pasos: [
        "Pulsa \"+\" en la cabecera de Depots y escribe latitud, longitud y nombre, o usa \"Importar CSV / KML / Excel\".",
        "Aparece en el mapa como una casa naranja.",
        "Después, en Scheduling → Vehículos, asígnalo a cada vehículo con \"Importar desde Planning\".",
      ],
      tags: "base nave planta cochera depot salida",
    },
    {
      q: "¿Cómo pongo franjas horarias a unas paradas?",
      a: "En la pestaña Timetable. Una franja es un rango en el que se puede hacer la parada; la hora de inicio es una hora exacta. Si hay las dos, manda la franja.",
      pasos: [
        "Ve a la pestaña Timetable (puedes filtrar por barrio en el panel izquierdo).",
        "En la fila de la parada, rellena \"Franja horaria\" (inicio y fin) o \"Hora inicio\", y la \"Duración\".",
        "Se guarda solo al salir del campo.",
      ],
      tags: "horario ventana hora inicio duración timetable colegio",
    },
    {
      q: "¿Cómo cambio la duración de todas las paradas a la vez?",
      a: "En Timetable, botón \"Duración\": pones los minutos y pulsas \"Aplicar a todos\".",
      tags: "minutos por parada tiempo servicio",
    },
    {
      q: "¿Cómo edito los horarios en Excel y los vuelvo a subir?",
      a: "Exporta el Timetable, edítalo fuera y vuelve a importarlo. La app reconoce cada parada por sus coordenadas.",
      pasos: [
        "En Timetable pulsa \"Excel\" para descargarlo.",
        "Cambia horas, franjas o duraciones sin tocar la columna Coordenadas.",
        "Pulsa \"Importar\" y elige el archivo; al terminar verás cuántas paradas se actualizaron.",
      ],
      tags: "exportar importar masivo excel timetable",
    },
    {
      q: "¿Cómo pongo precio a los puntos para la facturación?",
      a: "Solo administradores. En Timetable, con \"€ Precio\" puedes fijar un precio por defecto, aplicar un precio a todos los puntos de un barrio o poner precio a un punto concreto. Se usa en Analytics → Facturación.",
      tags: "precio euros facturación importe tarifa",
    },
    {
      q: "¿Cómo mido la distancia entre dos puntos?",
      a: "Botón \"Medir distancia\" arriba a la derecha del mapa: haz clic en los puntos en orden y verás los km por carretera y el tiempo estimado.",
      tags: "km distancia ruta tiempo medir",
    },
    {
      q: "¿Cómo coloreo o filtro por barrio o tipo?",
      a: "Si el archivo trae columnas de barrio, zona o sector, aparece la sección \"Barrios\" con un color por barrio (clic en el color para cambiarlo). Los filtros de tipo de fracción o contenedor sí ocultan los puntos que no coinciden.",
      tags: "barrio zona sector color filtro fracción",
    },
  ],

  scheduling: [
    {
      q: "¿Cómo genero un escenario?",
      a: "Necesitas paradas importadas y al menos un vehículo o trabajador dado de alta.",
      pasos: [
        "En VRP / Gantt pulsa \"Importar desde Planning\".",
        "Da de alta vehículos (con su depósito y turno) en la pestaña Vehículos y, si quieres, conductores en Trabajadores.",
        "Revisa las \"Restricciones\" (ventana horaria, duración máxima de turno, días máximos…).",
        "Pulsa \"Generar escenario\" y espera a que termine la barra de progreso sin recargar la página.",
      ],
      tags: "crear calcular rutas optimizar vrp generar",
    },
    {
      q: "El botón \"Generar escenario\" está desactivado",
      a: "Falta importar las paradas o no hay ningún vehículo ni trabajador dado de alta. Pulsa \"Importar desde Planning\" y añade al menos un recurso.",
      tags: "gris deshabilitado no puedo generar",
    },
    {
      q: "¿Por qué me quedan paradas sin asignar?",
      a: "Suele ser por franjas horarias muy estrechas que ninguna ruta puede cumplir, o por límites ajustados en Restricciones.",
      pasos: [
        "Mira las paradas del panel \"Sin asignar\" (abajo): si tienen franja horaria, amplíala en Planning → Timetable.",
        "Sube \"Días máximos de escenario\" o la \"Duración máxima de turno\" en Restricciones, o añade vehículos.",
        "También puedes arrastrar una parada sin asignar a la fila de un vehículo.",
      ],
      tags: "sin asignar faltan paradas no caben",
    },
    {
      q: "¿Qué significan los indicadores de arriba (PVR, eficiencia…)?",
      a: "Resumen del escenario, con ▲▼ en verde si mejora y en rojo si empeora respecto a la generación anterior. Pasa el ratón por cada uno para ver su explicación.",
      pasos: [
        "Vehículos: los usados. PVR: los que están en ruta a la vez en el momento punta.",
        "Turnos: conductor × día.",
        "Eficiencia vehículo: km en ruta / km totales (los km en vacío son la salida y vuelta a cochera).",
        "Eficiencia personal: tiempo productivo (conducción + paradas) / tiempo pagado.",
        "Coste estimado: horas pagadas × €/h + km × €/km, con las tarifas de Restricciones.",
        "Avisos: filas que incumplen alguna regla (ver la columna \"!\").",
      ],
      tags: "kpi indicadores pvr eficiencia km vacío coste turnos",
    },
    {
      q: "¿Cómo veo el coste estimado?",
      a: "Pon las tarifas en \"Restricciones\": \"Coste por hora de conductor\" y \"Coste por km\". Hasta entonces el indicador muestra el botón \"Configurar €/h y €/km\".",
      tags: "euros coste precio hora km",
    },
    {
      q: "¿Qué son los avisos \"!\" de la tabla?",
      a: "Marcan las filas que incumplen alguna regla. Pasa el ratón por el \"!\" para ver el detalle.",
      pasos: [
        "Conducción UE 561/2006: más de 4h30 conduciendo sin una pausa de 45 min (o 15 + 30), o más de 9 h de conducción al día.",
        "Estatuto de los Trabajadores (art. 34.4): jornada de más de 6 h sin 15 min de descanso.",
        "Jornada por encima de la duración máxima de turno, o paradas fuera de su franja horaria.",
        "Si tu actividad está exenta del 561 (p. ej. recogida de residuos), actívalo en Restricciones: \"No aplicar tiempos de conducción UE 561/2006\".",
      ],
      tags: "aviso regla 561 tacógrafo conducción descanso pausa estatuto",
    },
    {
      q: "¿Cómo muevo una parada a otro vehículo?",
      a: "Arrastra el bloque de la parada a la fila del otro vehículo (se resalta en azul) o haz clic en la parada y usa \"Mover a\" en su ficha.",
      tags: "mover arrastrar reasignar cambiar vehículo",
    },
    {
      q: "¿Cómo vuelvo a una versión anterior del escenario?",
      a: "Botón \"Historial\" de la barra de Scheduling → \"Puntos de restauración\" → \"Restaurar\" en la versión que quieras.",
      pasos: [
        "Se guarda una versión antes de volver a generar, antes de restaurar, antes de guardar encima de otra persona y cada 30 min de edición (máximo 15).",
        "En \"Resumen de cada generación\" puedes comparar los indicadores de cada generación.",
      ],
      tags: "deshacer restaurar versión historial anterior recuperar",
    },
    {
      q: "Sale un aviso de que otra persona ha guardado otra versión",
      a: "Alguien ha guardado el mismo escenario mientras lo editabas. Tus cambios están a salvo en tu navegador: elige \"Guardar la mía encima\" o \"Ver su versión\". Antes de guardar encima se crea un punto de restauración con la otra versión.",
      tags: "conflicto otro usuario versión nube guardar",
    },
    {
      q: "¿El escenario se ve en otro ordenador?",
      a: "Sí. Se guarda en la nube: al abrir el proyecto en otro PC aparece el mismo escenario. Mientras se sube verás \"Guardando el escenario en la nube…\".",
      tags: "otro pc guardar nube sincronizar",
    },
    {
      q: "¿Cómo envío las rutas a los conductores?",
      a: "Con \"Publicar en Rutas\": se crea un plan por vehículo y día que el conductor ve en su móvil.",
      pasos: [
        "Pulsa \"Publicar en Rutas\".",
        "Elige el tipo de plan y el mes.",
        "Pulsa \"Publicar planes\". Los días en que el conductor no está disponible según Rostering se omiten.",
      ],
      tags: "publicar planes app conductor móvil rutas",
    },
    {
      q: "Aparece un aviso de \"Conflictos\"",
      a: "Un conductor tiene ruta un día en que Rostering lo marca como Libre o Baja. Corrige su celda en Rostering si sí trabaja, o reasigna esa ruta a otro conductor o regenera el escenario.",
      tags: "conflicto baja libre rostering conductor",
    },
    {
      q: "Un vehículo acaba muy pronto y otros muy tarde",
      a: "En Restricciones, mueve \"Priorizar optimización\" hacia Turnos y regenera: reparte el trabajo de forma más equilibrada. Hacia Kilómetros hace rutas más compactas.",
      tags: "desequilibrio reparto jornada kilómetros turnos deslizador",
    },
    {
      q: "Los vehículos no vuelven a la cochera",
      a: "Activa \"Circularidad (vuelve donde empieza)\" en Restricciones y vuelve a generar.",
      tags: "volver depósito cochera circular",
    },
  ],

  rostering: [
    {
      q: "¿Cómo relleno el cuadrante del mes?",
      a: "Selecciona celdas y escribe el código del turno. Todo se guarda solo.",
      pasos: [
        "Clic en una celda; arrastra o usa Mayús+clic para seleccionar varias.",
        "Escribe M (Mañana), T (Tarde), N (Noche), L (Libre), G (Guardia), B (Baja) o D (Disponible).",
        "Supr borra, las flechas mueven la selección y Esc la quita.",
        "Los botones pequeños M T N junto al nombre rellenan todo el mes de ese trabajador.",
      ],
      tags: "turnos rellenar escribir códigos teclado mes",
    },
    {
      q: "¿Cómo marco una baja o vacaciones?",
      a: "Selecciona los días del trabajador y escribe B (Baja) o L (Libre). Esos días no se le asignan rutas.",
      tags: "baja vacaciones libre ausencia",
    },
    {
      q: "¿Qué hace el botón \"Optimizar\"?",
      a: "Rellena el cuadrante con los turnos del escenario de Scheduling. No toca lo que has escrito a mano.",
      pasos: [
        "Necesitas un escenario generado en Scheduling para ese proyecto y mes.",
        "En modo libre asigna trabajador y vehículo a cada turno respetando las \"Reglas\"; esas celdas se marcan como \"Asignado por Optimizar\".",
        "Si editas una de esas celdas a mano, deja de ser de Optimizar. Al volver a optimizar solo se recalcula lo que puso la optimización anterior.",
      ],
      tags: "optimizar automático asignar turnos escenario",
    },
    {
      q: "¿Qué son las \"Reglas\" del cuadrante?",
      a: "Los límites que respeta Optimizar: máximo de horas al mes, jornada máxima diaria, descanso entre jornadas, descanso semanal seguido, máximo de días seguidos, de noches seguidas y al mes, de domingos/festivos al mes y reparto.",
      tags: "reglas convenio horas descanso noches domingos",
    },
    {
      q: "\"Optimizar\" dice que no hay escenario o no hay turnos",
      a: "Genera antes el escenario en Scheduling para ese proyecto y mes. Si el escenario es de otro mes, cambia el mes del cuadrante con ‹ ›.",
      tags: "error optimizar sin escenario",
    },
    {
      q: "¿Cómo registro que un vehículo está en el taller?",
      a: "Cambia a la vista \"Vehículos\" (arriba a la izquierda) y marca los días como Taller, Avería o ITV. Un vehículo no disponible no se asigna.",
      tags: "vehículo taller avería itv disponibilidad flota",
    },
    {
      q: "¿Cómo veo el detalle de un turno?",
      a: "Clic derecho en la celda: verás el turno y, si hay escenario, el horario, las paradas, los km y el vehículo de ese día.",
      tags: "detalle resumen clic derecho",
    },
    {
      q: "¿Pueden editar el cuadrante varias personas a la vez?",
      a: "Sí. Cada celda se guarda por separado y los cambios de los demás aparecen al momento sin pisar los tuyos.",
      tags: "varios usuarios a la vez simultáneo",
    },
    {
      q: "Escribo una letra y no pasa nada",
      a: "Haz clic antes en una celda para que el cuadrante tenga el foco, y usa una de las letras válidas: M, T, N, L, G, B o D.",
      tags: "no escribe teclado letra",
    },
  ],

  control: [
    {
      q: "¿Cómo veo el avance de las rutas de hoy?",
      a: "En la vista \"Planes\": una tarjeta por plan con su % de progreso. Haz clic en una para ver su mapa y la actividad parada a parada.",
      tags: "progreso avance planes hechas pendientes",
    },
    {
      q: "¿Cómo veo dónde está cada vehículo?",
      a: "En \"Mapa de flota\". Solo salen los conductores con la app abierta y el permiso de ubicación aceptado. Verde: posición reciente; naranja: 90 s a 3 min sin actualizar; gris: desconectado.",
      tags: "ubicación gps mapa flota posición en vivo",
    },
    {
      q: "No veo a ningún conductor en el mapa",
      a: "El conductor tiene que tener abierta la app de campo en Rutas y haber aceptado el permiso de ubicación del móvil. Aunque salga desconectado puede seguir marcando paradas y fichando.",
      tags: "no aparece conductor desconectado ubicación",
    },
    {
      q: "¿Qué significan las alertas de parada no programada o fuera de zona?",
      a: "Se calculan con la ubicación del móvil, sin instalar nada en el vehículo. Parada no programada: lleva un rato parado lejos de cualquier parada pendiente de su plan. Fuera de zona: está fuera del área que cubren las paradas de su plan de hoy.",
      tags: "alerta parado fuera de zona geocerca",
    },
    {
      q: "¿Cómo exporto los fichajes para la nómina?",
      a: "En \"Fichajes\", elige el mes y pulsa \"Excel\": descarga los fichajes de todo el mes, con horas y km por trabajador.",
      tags: "fichajes exportar excel nómina horas registro jornada",
    },
    {
      q: "Un conductor olvidó fichar la salida",
      a: "La jornada queda \"en curso\" hasta que se cierre. Pide al conductor que fiche la salida desde la app.",
      tags: "fichaje abierto en curso olvidó",
    },
    {
      q: "¿Puedo cambiar un plan desde Control?",
      a: "No. Control solo muestra lo que pasa en campo. Los planes se crean desde Scheduling con \"Publicar en Rutas\".",
      tags: "editar plan cambiar",
    },
    {
      q: "Un conductor no ve ningún plan en su móvil",
      a: "Comprueba por este orden: que se publicó con \"Publicar en Rutas\"; que el mes publicado es el actual; que el conductor tiene vinculado en Trabajadores el mismo vehículo; y que su cuenta está activa.",
      tags: "conductor no ve plan app vacía",
    },
  ],

  // Proyectos de "Líneas regulares" (autobuses)
  planning_lineas: [
    {
      q: "¿Cómo pongo las cocheras?",
      a: "En el panel izquierdo, \"Cocheras\" → \"+ Añadir\" y pincha en el mapa donde está. Ponle nombre en la lista y arrástrala en el mapa para moverla. En la ficha de cada línea (pestaña Vehículos) puedes fijar su cochera; si no, el Scheduling usa la más cercana. Sin cocheras no se calculan las salidas y vueltas a cochera ni sus km en vacío.",
      tags: "cochera cocheras depósito garaje añadir mover vacío",
    },
    {
      q: "¿Cómo cargo la red de líneas?",
      a: "Con \"Importar red (GTFS .zip)\" en el panel izquierdo. Sirve el GTFS que publica el operador o el consorcio de transportes; una red grande tarda menos de un minuto.",
      pasos: [
        "Pulsa \"Importar red (GTFS .zip)\" y elige el archivo.",
        "Al terminar verás todas las líneas en la lista y en el mapa.",
        "Para actualizarla, \"Sustituir red\": la configuración de las líneas que se llamen igual se conserva.",
      ],
      tags: "gtfs importar red líneas autobús consorcio operador zip",
    },
    {
      q: "¿Qué es la ida (outbound) y la vuelta (inbound)?",
      a: "Los dos sentidos de cada línea, según el GTFS. En el mapa la ida va en línea continua y la vuelta en discontinua. En la ficha de la línea, \"Ida y vuelta\" muestra la cabecera de destino, el número de paradas, la longitud, el horario y los viajes de cada sentido; \"Ver las paradas en orden\" despliega la secuencia.",
      tags: "ida vuelta sentido outbound inbound cabecera secuencia paradas",
    },
    {
      q: "¿De dónde salen los viajes por tipo de día?",
      a: "Del calendario del GTFS. Para cada tipo (laborable, sábado, domingo/festivo) se toma como referencia el día de ese tipo con más servicio, y se cuentan los viajes de ese día. Las fechas de referencia aparecen arriba en el panel.",
      tags: "laborable sábado festivo domingo calendario viajes día referencia",
    },
    {
      q: "¿Cómo se calculan los tiempos de recorrido?",
      a: "Pestaña \"Tiempos\" de la línea: minutos de cabecera a cabecera en cada franja horaria, con la mediana de los viajes de un laborable. Si un valor no te cuadra, escríbelo encima y queda como corregido (en ámbar); vacíalo para volver al calculado.",
      pasos: [
        "La regulación en cabecera es el margen mínimo entre la llegada de un viaje y la salida del siguiente.",
        "Estos tiempos y la regulación son los que usará el Scheduling de líneas.",
      ],
      tags: "tiempo recorrido franja hora punta valle regulación cabecera minutos corregir",
    },
    {
      q: "¿Cómo indico qué autobuses pueden hacer una línea?",
      a: "Pestaña \"Vehículos\" de la línea: marca los tipos que admite (microbús, midibús, estándar 12 m, articulado 18 m, eléctrico, interurbano) y, si quieres, uno como preferente. Sin marcar ninguno, vale cualquiera.",
      tags: "tipología vehículo tipo autobús articulado midibús eléctrico preferente",
    },
    {
      q: "¿Por qué no veo Timetable ni los puntos del Planning normal?",
      a: "Porque este proyecto es de \"Líneas regulares\": el Planning de puntos (residuos, reparto…) es para otro tipo de proyecto. El tipo se elige al crear el proyecto.",
      tags: "timetable puntos residuos tipo proyecto",
    },
  ],
  scheduling_lineas: [
    {
      q: "¿Cómo genero el servicio?",
      a: "Elige el tipo de día (laborable, sábado o domingo/festivo) y, si quieres, solo algunas líneas, y pulsa \"Generar servicio\". Con la red de Planning se encadenan los viajes en autobuses y se reparten en turnos de conductor. Si cambias algo, el botón pasa a \"Generar con los cambios\".",
      tags: "generar servicio día laborable sábado festivo líneas",
    },
    {
      q: "¿Qué diferencia hay entre autobuses, bloques y pico?",
      a: "Un bloque es lo que un autobús hace seguido, sin pasar por cochera. Un mismo autobús puede hacer un bloque de mañana y otro de tarde si entre medias hay margen para ir y volver de cochera (\"Ajustes\" → margen para un vacío). \"Autobuses\" es la flota necesaria; el pico, los que están en servicio a la vez en el peor momento (la curva de debajo).",
      tags: "autobuses bloques pico flota necesaria vacío cochera",
    },
    {
      q: "¿Cómo se encadenan los viajes?",
      a: "Por hora de salida: cada viaje va a un autobús que esté libre en esa cabecera con la regulación cumplida (la de la línea o la de Restricciones) y de un tipo que admita la línea. Si no hay ninguno, puede venir en vacío uno de otra cabecera cercana (hasta los km de Restricciones) que llegue a tiempo; si tampoco, se añade otro autobús. Las dos cabeceras de una línea cuentan como el mismo sitio. En Restricciones puedes impedir que un autobús cambie de línea o que haga vacíos entre cabeceras.",
      tags: "encadenar viajes regulación cabecera tipo vehículo cambiar línea",
    },
    {
      q: "¿Cómo se hacen los turnos de conductor?",
      a: "Cada bloque se corta en piezas con relevo en cabecera y cada conductor va encadenando piezas de cualquier autobús (con el tiempo de relevo, o de desplazamiento si cambia de cabecera) hasta llenar su jornada: tantas piezas como quepan. Se cumplen la amplitud y la jornada máximas, la conducción continua y diaria (UE 561/2006), el descanso de 15 min del Estatuto y las piezas y jornadas partidas máximas (todo en Restricciones). Los huecos cortos entre piezas se pagan; los largos son jornada partida. Optimizar prueba distintos largos de pieza y formas de repartirlas. En el Gantt, las marcas blancas \"T12\" son los relevos; la vista Trabajadores enseña cada turno con sus piezas.",
      tags: "turnos conductor piezas relevo pausa jornada amplitud 561 estatuto",
    },
    {
      q: "¿Cómo se calculan los km en vacío?",
      a: "Con las cocheras del Planning: cada bloque sale de la cochera de su línea (la fijada en su ficha o la más cercana) hasta la primera cabecera y vuelve a ella al acabar. A eso se suman los vacíos entre cabeceras. Los vacíos los conduce el conductor y cuentan como trabajo; salen en el Gantt en gris rayado. La distancia es la línea recta por el factor de rodeo, a la velocidad en vacío (los dos en Restricciones). La eficiencia de vehículo es km con viajeros / km totales, y el coste usa los km totales.",
      tags: "vacío vacíos cochera depósito km kilómetros salida vuelta eficiencia",
    },
    {
      q: "¿Qué significan las eficiencias?",
      a: "Eficiencia vehículo: km con viajeros / km totales (lo demás son vacíos de cochera y entre cabeceras). Eficiencia personal: conducción / tiempo de trabajo de los turnos.",
      tags: "eficiencia vehículo personal indicadores",
    },
    {
      q: "Sale un aviso de horarios aproximados",
      a: "La red se importó antes de que se guardaran las horas de salida de cada viaje, así que se reparten entre la primera y la última. Vuelve a importar el GTFS en Planning (\"Sustituir red\") para usar los horarios exactos; la configuración de las líneas se conserva.",
      tags: "aproximado horarios salidas reimportar",
    },
  ],

  analytics: [
    {
      q: "¿De dónde salen los datos?",
      a: "De lo que los conductores registran en la app de campo (paradas hechas, fichajes, incidencias) en los planes publicados. Elige la vista y el mes arriba a la derecha.",
      tags: "datos origen fuente mes",
    },
    {
      q: "¿Qué es el % de cumplimiento?",
      a: "En \"Producción\": paradas completadas / paradas totales de los planes del mes.",
      tags: "cumplimiento porcentaje producción completadas",
    },
    {
      q: "¿Cómo funciona la Facturación?",
      a: "Solo la ven los administradores. Cada parada tiene un precio (el suyo o el de por defecto). Cuando el conductor la marca como hecha, su importe pasa de Pendiente a Facturado.",
      pasos: [
        "Pon los precios en Planning → Timetable → \"€ Precio\".",
        "\"Previsto del mes\" es el importe de todas las paradas de los planes del mes.",
        "Las paradas sin precio no cuentan; la pantalla dice cuántas son.",
      ],
      tags: "facturación euros facturado pendiente previsto precio",
    },
    {
      q: "Pone \"Sin datos suficientes todavía\"",
      a: "En ese mes aún no hay actividad registrada desde la app de campo. Comprueba el mes elegido y que haya planes publicados.",
      tags: "sin datos vacío gráficos",
    },
    {
      q: "¿Qué muestra la vista \"Personal\"?",
      a: "Fichados ahora, horas del mes, km del mes, media de horas por conductor, la evolución de horas por semana y las horas por conductor (top 10). Sale de los fichajes.",
      tags: "personal horas conductores fichajes km",
    },
    {
      q: "¿Qué muestra la vista \"Varios\"?",
      a: "Las incidencias: abiertas, en revisión y cerradas, por prioridad, por categoría (avería mecánica, accidente, neumáticos, mantenimiento, comunicado general) y abiertas por semana.",
      tags: "incidencias averías varios categorías",
    },
  ],
};

export const TITULO = { planning: "Planning", scheduling: "Scheduling", planning_lineas: "Planning de líneas", scheduling_lineas: "Scheduling de líneas", rostering: "Rostering", control: "Control", analytics: "Analytics" };

const norm = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Busca en la ayuda: primero en el módulo actual; si no hay nada, en los
 * demás (con el módulo indicado). Todas las palabras deben aparecer.
 * → [{ modulo, item }]
 */
export function buscarAyuda(modulo, texto, ayuda = AYUDA) {
  const palabras = norm(texto).split(/\s+/).filter(w => w.length > 1 && !VACIAS.has(w));
  const encaja = it => {
    const h = norm([it.q, it.a, ...(it.pasos || []), it.tags || ""].join(" "));
    return palabras.every(w => h.includes(w));
  };
  const propios = (ayuda[modulo] || []).map(item => ({ modulo, item }));
  if (!palabras.length) return propios;
  const aqui = propios.filter(r => encaja(r.item));
  if (aqui.length) return aqui;
  return Object.entries(ayuda).filter(([m]) => m !== modulo)
    .flatMap(([m, items]) => items.filter(encaja).map(item => ({ modulo: m, item })));
}
const VACIAS = new Set(["de", "la", "el", "en", "un", "una", "los", "las", "que", "como", "por", "para", "con", "del", "al", "se", "me", "mi", "lo", "es", "y", "o", "a"]);
