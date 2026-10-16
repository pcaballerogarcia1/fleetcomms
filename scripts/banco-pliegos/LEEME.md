# Banco de pliegos

Mide el acierto del lector de pliegos (src/concursos/pliego.js) contra lo que cada
Ayuntamiento declaró en la Plataforma de Contratación (duración, presupuesto, valor
estimado, CPV y criterios de adjudicación).

En una carpeta de trabajo (fuera del repositorio, los pliegos no se suben):

    node scripts/banco-pliegos/recolectar.mjs <carpeta> 150 80   # licitaciones de residuos, limpieza y autobuses
    cd <carpeta> && node <repo>/scripts/banco-pliegos/bajar.mjs # baja PCAP, PPT y anexos (PDF, Word, OpenDocument, ZIP)
    node <repo>/scripts/banco-pliegos/evaluar.mjs                # tabla de aciertos y fallos.json con cada fallo

Variables: CPV (expresión de los CPV a buscar) y DESDE (página del canal por la que empezar).
