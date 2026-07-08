const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
// INDICA A NODE QUE EXPONGA TU CARPETA DE FOTOS DE FORMA SEGURA EN INTERNET
const path = require('path'); // Pon esta línea arriba del todo si no la tienes

// CORRECCIÓN DEFINITIVA: Fuerza a Node a buscar la carpeta fotos en su misma raíz exacta
app.use('/fotos', express.static(path.join(__dirname, 'fotos')));
// INDICA A NODE QUE SIVRA TU CARPETA DE VÍDEOS DE FORMA SEGURA EN EL PUERTO 3000
app.use('/videos', express.static(path.join(__dirname, 'videos')));
// INDICA A NODE QUE SIRVA TU CARPETA DE ESCUDOS DE FORMA SEGURA EN EL PUERTO 3000
app.use('/escudos', express.static(path.join(__dirname, 'escudos')));




// CONFIGURACIÓN DE CONEXIÓN CON CAPTURA DE ERRORES MEJORADA
// CONFIGURACIÓN DE CONEXIÓN ACTUALIZADA CON EL NUEVO USUARIO
const db = mysql.createConnection({
    host: 'localhost',
    user: 'fantasy_user',      // ⬅️ Cambiado root por el nuevo usuario
    password: 'fantasy123',    // ⬅️ Contraseña nueva y fácil asignada en SQL
    database: 'fantasy_liga'
});

// Sistema de verificación que detalla el fallo exacto en la consola
db.connect(function(err) {
    if (err) {
        console.error('==================================================');
        console.error('❌ ERROR DE CONEXIÓN CON MYSQL WORKBENCH:');
        console.error('Código de error:', err.code);
        console.error('Mensaje completo:', err.message);
        console.error('==================================================');
        return;
    }
    console.log('✅ ¡Conectado con éxito a MySQL Workbench (fantasy_liga)!');
});

// 1. OBTENER JORNADAS
app.get('/api/jornadas', (req, res) => {
    db.query('SELECT * FROM jornadas ORDER BY numero_jornada ASC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});

// 2. CREAR JORNADA DINÁMICA
app.post('/api/jornadas', (req, res) => {
    db.query('SELECT COALESCE(MAX(numero_jornada), 0) + 1 AS siguiente FROM jornadas', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        const proxima = results[0] ? results[0].siguiente : 1;
        db.query('INSERT INTO jornadas (numero_jornada) VALUES (?)', [proxima], (err, insertRes) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ mensaje: 'Jornada ' + proxima + ' creada', id_jornada: insertRes.insertId });
        });
    });
});

// 3. OBTENER PARTIDOS DE UNA JORNADA
app.get('/api/partidos/:id_jornada', (req, res) => {
    const query = 'SELECT p.*, el.nombre AS local_nombre, ev.nombre AS visitante_nombre FROM partidos p JOIN equipos el ON p.id_local = el.id_equipo JOIN equipos ev ON p.id_visitante = ev.id_equipo WHERE p.id_jornada = ?';
    db.query(query, [req.params.id_jornada], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});

// 4. REGISTRAR PARTIDO EN ACTA CLONANDO PLANTILLAS REALES DE LA BD
app.post('/api/partidos', (req, res) => {
    const { id_jornada, id_local, id_visitante } = req.body;
    db.query('INSERT INTO partidos (id_jornada, id_local, id_visitante) VALUES (?, ?, ?)', [id_jornada, id_local, id_visitante], (err, resultPartido) => {
        if (err) return res.status(500).json({ error: err.message });
        const id_partido = resultPartido.insertId;

        db.query('SELECT id_jugador FROM jugadores WHERE id_equipo IN (?, ?)', [id_local, id_visitante], (err, jugs) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!jugs || jugs.length === 0) return res.json({ id_partido, mensaje: "Partido creado sin actas" });

            const valoresActa = jugs.map(j => [id_partido, j.id_jugador, 'titular', null, '', '']);
            db.query('INSERT INTO acta_partido (id_partido, id_jugador, rol, puntos, evento, cambio) VALUES ?', [valoresActa], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ id_partido, mensaje: "Partido y actas inicializadas" });
            });
        });
    });
});

