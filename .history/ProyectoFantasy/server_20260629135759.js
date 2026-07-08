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

// 5. OBTENER DETALLE DEL ACTA COMPLETA INCLUYENDO FOTOS Y VÍDEOS MULTIMEDIA
app.get('/api/acta/:id_partido', (req, res) => {
    const query = `
        SELECT a.*, j.nombre, j.posicion, j.id_equipo, j.foto_ruta, j.video_ruta 
        FROM acta_partido a 
        JOIN jugadores j ON a.id_jugador = j.id_jugador 
        WHERE a.id_partido = ?`;
    db.query(query, [req.params.id_partido], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
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
// 11. API DE BOTÓN: RECALCULAR LA CLASIFICACIÓN MANUALMENTE DESDE LA WEB
app.post('/api/clasificacion/sincronizar', (req, res) => {
    try {
        // Ejecutamos la función maestra de conteo de partidos que creamos antes
        recalcularClasificacionGeneralMySQL();
        res.json({ estatus: "OK", mensaje: "¡Base de datos sincronizada! Tabla recalculada con éxito." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// 12. API DE BOTÓN: ELIMINAR PARTIDO COMPLETO DE MYSQL Y RECALCULAR LIGA
app.delete('/api/partidos/eliminar/:id_partido', (req, res) => {
    const id_p = req.params.id_partido;

    // 1. Borramos primero las filas vinculadas en acta_partido por integridad referencial
    db.query('DELETE FROM acta_partido WHERE id_partido = ?', [id_p], (err) => {
        if (err) return res.status(500).json({ error: err.message });

        // 2. Borramos el partido oficial de la tabla de encuentros
        db.query('DELETE FROM partidos WHERE id_partido = ?', [id_p], (err) => {
            if (err) return res.status(500).json({ error: err.message });

            // 3. Forzamos de forma automática el recálculo limpio de las 21 columnas de la liga
            recalcularClasificacionGeneralMySQL();
            res.json({ estatus: "OK", mensaje: "Partido eliminado de MySQL. Clasificación actualizada." });
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
// 14. API MAESTRA DEL HISTORIAL: Totalmente unificada y blindada a prueba de fallos
app.get('/api/jugador-detalle/:id_jugador', (req, res) => {
    const id_j = req.params.id_jugador;

    // Buscamos todos los partidos donde participe el jugador en actas
    const query = `
        SELECT 
            p.id_partido, 
            p.id_jornada, 
            COALESCE(p.goles_local, 0) as goles_local, 
            COALESCE(p.goles_visitante, 0) as goles_visitante,
            COALESCE(ap.puntos, 0) as puntos,
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
        
        // Enviamos siempre la respuesta estructurada limpia bajo la clave 'historial_partidos'
        res.json({
            ranking: "1º (Estrella del Club)",
            historial_partidos: rows || []
        });
    });
});



app.listen(3000, () => {
    console.log('Servidor corriendo en http://localhost:3000');
});