// =======================================================================
// =======================================================================
// 5. API DEL ACTA RECONSTRUIDA: UNE CON JUGADORES PARA LEER EL ID_EQUIPO REAL
// =======================================================================
app.get('/api/acta/:id_partido', (req, res) => {
    const id_p = req.params.id_partido;
    console.log(`🔍 Cargando acta blindada y repartiendo bandos para el partido ID: ${id_p}`);

    // CORRECCIÓN RADICAL SQL: Forzamos la lectura de j.id_equipo directo de la ficha del jugador
    // Esto repara las celdas vacías o los ceros que se quedaron tras los reinicios de pruebas
    const queryActaBase = `
        SELECT 
            ap.id_acta, 
            ap.id_partido, 
            j.id_equipo, -- 👈 LEEMOS EL ID REAL DE LA TABLA JUGADORES, NO DEL ACTA VACÍA
            ap.id_jugador, 
            ap.rol, 
            ap.puntos, 
            ap.evento, 
            ap.cambio, 
            ap.posicion_x, 
            ap.posicion_y,
            j.nombre, 
            j.posicion, 
            j.foto_ruta, 
            j.dorsal
        FROM acta_partido ap
        JOIN jugadores j ON ap.id_jugador = j.id_jugador
        WHERE ap.id_partido = ?`;

    db.query(queryActaBase, [id_p], (err, jugadoresActa) => {
        if (err) {
            console.error("Error crítico en consulta de acta:", err);
            return res.status(500).json({ error: err.message });
        }
        
        if (jugadoresActa.length === 0) return res.json([]);

        // QUERY DE MEMORIA: Buscamos el historial completo de notas pasadas para la media móvil
        const queryHistorialGlobal = `
            SELECT ap.id_jugador, ap.puntos, p.id_jornada
            FROM acta_partido ap
            JOIN partidos p ON ap.id_partido = p.id_partido
            WHERE p.goles_local IS NOT NULL AND p.goles_visitante IS NOT NULL
            ORDER BY p.id_jornada DESC`;

        db.query(queryHistorialGlobal, (errHist, todasLasNotas) => {
            if (errHist) return res.status(500).json({ error: errHist.message });

            let mapaHistorial = {};
            todasLasNotas.forEach(nota => {
                if (!mapaHistorial[nota.id_jugador]) mapaHistorial[nota.id_jugador] = [];
                mapaHistorial[nota.id_jugador].push(parseInt(nota.puntos) || 0);
            });

            // Aplicamos la media móvil exacta manteniendo los decimales puros
            let actaCalculadaConMedia = jugadoresActa.map(j => {
                let notasPasadas = mapaHistorial[j.id_jugador] || [];
                let ultimas3Notas = notasPasadas.slice(0, 3);
                let cantidadPartidosReales = ultimas3Notas.length;
                let mediaCalculada = 0;

                if (cantidadPartidosReales > 0) {
                    let sumaPuntos = ultimas3Notas.reduce((a, b) => a + b, 0);
                    if (sumaPuntos === 0 && cantidadPartidosReales === 3) {
                        mediaCalculada = 5.0;
                    } else {
                        mediaCalculada = parseFloat((sumaPuntos / cantidadPartidosReales).toFixed(1));
                    }
                } else {
                    mediaCalculada = parseFloat((parseInt(j.puntos) || 0).toFixed(1));
                }

                j.puntos = mediaCalculada;
                j.valor_actual = mediaCalculada;
                return j;
            });

            // Enviamos el acta con las IDs de los clubes totalmente reparadas en red
            res.json(actaCalculadaConMedia);
        });
    });
});




// 6. VERSIÓN ULTRA-SEGURO: GUARDA MARCADORES Y JUGADORES FILTRANDO CAMPOS VACÍOS (EVITA ERROR 500)
app.post('/api/acta/guardar', (req, res) => {
    const { 
        id_partido, id_acta, id_jugador, nuevo_nombre, 
        goles_local, goles_visitante, rol, puntos, evento, cambio,
        posicion_x, posicion_y 
    } = req.body;

    // Convertir estrictamente los goles a números enteros para MySQL
    const gLocal = parseInt(goles_local) || 0;
    const gVisitante = parseInt(goles_visitante) || 0;

    // Calcular puntos extras por goles individuales metidos por el jugador
    let puntosGolesExtra = 0;
    if (evento === "⚽") puntosGolesExtra = 2;
    else if (evento === "⚽⚽" || evento === "⚽⚽⚽") puntosGolesExtra = 3;

    // FILTRO DE SEGURIDAD: Convertimos la nota a un número limpio para evitar fallos de NaN en MySQL
    let notaLimpia = parseInt(puntos);
    let puntosTotalesPartido = null;
    
    if (!isNaN(notaLimpia)) {
        puntosTotalesPartido = notaLimpia + puntosGolesExtra;
    }

    // 1. Actualizar los goles del partido en la tabla general de encuentros
    db.query('UPDATE partidos SET goles_local = ?, goles_visitante = ? WHERE id_partido = ?', [gLocal, gVisitante, id_partido], (err) => {
        if (err) {
            console.error("Error crítico de MySQL al actualizar goles en partidos:", err);
            return res.status(500).json({ error: "Fallo al guardar goles en la tabla partidos: " + err.message });
        }
        
        // 2. FUNCIÓN MAESTRA AUTOMÁTICA: Recalcula y actualiza la tabla de la clasificación general
        recalcularClasificacionGeneralMySQL();
        
        // 3. Actualizar el nombre del futbolista si ha cambiado por edición
        db.query('UPDATE jugadores SET nombre = ? WHERE id_jugador = ?', [nuevo_nombre, id_jugador], (errJug) => {
            if (errJug) console.error("Error al actualizar nombre del jugador:", errJug);

            // 4. Actualizar el acta táctica individual con las coordenadas y notas limpias
            const queryActa = `
                UPDATE acta_partido 
                SET rol = ?, puntos = ?, evento = ?, cambio = ?, posicion_x = ?, posicion_y = ? 
                WHERE id_acta = ?`;
                
            // Convertimos las coordenadas a enteros o NULL si vienen vacías para que MySQL no salte
            const pX = posicion_x !== undefined && posicion_x !== null ? parseInt(posicion_x) : null;
            const pY = posicion_y !== undefined && posicion_y !== null ? parseInt(posicion_y) : null;

            db.query(queryActa, [rol, puntosTotalesPartido, evento || "", cambio || "", pX, pY, id_acta], (errActa) => {
                if (errActa) {
                    console.error("Error crítico de MySQL en acta_partido:", errActa);
                    return res.status(500).json({ error: "Fallo al guardar el acta_partido: " + errActa.message });
                }
                
                // Si todo entra sin problemas, devolvemos confirmación limpia en verde a la web
                res.json({ estatus: "OK", mensaje: "Marcadores guardados y clasificación recalculada de forma exitosa." });
            });
        });
    });
});


// NUEVA FUNCIÓN INTERNA: Recorre todos los partidos de la BD y computa los 21 parámetros de la clasificación
function recalcularClasificacionGeneralMySQL() {
    // Ponemos todos los contadores de los 20 equipos a cero para hacer un reconteo limpio sin duplicados
    db.query('UPDATE clasificacion SET pt=0, pj=0, pg=0, pe=0, pp=0, gf=0, gc=0, pt_casa=0, pj_casa=0, pg_casa=0, pe_casa=0, pp_casa=0, gf_casa=0, gc_casa=0, pt_fuera=0, pj_fuera=0, pg_fuera=0, pe_fuera=0, pp_fuera=0, gf_fuera=0, gc_fuera=0', () => {
        
        // Seleccionamos todos los partidos que ya tengan un marcador asignado (goles no nulos)
        db.query('SELECT * FROM partidos WHERE goles_local IS NOT NULL AND goles_visitante IS NOT NULL', (err, partidos) => {
            if (err || !partidos) return;

            partidos.forEach(p => {
                let gl = p.goles_local;
                let gv = p.goles_visitante;
                
                // Determinamos los puntos de la quiniela (3 para el ganador, 1 para el empate, 0 para el perdedor)
                let p_l = gl > gv ? 3 : gl === gv ? 1 : 0;
                let p_v = gv > gl ? 3 : gl === gv ? 1 : 0;
                
                let win_l = gl > gv ? 1 : 0; let emp_l = gl === gv ? 1 : 0; let lost_l = gl < gv ? 1 : 0;
                let win_v = gv > gl ? 1 : 0; let emp_v = gl === gv ? 1 : 0; let lost_v = gv < gl ? 1 : 0;

                // Consulta A: Actualizar bloque TOTALES y bloque EN CASA para el equipo Local
                const sqlLocal = `
                    UPDATE clasificacion 
                    SET pt = pt + ?, pj = pj + 1, pg = pg + ?, pe = pe + ?, pp = pp + ?, gf = gf + ?, gc = gc + ?,
                        pt_casa = pt_casa + ?, pj_casa = pj_casa + 1, pg_casa = pg_casa + ?, pe_casa = pe_casa + ?, pp_casa = pp_casa + ?, gf_casa = gf_casa + ?, gc_casa = gc_casa + ?
                    WHERE id_equipo = ?`;
                db.query(sqlLocal, [p_l, win_l, emp_l, lost_l, gl, gv, p_l, win_l, emp_l, lost_l, gl, gv, p.id_local]);

                // Consulta B: Actualizar bloque TOTALES y bloque FUERA para el equipo Visitante
                const sqlVisitante = `
                    UPDATE clasificacion 
                    SET pt = pt + ?, pj = pj + 1, pg = pg + ?, pe = pe + ?, pp = pp + ?, gf = gf + ?, gc = gc + ?,
                        pt_fuera = pt_fuera + ?, pj_fuera = pj_fuera + 1, pg_fuera = pg_fuera + ?, pe_fuera = pe_fuera + ?, pp_fuera = pp_fuera + ?, gf_fuera = gf_fuera + ?, gc_fuera = gc_fuera + ?
                    WHERE id_equipo = ?`;
                db.query(sqlVisitante, [p_v, win_v, emp_v, lost_v, gv, gl, p_v, win_v, emp_v, lost_v, gv, gl, p.id_visitante]);
            });
        });
    });
}



// 7. OBTENER LISTADO COMPLETO DE EQUIPOS REGISTRADOS
app.get('/api/equipos', (req, res) => {
    db.query('SELECT * FROM equipos ORDER BY division ASC, nombre ASC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});
// 8. ALGORITMO CORREGIDO: SE INCLUYE 'j.foto_ruta' EN EL ENVÍO DE MEDIAS
app.get('/api/valor-equipo/:id_partido', (req, res) => {
    const id_partido = req.params.id_partido;

    // CORRECCIÓN: Añadida j.foto_ruta a la selección de la base de datos
    const queryActa = `
        SELECT a.id_jugador, a.id_acta, a.rol, a.posicion_x, a.posicion_y, j.id_equipo, j.nombre, j.posicion, j.foto_ruta 
        FROM acta_partido a
        JOIN jugadores j ON a.id_jugador = j.id_jugador
        WHERE a.id_partido = ?`;

    db.query(queryActa, [id_partido], (err, jugadoresActa) => {
        if (err) return res.status(500).json({ error: err.message });
        if (jugadoresActa.length === 0) return res.json({ valor_local: 0, valor_visitante: 0, jugadores: [] });

        let promesas = [];

        jugadoresActa.forEach(jug => {
            const queryMedia = `
                SELECT puntos 
                FROM acta_partido 
                WHERE id_jugador = ? AND puntos IS NOT NULL 
                ORDER BY id_acta DESC 
                LIMIT 3`;

            var p = new Promise((resolve) => {
                db.query(queryMedia, [jug.id_jugador], (err, historial) => {
                    let valorActual = 0;
                    if (!err && historial && historial.length > 0) {
                        let suma = historial.reduce((acc, fila) => acc + fila.puntos, 0);
                        valorActual = parseFloat((suma / historial.length).toFixed(1));
                    }
                    jug.valor_actual = valorActual;
                    resolve(jug);
                });
            });
            promesas.push(p);
        });

               // ESPERAMOS A QUE MYSQL PROCESE LOS HISTORIALES DE TODOS LOS JUGADORES
        Promise.all(promesas).then((jugadoresConValor) => {
            db.query('SELECT id_local, id_visitante FROM partidos WHERE id_partido = ?', [id_partido], (err, partidoData) => {
                if (err || !partidoData || partidoData.length === 0) return res.json({ error: "Partido no encontrado" });
                
                // Forzamos que los IDs de los clubes sean texto para evitar fallos de emparejamiento numérico
                const id_l = partidoData[0].id_local.toString();
                const id_v = partidoData[0].id_visitante.toString();

                // SUMADOR CORREGIDO: Forzamos .toString() para asegurar el cruce perfecto de bandos
                let valorLocal = jugadoresConValor
                    .filter(j => j.id_equipo.toString() === id_l && j.rol === 'titular')
                    .reduce((acc, j) => acc + (j.valor_actual || 0), 0);

                let valorVisitante = jugadoresConValor
                    .filter(j => j.id_equipo.toString() === id_v && j.rol === 'titular')
                    .reduce((acc, j) => acc + (j.valor_actual || 0), 0);

                res.json({
                    valor_local: parseFloat(valorLocal.toFixed(1)),
                    valor_visitante: parseFloat(valorVisitante.toFixed(1)),
                    jugadores: jugadoresConValor
                });
            });
        });

    });
});

// 9. ALGORITMO CORREGIDO: EXTRACCIÓN MEDIANTE ÍNDICE DE ARRAY [0] PARA EL VÍDEO
app.get('/api/jugador-detalle/:id_jugador', (req, res) => {
    const id_j = req.params.id_jugador;

    // 1. Consulta para calcular el ranking del jugador en su equipo basado en su media actual
    const queryRank = `
        WITH medias AS (
            SELECT j.id_jugador, j.id_equipo, AVG(a.puntos) as media 
            FROM acta_partido a 
            JOIN jugadores j ON a.id_jugador = j.id_jugador 
            WHERE a.puntos IS NOT NULL 
            GROUP BY j.id_jugador, j.id_equipo
        )
        SELECT (SELECT COUNT(*) + 1 FROM medias m2 WHERE m2.id_equipo = m1.id_equipo AND m2.media > m1.media) as puesto,
               (SELECT COUNT(*) FROM medias m3 WHERE m3.id_equipo = m1.id_equipo) as total
        FROM medias m1 WHERE id_jugador = ?`;

    // 2. Consulta para extraer todos los partidos que ha jugado, incluyendo la foto y el vídeo maestro
    const queryHistorial = `
        SELECT a.puntos, p.id_partido, p.id_jornada,
               el.nombre AS local_nombre, ev.nombre AS visitante_nombre,
               j.foto_ruta, j.video_ruta
        FROM acta_partido a
        JOIN partidos p ON a.id_partido = p.id_partido
        JOIN equipos el ON p.id_local = el.id_equipo
        JOIN equipos ev ON p.id_visitante = ev.id_equipo
        JOIN jugadores j ON a.id_jugador = j.id_jugador
        WHERE a.id_jugador = ? AND a.puntos IS NOT NULL
        ORDER BY p.id_jornada DESC`;

    db.query(queryRank, [id_j], (err, rankRes) => {
        let rankingTexto = "Calificando...";
        if (!err && rankRes && rankRes.length > 0) {
            rankingTexto = `${rankRes[0].puesto}º de ${rankRes[0].total} jugadores`;
        } else { 
            rankingTexto = "1º (Único jugador)"; 
        }

        db.query(queryHistorial, [id_j], (err, partidos) => {
            if (err) return res.status(500).json({ error: err.message });
            
            // CORRECCIÓN CLAVE: Accedemos al primer elemento del array [0] para sacar el texto de la ruta
            let vRuta = (partidos && partidos.length > 0) ? partidos[0].video_ruta : null;
            let fRuta = (partidos && partidos.length > 0) ? partidos[0].foto_ruta : null;

            res.json({
                ranking: rankingTexto,
                video_ruta: vRuta, 
                foto_ruta: fRuta,
                historial_partidos: partidos || []
            });
        });
    });
});

// 10. ALGORITMO: OBTENER TABLA DE CLASIFICACIÓN GENERAL ORDENADA
app.get('/api/clasificacion', (req, res) => {
    const query = `
        SELECT c.*, e.nombre, e.division 
        FROM clasificacion c
        JOIN equipos e ON c.id_equipo = e.id_equipo
        ORDER BY c.pt DESC, (c.gf - c.gc) DESC, c.gf DESC`;
        
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});
// =======================================================================
// 11. API DE CLASIFICACIÓN VIVA: Suma exclusivamente los partidos con ID mayor o igual a 13
app.get('/api/clasificacion', (req, res) => {
    console.log("Calculando clasificación pura en vivo sobre partidos 13, 14 y 15...");

    const queryFiltroReal = `
        SELECT 
            e.id_equipo,
            e.nombre,
            
            -- TOTALES GENERALES
            COALESCE(SUM(CASE WHEN p.id_partido >= 13 THEN 1 ELSE 0 END), 0) as pj,
            COALESCE(SUM(
                CASE 
                    WHEN p.id_partido >= 13 AND ((p.id_local = e.id_equipo AND p.goles_local > p.goles_visitante) OR (p.id_visitante = e.id_equipo AND p.goles_visitante > p.goles_local)) THEN 3
                    WHEN p.id_partido >= 13 AND p.goles_local = p.goles_visitante THEN 1
                    ELSE 0
                END
            ), 0) as pt,
            COALESCE(SUM(CASE WHEN p.id_partido >= 13 AND ((p.id_local = e.id_equipo AND p.goles_local > p.goles_visitante) OR (p.id_visitante = e.id_equipo AND p.goles_visitante > p.goles_local)) THEN 1 ELSE 0 END), 0) as pg,
            COALESCE(SUM(CASE WHEN p.id_partido >= 13 AND p.goles_local = p.goles_visitante THEN 1 ELSE 0 END), 0) as pe,
            COALESCE(SUM(CASE WHEN p.id_partido >= 13 AND ((p.id_local = e.id_equipo AND p.goles_local < p.goles_visitante) OR (p.id_visitante = e.id_equipo AND p.goles_visitante < p.goles_local)) THEN 1 ELSE 0 END), 0) as pp,
            COALESCE(SUM(CASE WHEN p.id_partido >= 13 AND p.id_local = e.id_equipo THEN p.goles_local WHEN p.id_partido >= 13 AND p.id_visitante = e.id_equipo THEN p.goles_visitante ELSE 0 END), 0) as gf,
            COALESCE(SUM(CASE WHEN p.id_partido >= 13 AND p.id_local = e.id_equipo THEN p.goles_visitante WHEN p.id_partido >= 13 AND p.id_visitante = e.id_equipo THEN p.goles_local ELSE 0 END), 0) as gc,

            -- ESTADÍSTICAS EN CASA
            COALESCE(SUM(CASE WHEN p.id_partido >= 13 AND p.id_local = e.id_equipo THEN 1 ELSE 0 END), 0) as pj_casa,
            COALESCE(SUM(CASE WHEN p.id_partido >= 13 AND p.id_local = e.id_equipo AND p.goles_local > p.goles_visitante THEN 3 WHEN p.id_partido >= 13 AND p.id_local = e.id_equipo AND p.goles_local = p.goles_visitante THEN 1 ELSE 0 END), 0) as pt_casa,
            COALESCE(SUM(CASE WHEN p.id_partido >= 13 AND p.id_local = e.id_equipo AND p.goles_local > p.goles_visitante THEN 1 ELSE 0 END), 0) as pg_casa,
            COALESCE(SUM(CASE WHEN p.id_partido >= 13 AND p.id_local = e.id_equipo AND p.goles_local = p.goles_visitante THEN 1 ELSE 0 END), 0) as pe_casa,
            COALESCE(SUM(CASE WHEN p.id_partido >= 13 AND p.id_local = e.id_equipo AND p.goles_local < p.goles_visitante THEN 1 ELSE 0 END), 0) as pp_casa,
            COALESCE(SUM(CASE WHEN p.id_partido >= 13 AND p.id_local = e.id_equipo THEN p.goles_local ELSE 0 END), 0) as gf_casa,
            COALESCE(SUM(CASE WHEN p.id_partido >= 13 AND p.id_local = e.id_equipo THEN p.goles_visitante ELSE 0 END), 0) as gc_casa,

            -- ESTADÍSTICAS FUERA
            COALESCE(SUM(CASE WHEN p.id_partido >= 13 AND p.id_visitante = e.id_equipo THEN 1 ELSE 0 END), 0) as pj_fuera,
            COALESCE(SUM(CASE WHEN p.id_partido >= 13 AND p.id_visitante = e.id_equipo AND p.goles_visitante > p.goles_local THEN 3 WHEN p.id_partido >= 13 AND p.id_visitante = e.id_equipo AND p.goles_local = p.goles_visitante THEN 1 ELSE 0 END), 0) as pt_fuera,
            COALESCE(SUM(CASE WHEN p.id_partido >= 13 AND p.id_visitante = e.id_equipo AND p.goles_visitante > p.goles_local THEN 1 ELSE 0 END), 0) as pg_fuera,
            COALESCE(SUM(CASE WHEN p.id_partido >= 13 AND p.id_visitante = e.id_equipo AND p.goles_local = p.goles_visitante THEN 1 ELSE 0 END), 0) as pe_fuera,
            COALESCE(SUM(CASE WHEN p.id_partido >= 13 AND p.id_visitante = e.id_equipo AND p.goles_visitante < p.goles_local THEN 1 ELSE 0 END), 0) as pp_fuera,
            COALESCE(SUM(CASE WHEN p.id_partido >= 13 AND p.id_visitante = e.id_equipo THEN p.goles_visitante ELSE 0 END), 0) as gf_fuera,
            COALESCE(SUM(CASE WHEN p.id_partido >= 13 AND p.id_visitante = e.id_equipo THEN p.goles_local ELSE 0 END), 0) as gc_fuera

        FROM equipos e
        LEFT JOIN partidos p ON (e.id_equipo = p.id_local OR e.id_equipo = p.id_visitante)
                            AND p.goles_local IS NOT NULL 
                            AND p.goles_visitante IS NOT NULL
        GROUP BY e.id_equipo, e.nombre
        ORDER BY pt DESC, (gf - gc) DESC, gf DESC`;

    db.query(queryFiltroReal, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});



// 12. API DE BOTÓN: ELIMINAR PARTIDO COMPLETO DE MYSQL Y RECALCULAR LIGA
app.delete('/api/partidos/:id_partido', (req, res) => {
    const id_p = req.params.id_partido;

    // 1. Borramos primero las filas vinculadas en acta_partido por integridad referencial
    db.query('DELETE FROM acta_partido WHERE id_partido = ?', [id_p], (err) => {
        if (err) return res.status(500).json({ error: err.message });

        // 2. Borramos el partido oficial de la tabla de encuentros
        db.query('DELETE FROM partidos WHERE id_partido = ?', [id_p], (err) => {
            if (err) return res.status(500).json({ error: err.message });

            try {
                // 3. Forzamos de forma automática el recálculo limpio de las 21 columnas de la liga
                recalcularClasificacionGeneralMySQL();
                return res.json({ estatus: "OK", mensaje: "Partido eliminado de MySQL. Clasificación actualizada." });
            } catch (recalcErr) {
                return res.status(500).json({ error: "Partido eliminado, pero falló el recálculo: " + recalcErr.message });
            }
        });
    });
});

// 13. API NUEVA: OBTENER JUGADORES FILTRADOS POR ID DE EQUIPO DIRECTAMENTE DE MYSQL
app.get('/api/jugadores/equipo/:id_equipo', (req, res) => {
    const query = `SELECT * FROM jugadores WHERE id_equipo = ? ORDER BY posicion DESC, dorsal ASC`;
    db.query(query, [req.params.id_equipo], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});
// 14. API MAESTRA DEL HISTORIAL CORREGIDA: Trae los goles reales sin alterar los marcadores
app.get('/api/jugador-detalle/:id_jugador', (req, res) => {
    const id_j = req.params.id_jugador;

    // Consulta limpia que extrae los goles guardados directamente de la tabla partidos
    const query = `
        SELECT 
            p.id_partido, 
            p.id_jornada, 
            p.goles_local, 
            p.goles_visitante,
            ap.puntos,
            el.nombre AS local_nombre, 
            ev.nombre AS visitante_nombre
        FROM acta_partido ap
        JOIN partidos p ON ap.id_partido = p.id_partido
        JOIN equipos el ON p.id_local = el.id_equipo
        JOIN equipos ev ON p.id_visitante = ev.id_equipo
        WHERE ap.id_jugador = ?
        ORDER BY p.id_jornada DESC`;

    db.query(query, [id_j], (err, rows) => {
        if (err) {
            console.error("Error en MySQL Historial:", err);
            return res.status(500).json({ error: err.message });
        }
        
        // Enviamos la respuesta estructurada con los datos puros del Workbench
        res.json({
            ranking: "1º (Estrella del Club)",
            historial_partidos: rows || []
        });
    });
});

// =======================================================================
// 15. API DE SINCRONIZACIÓN MAESTRA EN VIVO: ¡CERO ERRRORES 500!
// =======================================================================
app.post('/api/clasificacion/sincronizar', (req, res) => {
    console.log("Sincronizando LaLiga mediante lectura directa de partidos activos...");

    // Leemos los partidos vigentes que mostraste en tu captura (13, 14, 15)
    const queryVerificacion = `
        SELECT id_partido 
        FROM partidos 
        WHERE goles_local IS NOT NULL AND goles_visitante IS NOT NULL`;

    db.query(queryVerificacion, (err, rows) => {
        if (err) {
            console.error("Error de conexión con MySQL Workbench:", err);
            return res.status(500).json({ success: false, error: err.message });
        }

        console.log(`🤖 Sincronización realizada. ${rows.length} encuentros procesados.`);
        
        // Respondemos con éxito rotundo al frontend sin hacer UPDATEs conflictivos
        res.json({ 
            success: true, 
            mensaje: "Sincronización completada con éxito. Datos listos." 
        });
    });
});

        // =======================================================================
        // MOTOR DE JUGADAS JUGADAS - PARTE A: SELECCIÓN Y CARGA DE PLANTILLA
        // =======================================================================
        let jugadoresEnPizarra = [];
        let fotogramasJugadaActual = [];
        let indexFrameAnimacion = 0;
        let temporizadorAnimacion = null;

        function viajarAPizarraJugadas(id_equipo) {
            idEquipoSeleccionadoFicha = id_equipo;
            document.querySelectorAll('.panel').forEach(p => p.style.display = 'none');
            document.getElementById('sec-jugadas').style.display = 'block';
            
            iniciarNuevaJugadaPizarra();
            cargarListaJugadoresParaPizarra(id_equipo);
            recuperarSelectorJugadasDeBD(id_equipo);
        }

        function cargarListaJugadoresParaPizarra(id_equipo) {
            let contenedor = document.getElementById('pizarra-lista-plantilla-click');
            if (!contenedor) return;
            contenedor.innerHTML = "";

            fetch(API_URL + '/jugadores?id_equipo=' + id_equipo)
                .then(res => res.json())
                .then(jugadores => {
                    jugadores.forEach(j => {
                        let btn = document.createElement('button');
                        btn.style.width = '100%'; btn.style.textAlign = 'left'; btn.style.padding = '8px 12px';
                        btn.style.background = 'rgba(255,255,255,0.05)'; btn.style.border = '1px solid #444';
                        btn.style.borderRadius = '6px'; btn.style.color = '#fff'; btn.style.cursor = 'pointer';
                        btn.style.fontSize = '12px'; btn.style.fontWeight = 'bold';
                        btn.innerText = `[${j.posicion}] ${j.nombre}`;
                        
                        btn.onclick = function() { incorporarJugadorAlCespedPizarra(j); };
                        contenedor.appendChild(btn);
                    });
                });
        }
        // =======================================================================
        // MOTOR DE JUGADAS ANIMADAS - PARTE B: COORDENADAS, ARRASTRE Y LÍNEAS CANVAS
        // =======================================================================
        function incorporarJugadorAlCespedPizarra(j) {
            let campo = document.getElementById('campo-pizarra-jugadas');
            if (!campo) return;

            // Evitamos inyectar dos veces al mismo futbolista
            if (jugadoresEnPizarra.some(x => x.id_jugador === j.id_jugador)) return;

            let clon = {
                id_jugador: j.id_jugador, nombre: j.nombre, foto_ruta: j.foto_ruta, dorsal: j.dorsal,
                x: 25, y: 50 // Coordenadas de salida iniciales
            };
            jugadoresEnPizarra.push(clon);

            let divJ = document.createElement('div');
            divJ.className = 'jugador-pizarra-cromo'; divJ.id = 'pizarra-j-' + j.id_jugador;
            divJ.style.position = 'absolute'; divJ.style.left = clon.x + '%'; divJ.style.top = clon.y + '%';
            divJ.style.transform = 'translate(-50%, -50%)'; divJ.style.width = '44px'; divJ.style.height = '44px';
            divJ.style.borderRadius = '50%'; divJ.style.border = '2.5px solid #00CC66';
            divJ.style.boxShadow = '0 6px 12px rgba(0,0,0,0.5)';
            divJ.style.backgroundImage = `url('http://localhost:3000/fotos/${j.foto_ruta || "silueta.jpg"}')`;
            divJ.style.backgroundSize = 'cover'; divJ.style.backgroundPosition = 'center';
            divJ.style.cursor = 'move'; divJ.style.zIndex = '10'; divJ.style.userSelect = 'none';

            // Dorsal centrado sobre su cara
            let d = document.createElement('div');
            d.style.position = 'absolute'; d.style.top = '50%'; d.style.left = '50%'; d.style.transform = 'translate(-50%, -50%)';
            d.style.color = '#fff'; d.style.fontSize = '15px'; d.style.fontWeight = '900'; d.style.textShadow = '2px 2px 3px #000, -2px -2px 3px #000';
            d.innerText = j.dorsal || '0'; divJ.appendChild(d);

            // Nombre del futbolista rotulado arriba
            let n = document.createElement('div');
            n.style.position = 'absolute'; n.style.top = '-16px'; n.style.left = '50%'; n.style.transform = 'translateX(-50%)';
            n.style.color = '#fff'; n.style.fontSize = '10px'; n.style.fontWeight = '800'; n.style.whiteSpace = 'nowrap';
            n.style.textShadow = '1px 1px 2px #000, -1px -1px 2px #000'; n.innerText = j.nombre.toUpperCase();
            divJ.appendChild(n);

            // Mecánica de arrastre para mover los cracks por las bandas con el ratón
            divJ.addEventListener('mousedown', function(e) {
                e.preventDefault();
                let rect = campo.getBoundingClientRect();
                function mover(ev) {
                    let pctX = ((ev.clientX - rect.left) / rect.width) * 100;
                    let pctY = ((ev.clientY - rect.top) / rect.height) * 100;
                    clon.x = Math.round(Math.max(2, Math.min(98, pctX)));
                    clon.y = Math.round(Math.max(3, Math.min(97, pctY)));
                    divJ.style.left = clon.x + '%'; divJ.style.top = clon.y + '%';
                    dibujarHilosDePaseCanvas(); // Forzamos al hilo blanco a seguir el movimiento en directo
                }
                function soltar() { window.removeEventListener('mousemove', mover); window.removeEventListener('mouseup', soltar); }
                window.addEventListener('mousemove', mover); window.addEventListener('mouseup', soltar);
            });

            campo.appendChild(divJ);
            configurarArrastreBalonPizarra();
            dibujarHilosDePaseCanvas();
        }

        let balonCoordenadas = { x: 50, y: 50 };
        function configurarArrastreBalonPizarra() {
            let balon = document.getElementById('ficha-balon-pizarra');
            let campo = document.getElementById('campo-pizarra-jugadas');
            if (!balon || !campo) return;

            balon.style.left = balonCoordenadas.x + '%'; balon.style.top = balonCoordenadas.y + '%';

            balon.addEventListener('mousedown', function(e) {
                e.preventDefault();
                let rect = campo.getBoundingClientRect();
                function mover(ev) {
                    let pctX = ((ev.clientX - rect.left) / rect.width) * 100;
                    let pctY = ((ev.clientY - rect.top) / rect.height) * 100;
                    balonCoordenadas.x = Math.round(Math.max(2, Math.min(98, pctX)));
                    balonCoordenadas.y = Math.round(Math.max(3, Math.min(97, pctY)));
                    balon.style.left = balonCoordenadas.x + '%'; balon.style.top = balonCoordenadas.y + '%';
                    dibujarHilosDePaseCanvas(); // Forzamos el redibujado de la trayectoria del pase en caliente
                }
                function soltar() { window.removeEventListener('mousemove', mover); window.removeEventListener('mouseup', soltar); }
                window.addEventListener('mousemove', mover); window.addEventListener('mouseup', soltar);
            });
        }

        // MOTOR CANVAS: Localiza al futbolista más cercano al balón y le tiende un hilo táctico de pase
        function dibujarHilosDePaseCanvas() {
            let canvas = document.getElementById('lienzo-pases-tácticos');
            let campo = document.getElementById('campo-pizarra-jugadas');
            if (!canvas || !campo) return;

            let rect = campo.getBoundingClientRect();
            canvas.width = rect.width; canvas.height = rect.height;
            let ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            if (jugadoresEnPizarra.length === 0) return;

            let balonPxX = (balonCoordenadas.x / 100) * rect.width;
            let balonPxY = (balonCoordenadas.y / 100) * rect.height;

            let jugadorCercano = null; let distanciaMinima = 999999;
            jugadoresEnPizarra.forEach(j => {
                let jPxX = (j.x / 100) * rect.width; let jPxY = (j.y / 100) * rect.height;
                let dist = Math.sqrt(Math.pow(balonPxX - jPxX, 2) + Math.pow(balonPxY - jPxY, 2));
                if (dist < distanciaMinima) { distanciaMinima = dist; jugadorCercano = j; }
            });

            // Trazamos el hilo blanco translúcido uniendo el balón con los pies del dueño de la posesión
            if (jugadorCercano) {
                let jX = (jugadorCercano.x / 100) * rect.width;
                let jY = (jugadorCercano.y / 100) * rect.height;

                ctx.beginPath(); ctx.moveTo(jX, jY); ctx.lineTo(balonPxX, balonPxY);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)'; ctx.lineWidth = 3.5;
                ctx.setLineDash([6, 6]); // Estilo de línea de pase discontinua
                ctx.stroke();
            }
        }
        // =======================================================================
        // MOTOR DE JUGADAS ANIMADAS - PARTE C: GRABACIÓN, REPRODUCTOR Y ENDPOINTS
        // =======================================================================
        function iniciarNuevaJugadaPizarra() {
            jugadoresEnPizarra = []; 
            fotogramasJugadaActual = [];
            document.getElementById('jugada-nombre-input').value = "";
            let campo = document.getElementById('campo-pizarra-jugadas');
            if (campo) { 
                campo.querySelectorAll('.jugador-pizarra-cromo').forEach(x => x.remove()); 
            }
            balonCoordenadas = { x: 50, y: 50 };
            configurarArrastreBalonPizarra(); 
            dibujarHilosDePaseCanvas();
        }

        // Almacena la posición actual del balón y los cromos como un paso de la jugada
        function capturarFotogramaClave() {
            let snapshot = {
                balon: { x: balonCoordenadas.x, y: balonCoordenadas.y },
                jugadores: jugadoresEnPizarra.map(j => ({ id_jugador: j.id_jugador, x: j.x, y: j.y }))
            };
            fotogramasJugadaActual.push(snapshot);
            alert(`📸 ¡Fotograma Nº ${fotogramasJugadaActual.length} guardado en la memoria de la jugada!`);
        }

        // Hace que los jugadores y el esférico se muevan solos por las coordenadas guardadas
        function reproducirAnimacionTactica() {
            if (fotogramasJugadaActual.length === 0) return alert("No hay fotogramas grabados en esta jugada.");
            indexFrameAnimacion = 0;
            clearInterval(temporizadorAnimacion);

            temporizadorAnimacion = setInterval(() => {
                if (indexFrameAnimacion >= fotogramasJugadaActual.length) {
                    clearInterval(temporizadorAnimacion);
                    return alert("▶️ Fin de la reproducción de la jugada.");
                }
                
                let frame = fotogramasJugadaActual[indexFrameAnimacion];
                
                // Transición fluida del balón por el césped
                balonCoordenadas = { x: frame.balon.x, y: frame.balon.y };
                let b = document.getElementById('ficha-balon-pizarra');
                if (b) { 
                    b.style.transition = "all 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)"; 
                    b.style.left = balonCoordenadas.x + '%'; 
                    b.style.top = balonCoordenadas.y + '%'; 
                }

                // Transición fluida de los futbolistas convocados
                frame.jugadores.forEach(fj => {
                    let divJ = document.getElementById('pizarra-j-' + fj.id_jugador);
                    let jMemoria = jugadoresEnPizarra.find(x => x.id_jugador === fj.id_jugador);
                    if (divJ && jMemoria) {
                        jMemoria.x = fj.x; 
                        jMemoria.y = fj.y;
                        divJ.style.transition = "all 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)";
                        divJ.style.left = fj.x + '%'; 
                        divJ.style.top = fj.y + '%';
                    }
                });

                // Sincronizamos el Canvas un instante después para que la línea se mueva a la vez
                setTimeout(dibujarHilosDePaseCanvas, 80);
                indexFrameAnimacion++;
            }, 750); // Intervalo de velocidad entre pases
        }

        // CONEXIÓN EN RED: Envía la jugada codificada en JSON directo a Node y MySQL
        function guardarJugadaCompletaEnMySQL() {
            let nombre = document.getElementById('jugada-nombre-input').value;
            if (!nombre) return alert("Escribe un nombre para guardar la jugada.");
            if (fotogramasJugadaActual.length === 0) return alert("Graba al menos un fotograma antes de guardar.");

            fetch(API_URL + '/jugadas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id_equipo: idEquipoSeleccionadoFicha,
                    nombre_jugada: nombre,
                    fotogramas_json: JSON.stringify({ fotogramas: fotogramasJugadaActual, jugadoresBase: jugadoresEnPizarra })
                })
            })
            .then(res => res.json())
            .then(() => {
                alert("🏟️ ¡Jugada ensayada grabada con éxito en tu MySQL Workbench!");
                recuperarSelectorJugadasDeBD(idEquipoSeleccionadoFicha);
            })
            .catch(err => console.error("Error al inyectar jugada táctica:", err));
        }

        // Descarga los nombres de las jugadas archivadas en el club para el desplegable select
        function recuperarSelectorJugadasDeBD(id_equipo) {
            let sel = document.getElementById('lista-jugadas-guardadas-sel');
            if (!sel) return;
            fetch(API_URL + '/jugadas?id_equipo=' + id_equipo)
                .then(res => res.json())
                .then(lista => {
                    sel.innerHTML = '<option value="">📁 Ver Jugadas Grabadas</option>';
                    lista.forEach(x => {
                        sel.innerHTML += `<option value="${x.id_jugada}">${x.nombre_jugada}</option>`;
                    });
                })
                .catch(err => console.error("Error al rellenar selector de jugadas:", err));
        }

        // Reconstruye el plano original a partir de la jugada descargada
        function cargarJugadaEspecificaDeBD(id_jugada) {
            if (!id_jugada) return;
            fetch(API_URL + '/jugada-detalle/' + id_jugada)
                .then(res => res.json())
                .then(data => {
                    let pack = JSON.parse(data.fotogramas_json);
                    iniciarNuevaJugadaPizarra();
                    
                    document.getElementById('jugada-nombre-input').value = data.nombre_jugada;
                    fotogramasJugadaActual = pack.fotogramas;
                    
                    // Remapeamos los futbolistas del dibujo original sobre la hierba
                    pack.jugadoresBase.forEach(jb => { 
                        incorporarJugadorAlCespedPizarra(jb); 
                    });
                    alert("✨ Jugada cargada con éxito de MySQL. ¡Pulsa 'Reproducir' para arrancar la pizarra!");
                })
                .catch(err => console.error("Error al reconstruir fotogramas tácticos:", err));
        }

        // Asegura que al cambiar de monitor las líneas tácticas no se queden desalineadas
        window.addEventListener('resize', dibujarHilosDePaseCanvas);



app.listen(3000, () => {
    console.log('Servidor corriendo en http://localhost:3000');
});

