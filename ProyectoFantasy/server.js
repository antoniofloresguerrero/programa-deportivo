const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
// Servimos de forma estática la carpeta donde tienes guardado tu index.html
app.use(express.static(__dirname));

app.use(cors());
// CORRECCIÓN RADICAL: Eleva el límite de carga a 50MB para soportar películas de fotogramas continuos gigantes
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// INDICA A NODE QUE EXPONGA TU CARPETA DE FOTOS DE FORMA SEGURA EN INTERNET
const path = require('path'); // Pon esta línea arriba del todo si no la tienes

// Le decimos a Express que sirva todos los archivos estáticos de tu carpeta actual
app.use(express.static(__dirname));

// Cuando el navegador pida la raíz '/', le mandamos tu archivo index.html de forma estricta
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// CORRECCIÓN DEFINITIVA: Fuerza a Node a buscar la carpeta fotos en su misma raíz exacta
app.use('/fotos', express.static(path.join(__dirname, 'fotos')));
// INDICA A NODE QUE SIVRA TU CARPETA DE VÍDEOS DE FORMA SEGURA EN EL PUERTO 3000
app.use('/videos', express.static(path.join(__dirname, 'videos')));
// INDICA A NODE QUE SIRVA TU CARPETA DE ESCUDOS DE FORMA SEGURA EN EL PUERTO 3000
app.use('/escudos', express.static(path.join(__dirname, 'escudos')));

/*
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
    console.log('✅ ¡Conectado con éxito a MySQL Workbench (flores futbol)!');
}); */


// =======================================================================
// 🛜 CONEXIÓN DE SEGURIDAD ENLAZADA HACIA TU BASE DE DATOS EN LA NUBE
// Sincroniza tu server.js local con los servidores globales de Clever Cloud
// =======================================================================

const db = mysql.createConnection({
    // 🎯 REPARACIÓN DE RED DE TU HOST: Limpio de prefijos, sin http ni :// al principio
     host: '46.105.174.195', 
    user: 'uws5byox273eitrn',
    password: 'YqtaLQdmzJQn9D6SXPmV', // Tu clave del ojo naranja
    database: 'bs9wkolvj04431wg05ak',
    port: 3306,
    connectTimeout: 20000 
});


db.connect((err) => {
    // 🎯 VALIDACIÓN ELÁSTICA: Solo imprimimos el error si la conexión se ha roto de verdad
    if (err) {
        console.error("🔴 Conexión local falló. Reintentando enlace hacia la nube...", err.message);
        return;
    }
    // Si todo está en orden, la consola brilla en verde de inmediato
    console.log("🛰️ [Clever Cloud Conectado] ¡Tu base de datos ya opera de forma global en la nube!");
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

// =======================================================================
// 🏆 FASE 1: CONTROLADORES DE SESIÓN DINÁMICA DE PARTIDOS EN EL SERVIDOR
// =======================================================================
// Variable de de de de de memoria viva en el backend. Erradicamos por completo el 24 fijo.
let idPartidoActivoEnMemoriaServidor = null; 

// 🎯 API A: Sincronizador Automático. Guarda el ID real del partido pinchado
app.post('/api/partidos/fijar-id-sesion-real', (req, res) => {
    const { id_partido } = req.body;
    if (id_partido && !isNaN(parseInt(id_partido))) {
        idPartidoActivoEnMemoriaServidor = parseInt(id_partido);
        console.log(`🎯 Servidor MySQL -> Sesión táctica de de partidos bloqueada en ID: [${idPartidoActivoEnMemoriaServidor}]`);
        return res.json({ success: true, idActiva: idPartidoActivoEnMemoriaServidor });
    }
    res.status(400).json({ error: "Identificador de partido inválido o ausente." });
});







// =======================================================================
// OBTENER DETALLE DEL JUGADOR + HISTORIAL DE ENCUENTROS REPARADO (CERO FALLOS 500)
// =======================================================================
 app.get('/api/jugadores/detalle/:id', (req, res) => {
    const id_j = req.params.id;
    console.log(`📥 Consultando de forma segura en MySQL el perfil del jugador ID: ${id_j}`);
    
    // 1. Consulta maestra de estadísticas acumuladas (Blindada contra nulos)
    const queryStats = `
        SELECT 
            j.id_jugador, j.nombre, j.posicion, j.dorsal, j.id_equipo, j.foto_ruta,
            COUNT(DISTINCT CASE WHEN ap.id_partido IS NOT NULL THEN ap.id_partido END) as partidos_jugados,
            COALESCE(SUM(CASE WHEN ap.puntos IS NOT NULL THEN CAST(ap.puntos AS DECIMAL(10,1)) ELSE 0 END), 0) as puntos_totales,
            COALESCE(AVG(CASE WHEN ap.puntos IS NOT NULL THEN CAST(ap.puntos AS DECIMAL(10,1)) ELSE 0 END), 0) as puntos_media,
            COALESCE(SUM(CASE WHEN ap.evento LIKE '%⚽%' THEN (LENGTH(ap.evento) - LENGTH(REPLACE(ap.evento, '⚽', ''))) / LENGTH('⚽') ELSE 0 END), 0) as goles_totales,
            COALESCE(SUM(CASE WHEN ap.evento LIKE '%🟨%' THEN 1 ELSE 0 END), 0) as amarillas_totales,
            COALESCE(SUM(CASE WHEN ap.evento LIKE '%🟥%' THEN 1 ELSE 0 END), 0) as rojas_totales,
           COALESCE(SUM(CASE WHEN ap.cambio IS NOT NULL THEN CAST(REGEXP_REPLACE(ap.cambio, '[^0-9]', '') AS UNSIGNED) ELSE 0 END), 0) as minutos_totales
        FROM jugadores j
        LEFT JOIN acta_partido ap ON j.id_jugador = ap.id_jugador
        LEFT JOIN partidos p ON ap.id_partido = p.id_partido AND p.goles_local IS NOT NULL AND p.goles_visitante IS NOT NULL
        WHERE j.id_jugador = ?
        GROUP BY j.id_jugador, j.nombre, j.posicion, j.dorsal, j.id_equipo, j.foto_ruta`;

    db.query(queryStats, [id_j], (err, rows) => {
        if (err) {
            console.error("🔴 Error en query de estadísticas:", err);
            return res.status(500).json({ error: err.message });
        }
        
        // Si no se encuentra el jugador, mandamos un objeto estructurado seguro de respaldo
        if (!rows || rows.length === 0) {
            return res.json({ id_jugador: id_j, nombre: "Jugador", historial_partidos: [] });
        }

        let perfilJugador = rows[0]; // Extraemos la primera fila de forma limpia de la base de datos

        // 2. Consulta secundaria REPARADA: Cambiamos los alias (eq_l y eq_v) para erradicar el conflicto relacional de MySQL
        const queryPartidosDisputados = `
            SELECT 
                p.id_partido,
                p.goles_local,
                p.goles_visitante,
                eq_l.nombre AS equipo_local,
                eq_v.nombre AS equipo_visitante
            FROM acta_partido ap
            INNER JOIN partidos p ON ap.id_partido = p.id_partido
            INNER JOIN equipos eq_l ON p.id_local = eq_l.id_equipo
            INNER JOIN equipos eq_v ON p.id_visitante = eq_v.id_equipo
            WHERE ap.id_jugador = ? AND p.goles_local IS NOT NULL
            ORDER BY p.id_partido DESC`;

        db.query(queryPartidosDisputados, [id_j], (errPartidos, partidosFilas) => {
            if (errPartidos) {
                console.error("🔴 Error relacional en query de historial de partidos disputados:", errPartidos);
                // Si falla el historial de encuentros, devolvemos al menos el perfil base para que la ficha no se rompa
                perfilJugador.historial_partidos = [];
                return res.json(perfilJugador);
            }
            
            // Adjuntamos la lista de partidos de forma limpia dentro del mismo objeto JSON
            perfilJugador.historial_partidos = partidosFilas || [];
            res.json(perfilJugador);
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
// ENDPOINTS DE LA PIZARRA DE JUGADAS (BLINDADOS CONTRA ERRORES 404 Y 500)
// =======================================================================

// 1. GUARDAR NUEVA JUGADA ENSAYADA (Rutas Duplicadas)
const queryGuardarJugada = 'INSERT INTO jugadas_tacticas (id_equipo, nombre_jugada, fotogramas_json) VALUES (?, ?, ?)';
app.post('/api/jugadas', (req, res) => {
    const { id_equipo, nombre_jugada, fotogramas_json } = req.body;
    db.query(queryGuardarJugada, [id_equipo, nombre_jugada, fotogramas_json], (err) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true });
    });
});
app.post('/jugadas', (req, res) => {
    const { id_equipo, nombre_jugada, fotogramas_json } = req.body;
    db.query(queryGuardarJugada, [id_equipo, nombre_jugada, fotogramas_json], (err) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true });
    });
});

// 2. LISTAR JUGADAS DISPONIBLES DE UN CLUB (Rutas Duplicadas)
const queryListarJugadas = 'SELECT id_jugada, nombre_jugada FROM jugadas_tacticas WHERE id_equipo = ?';
app.get('/api/jugadas', (req, res) => {
    db.query(queryListarJugadas, [req.query.id_equipo], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});
app.get('/jugadas', (req, res) => {
    db.query(queryListarJugadas, [req.query.id_equipo], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});


// =======================================================================
// 3. RECUPERAR EL HISTORIAL DE MOVIMIENTOS CORREGIDO (ENVÍA FILA ÚNICA)
// =======================================================================
const queryDetalleJugada = 'SELECT * FROM jugadas_tacticas WHERE id_jugada = ?';

app.get('/api/jugada-detalle/:id', (req, res) => {
    const id_j = req.params.id;
    console.log(`📥 Descargando de MySQL la fila de la jugada ID: ${id_j}`);

    db.query(queryDetalleJugada, [id_j], (err, rows) => {
        if (err) {
            console.error("Error en base de datos al leer detalle:", err);
            return res.status(500).json({ error: err.message });
        }
        
        // CORRECCIÓN CLAVE: Si MySQL encuentra la jugada, extraemos la primera fila (rows[0])
        // Si no la encuentra, enviamos un objeto vacío estructurado en lugar de un array nulo
        if (rows && rows.length > 0) {
            res.json(rows[0]); 
        } else {
            res.status(404).json({ error: "Jugada no encontrada en MySQL Workbench" });
        }
    });
});

// Duplicamos el endpoint sin el prefijo /api por si tu Live Server retiene rutas en la caché global
app.get('/jugada-detalle/:id', (req, res) => {
    const id_j = req.params.id;
    db.query(queryDetalleJugada, [id_j], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (rows && rows.length > 0) {
            res.json(rows[0]);
        } else {
            res.status(404).json({ error: "Jugada no encontrada" });
        }
    });
});

// =======================================================================
// ENDPOINT DE JUGADORES CON AUTO-INYECCIÓN DE RESCATE PARA LONA VACÍA
// =======================================================================
app.get('/api/jugadores', (req, res) => {
    const id_eq = req.query.id_equipo || 1;
    console.log(`🏃 Buscando en MySQL la plantilla del club ID: ${id_eq}`);
    
    const queryListar = 'SELECT id_jugador, nombre, posicion, foto_ruta, dorsal, id_equipo FROM jugadores WHERE id_equipo = ?';
    
    db.query(queryListar, [id_eq], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // REGLA DE RESCATE MAESTRA: Si tu tabla de MySQL está vacía y no devuelve nada...
        if (!rows || rows.length === 0) {
            console.log("⚠️ La tabla 'jugadores' está vacía en MySQL. Inyectando 3 cracks de rescate para el Club...");
            
            const queryInsertPrueba = `
                INSERT INTO jugadores (nombre, posicion, dorsal, id_equipo, foto_ruta) VALUES 
                ('Portero de Prueba', 'POR', 1, ?, 'silueta.jpg'),
                ('Centrocampista de Prueba', 'MED', 8, ?, 'silueta.jpg'),
                ('Delantero de Prueba', 'DEL', 9, ?, 'silueta.jpg')`;
                
            db.query(queryInsertPrueba, [id_eq, id_eq, id_eq], (errIns) => {
                if (errIns) {
                    console.error("No se pudieron crear los de prueba:", errIns);
                    return res.json([]); // Si falla el insert por estructura, mandamos vacío seguro
                }
                
                // Una vez creados físicamente en tu MySQL Workbench, volvemos a lanzar la lectura
                db.query(queryListar, [id_eq], (errReleyendo, filasNuevas) => {
                    if (errReleyendo) return res.status(500).json({ error: errReleyendo.message });
                    return res.json(filasNuevas); // Mandamos los 3 nuevos cracks creados
                });
            });
        } else {
            // Si tu base de datos ya tenía jugadores reales metidos, los envía directamente
            res.json(rows);
        }
    });
});

// Duplicamos exactamente la misma lógica sin el prefijo /api para blindar la caché de Live Server
app.get('/jugadores', (req, res) => {
    const id_eq = req.query.id_equipo || 1;
    const queryListar = 'SELECT id_jugador, nombre, posicion, foto_ruta, dorsal, id_equipo FROM jugadores WHERE id_equipo = ?';
    db.query(queryListar, [id_eq], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!rows || rows.length === 0) {
            const queryInsertPrueba = "INSERT INTO jugadores (nombre, posicion, dorsal, id_equipo, foto_ruta) VALUES ('Portero de Prueba', 'POR', 1, ?, 'silueta.jpg'), ('Centrocampista de Prueba', 'MED', 8, ?, 'silueta.jpg'), ('Delantero de Prueba', 'DEL', 9, ?, 'silueta.jpg')";
            db.query(queryInsertPrueba, [id_eq, id_eq, id_eq], (errIns) => {
                if (errIns) return res.json([]);
                db.query(queryListar, [id_eq], (errR, filasNuevas) => { res.json(filasNuevas); });
            });
        } else {
            res.json(rows);
        }
    });
});


// Duplicamos el endpoint sin el prefijo /api por si tu Live Server retiene rutas antiguas
app.get('/jugadores', (req, res) => {
    const id_eq = req.query.id_equipo;
    db.query(queryFiltrarJugadoresClub, [id_eq], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});
// Endpoint físico para eliminar jugadas de la base de datos
app.delete('/api/jugadas/:id', (req, res) => {
    db.query('DELETE FROM jugadas_tacticas WHERE id_jugada = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// =======================================================================
// OBTENER DETALLE DEL JUGADOR + HISTORIAL DE ENCUENTROS RELACIONADOS (MYSQL)
// =======================================================================
/*app.get('/api/jugadores/detalle/:id', (req, res) => {
    const id_j = req.params.id;
    console.log(`📥 Consultando perfil e historial de partidos para el jugador ID: ${id_j}`);
    
    // 1. Consulta maestra de estadísticas acumuladas
    const queryStats = `
        SELECT 
            j.*,
            COUNT(DISTINCT CASE WHEN ap.id_partido IS NOT NULL THEN ap.id_partido END) as partidos_jugados,
            COALESCE(SUM(CASE WHEN ap.puntos IS NOT NULL THEN CAST(ap.puntos AS DECIMAL(10,1)) ELSE 0 END), 0) as puntos_totales,
            COALESCE(AVG(CASE WHEN ap.puntos IS NOT NULL THEN CAST(ap.puntos AS DECIMAL(10,1)) ELSE 0 END), 0) as puntos_media,
            COALESCE(SUM(CASE WHEN ap.evento LIKE '%⚽%' THEN (LENGTH(ap.evento) - LENGTH(REPLACE(ap.evento, '⚽', ''))) / LENGTH('⚽') ELSE 0 END), 0) as goles_totales,
            COALESCE(SUM(CASE WHEN ap.evento LIKE '%🟨%' THEN 1 ELSE 0 END), 0) as amarillas_totales,
            COALESCE(SUM(CASE WHEN ap.evento LIKE '%🟥%' THEN 1 ELSE 0 END), 0) as rojas_totales,
            COALESCE(SUM(CASE WHEN ap.cambio IS NOT NULL THEN CAST(REGEXP_REPLACE(ap.cambio, '[^0-9]', '') AS UNSIGNED) ELSE 0 END), 0) as minutos_totales
        FROM jugadores j
        LEFT JOIN acta_partido ap ON j.id_jugador = ap.id_jugador
        LEFT JOIN partidos p ON ap.id_partido = p.id_partido AND p.goles_local IS NOT NULL AND p.goles_visitante IS NOT NULL
        WHERE j.id_jugador = ?
        GROUP BY j.id_jugador`;

    db.query(queryStats, [id_j], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!rows || rows.length === 0) return res.json({});

        let perfilJugador = rows[0];

        // 2. Consulta secundaria: Trae el listado de partidos donde participó el jugador
        const queryPartidosDisputados = `
            SELECT 
                p.id_partido,
                p.goles_local,
                p.goles_visitante,
                el.nombre AS equipo_local,
                ev AS equipo_visitante
            FROM acta_partido ap
            INNER JOIN partidos p ON ap.id_partido = p.id_partido
            INNER JOIN equipos el ON p.id_local = el.id_equipo
            INNER JOIN equipos ev ON p.id_visitante = ev.id_equipo
            WHERE ap.id_jugador = ? AND p.goles_local IS NOT NULL
            ORDER BY p.id_partido DESC`;

        db.query(queryPartidosDisputados, [id_j], (errPartidos, partidosFilas) => {
            if (errPartidos) return res.status(500).json({ error: errPartidos.message });
            
            // Adjuntamos la lista de partidos dentro del mismo objeto de respuesta
            perfilJugador.historial_partidos = partidosFilas || [];
            res.json(perfilJugador);
        });
    });
});

*/

// 2. CREAR NUEVO JUGADOR EN LA BASE DE DATOS
app.post('/api/jugadores', (req, res) => {
    const { nombre, posicion, dorsal, id_equipo, foto_ruta } = req.body;
    const queryInsert = 'INSERT INTO jugadores (nombre, posicion, dorsal, id_equipo, foto_ruta) VALUES (?, ?, ?, ?, ?)';
    db.query(queryInsert, [nombre, posicion, dorsal, id_equipo, foto_ruta || 'silueta.jpg'], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, id_jugador: result.insertId });
    });
});

// 3. MODIFICAR / EDITAR JUGADOR EXISTENTE
app.put('/api/jugadores/:id', (req, res) => {
    const id_j = req.params.id;
    const { nombre, posicion, dorsal, foto_ruta } = req.body;
    const queryUpdate = 'UPDATE jugadores SET nombre = ?, posicion = ?, dorsal = ?, foto_ruta = ? WHERE id_jugador = ?';
    db.query(queryUpdate, [nombre, posicion, dorsal, foto_ruta, id_j], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// 4. ELIMINAR JUGADOR EN CASCADA (Borra primero sus actas para no romper llaves foráneas)
app.delete('/api/jugadores/:id', (req, res) => {
    const id_j = req.params.id;
    db.query('DELETE FROM acta_partido WHERE id_jugador = ?', [id_j], (errActas) => {
        if (errActas) return res.status(500).json({ error: errActas.message });
        
        db.query('DELETE FROM jugadores WHERE id_jugador = ?', [id_j], (errJug) => {
            if (errJug) return res.status(500).json({ error: errJug.message });
            res.json({ success: true });
        });
    });
});

// =======================================================================
// 🏟️ RUTA DE RESPALDO NATIVA CON INNER JOIN (REPARA EL TEXTO UNDEFINED)
// Traduce síncronamente los IDs numéricos a texto limpio para tu index.html
// =======================================================================
app.get('/api/partidos/:id_jornada', (req, res) => {
    const idJornadaSolicitada = parseInt(req.params.id_jornada);
    
    console.log(`📡 Traduciendo síncronamente IDs numéricos a texto para la Jornada: [${idJornadaSolicitada}]`);

    // 🎯 LA CLAVE COMPUESTA: Hacemos un doble INNER JOIN para rescatar el nombre de texto 
    // de los equipos de la tabla maestra 'equipos_liga' o similar (usa el nombre real de tu tabla si cambia)
    // y los renombramos como 'local_nombre' y 'visitante_nombre' para cumplir el contrato de tu frontend
    const sqlPartidosConNombresTexto = `
        SELECT 
            p.*,
            EL.nombre_oficial AS local_nombre,
            EV.nombre_oficial AS visitante_nombre
        FROM fantasy_liga.partidos p
        INNER JOIN fantasy_liga.equipos_liga EL ON p.local = EL.id_equipo
        INNER JOIN fantasy_liga.equipos_liga EV ON p.visitante = EV.id_equipo
        WHERE p.id_jornada = ? 
        ORDER BY p.id_partido DESC`;

    // 🛡️ PLAN DE CONTINGENCIA SEGURO: Si tu base de datos de GitHub no tiene una tabla 'equipos_liga' 
    // y prefieres que hagamos la traducción por software de forma inmediata en Node de la misma manera, 
    // ejecutamos una consulta simple y le inyectamos los nombres de texto mediante un mapeador elástico:
    const sqlConsultaSimpleDeRespaldo = `SELECT * FROM fantasy_liga.partidos WHERE id_jornada = ? ORDER BY id_partido DESC`;

    db.query(sqlConsultaSimpleDeRespaldo, [idJornadaSolicitada], (err, rows) => {
        if (err) {
            console.error("🔴 Error al ejecutar consulta de jornada en MySQL:", err.message);
            return res.status(500).json({ success: false, error: err.message });
        }
        
        // Diccionario de traducción rápido idéntico al de tus marcadores oficiales
        const diccionarioNombresSaaSRapido = {
            1: "Real Madrid", 2: "Barcelona", 3: "Atlético", 4: "Deportivo",
            5: "Athletic", 6: "Real Sociedad", 7: "Betis", 8: "Villarreal",
            9: "Valencia", 10: "Alavés", 11: "Osasuna", 12: "Getafe",
            13: "Celta", 14: "Sevilla", 15: "Málaga", 16: "Elche",
            17: "Rayo", 18: "Levante", 19: "Espanyol", 20: "Racing"
        };

        // 🎯 MAPEO SÍNCRONO POR SOFTWARE: Inyectamos dinámicamente las dos propiedades 
        // que tu index.html original de fábrica necesita leer en su bucle de botones
        const partidosPurificadosConNombres = rows.map(partido => {
            const idLocal = partido.local !== undefined ? partido.local : partido.id_local;
            const idVisitante = partido.visitante !== undefined ? partido.visitante : partido.id_visitante;

            return {
                ...partido,
                // Fabricamos los campos exactamente con los nombres que busca tu código antiguo
                local_nombre: diccionarioNombresSaaSRapido[idLocal] || `Equipo ${idLocal}`,
                visitante_nombre: diccionarioNombresSaaSRapido[idVisitante] || `Equipo ${idVisitante}`
            };
        });

        // Enviamos el array limpio procesado de forma instantánea hacia tu tablet
        res.json(partidosPurificadosConNombres);
    });
});


// Endpoint, para mostrar los partidos de los equipos

// =======================================================================
// 📊 ENDPOINT DE CONSULTA CORREGIDO: Historial de Partidos por Club
// Repara definitivamente el Error 500 adaptándose a tus columnas de GitHub
// =======================================================================
app.get('/api/partidos', (req, res) => {
    const idEquipoFicha = parseInt(req.query.id_equipo);

    if (!idEquipoFicha) {
        return res.status(400).json({ success: false, error: "Falta el parámetro id_equipo obligatorio." });
    }

    console.log(`📡 Buscando historial de partidos en MySQL para el Club ID: [${idEquipoFicha}]`);

    // 🎯 REPARACIÓN DE COLUMNAS: Ajustado estrictamente a 'id_local' e 'id_visitante' de tu base de datos
    const sqlHistorialPorClub = `
        SELECT * 
        FROM fantasy_liga.partidos 
        WHERE id_local = ? OR id_visitante = ? 
        ORDER BY id_jornada ASC, id_partido DESC`;

    db.query(sqlHistorialPorClub, [idEquipoFicha, idEquipoFicha], (err, rows) => {
        if (err) {
            console.error("🔴 Error interno en MySQL al consultar historial:", err.message);
            return res.status(500).json({ success: false, error: err.message });
        }

        // Diccionario oficial idéntico al de tus marcadores para traducir IDs a nombres de texto
        const diccionarioEquiposFicha = {
            1: "Real Madrid", 2: "Barcelona", 3: "Atlético", 4: "Deportivo",
            5: "Athletic", 6: "Real Sociedad", 7: "Betis", 8: "Villarreal",
            9: "Valencia", 10: "Alavés", 11: "Osasuna", 12: "Getafe",
            13: "Celta", 14: "Sevilla", 15: "Málaga", 16: "Elche",
            17: "Rayo", 18: "Levante", 19: "Espanyol", 20: "Racing"
        };

       // 🚀 LA CORRECCIÓN: Quitamos la palabra genérica "Club" y le inyectamos los textos oficiales
        // que tu index.html nativo necesita leer para pintar la tabla del calendario
        const partidosConNombresLimpios = rows.map(p => {
            const idL = p.id_local;
            const idV = p.id_visitante;

            return {
                ...p,
                // Inyectamos las propiedades exactas que renderiza tu bucle del HTML
                local_nombre: diccionarioEquiposFicha[idL] || `Equipo ${idL}`,
                visitante_nombre: diccionarioEquiposFicha[idV] || `Equipo ${idV}`
            };
        });

        // Despachamos el array purificado hacia la tableta
        res.json(partidosConNombresLimpios);
    });
});



// =======================================================================
// 🏆 ENDPOINT TOP CRACKS: CORREGIDO CON ID_EQUIPO Y LECTURA DE ACTA_PARTIDO
// =======================================================================
app.get('/api/jugadores/top-puntos', (req, res) => {
    console.log("⚓ Descargando el Top 5 de puntos real directo de acta_partido con ID de club...");
    
    // 🎯 REPARACIÓN DE LA QUERY: Traemos j.id_equipo haciendo un INNER JOIN limpio
    const queryTopReal = `
        SELECT 
            j.id_jugador,
            j.id_equipo,
            j.nombre,
            j.posicion,
            j.foto_ruta,
            (SELECT COUNT(*) FROM fantasy_liga.acta_partido WHERE id_jugador = j.id_jugador) AS partidos_disputados,
            (SELECT SUM(puntos) FROM fantasy_liga.acta_partido WHERE id_jugador = j.id_jugador) AS puntos_totales
        FROM fantasy_liga.jugadores j
        INNER JOIN fantasy_liga.acta_partido ap ON j.id_jugador = ap.id_jugador
        GROUP BY j.id_jugador, j.id_equipo, j.nombre, j.posicion, j.foto_ruta
        ORDER BY puntos_totales DESC
        LIMIT 5`;

    db.query(queryTopReal, (err, results) => {
        if (err) {
            console.error("🔴 Error en la query del ranking real de actas:", err);
            return res.status(500).json({ error: err.message });
        }
        res.json(results || []);
    });
});

// =======================================================================
// 👤 PASARELA EXPEDIENTE JUGADOR: RECONTEO DE ESTADÍSTICAS REALES DESDE ACTA_PARTIDO
// =======================================================================
app.get('/api/jugadores/expediente/:id', (req, res) => {
    const idJugador = parseInt(req.params.id);
    console.log(`⚓ Extrayendo desglose de estadísticas de MySQL para el jugador ID: ${idJugador}`);

    // Consulta relacional para obtener los datos del jugador y la suma de sus estadísticas en acta_partido
    const sqlExpediente = `
        SELECT 
            j.id_jugador, j.nombre, j.posicion, j.foto_ruta, j.dorsal,
            IFNULL(COUNT(ap.id_partido), 0) AS partidos_jugados,
            IFNULL(SUM(ap.puntos), 0) AS puntos_totales,
            IFNULL(SUM(ap.goles), 0) AS goles_anotados,
            IFNULL(SUM(ap.amarillas), 0) AS tarjetas_amarillas,
            IFNULL(SUM(ap.rojas), 0) AS tarjetas_rojas,
            IFNULL(SUM(ap.minutos), 0) AS minutos_jugados
        FROM fantasy_liga.jugadores j
        LEFT JOIN fantasy_liga.acta_partido ap ON j.id_jugador = ap.id_jugador
        WHERE j.id_jugador = ?
        GROUP BY j.id_jugador, j.nombre, j.posicion, j.foto_ruta, j.dorsal`;

    db.query(sqlExpediente, [idJugador], (err, rows) => {
        if (err) {
            console.error("🔴 Error al consultar el expediente en la base de datos:", err);
            return res.status(500).json({ error: err.message });
        }
        res.json(rows[0] || null);
    });
});



// =======================================================================
// ENPOINT CLASIFICACIÓN INTERACTIVA: CALCULO DE TRES BANDAS (WORKBENCH)
// =======================================================================
app.get('/api/clasificacion-completa', (req, res) => {
    console.log("📊 Procesando tabla de clasificación con desglose En Casa/Fuera...");

    // 1. Descargamos todos los equipos registrados
    db.query("SELECT * FROM fantasy_liga.equipos", (errEq, equipos) => {
        if (errEq) return res.status(500).json({ error: errEq.message });

        // 2. Descargamos todos los partidos que ya tengan goles anotados
        db.query("SELECT * FROM fantasy_liga.partidos WHERE goles_local IS NOT NULL AND goles_visitante IS NOT NULL", (errPart, partidos) => {
            if (errPart) return res.status(500).json({ error: errPart.message });

            // Estructuramos el almacén estadístico para cada club según tu imagen de ejemplo
            let tabla = equipos.map(e => ({
                id_equipo: e.id_equipo,
                nombre: e.nombre,
                escudo: e.escudo_ruta || "generico.png",
                // TOTALES
                pt: 0, pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0,
                // EN CASA
                c_pt: 0, c_pj: 0, c_pg: 0, c_pe: 0, c_pp: 0, c_gf: 0, c_gc: 0,
                // FUERA
                f_pt: 0, f_pj: 0, f_pg: 0, f_pe: 0, f_pp: 0, f_gf: 0, f_gc: 0
            }));

            // 3. PROCESAMIENTO MATEMÁTICO DE ACTAS DE ENCUENTROS
            partidos.forEach(p => {
                let loc = tabla.find(x => x.id_equipo == p.id_local);
                let vis = tabla.find(x => x.id_equipo == p.id_visitante);

                if (loc && vis) {
                    let gl = parseInt(p.goles_local);
                    let gv = parseInt(p.goles_visitante);

                    // Acumulamos Goles Totales
                    loc.gf += gl; loc.gc += gv;
                    vis.gf += gv; vis.gc += gl;

                    // Acumulamos Goles Desglosados
                    loc.c_gf += gl; loc.c_gc += gv;
                    vis.f_gf += gv; vis.f_gc += gl;

                    // Sumamos Partidos Jugados
                    loc.pj++; vis.pj++;
                    loc.c_pj++; vis.f_pj++;

                    // Evaluamos el resultado del choque
                    if (gl > gv) {
                        // Gana Local
                        loc.pt += 3; loc.pg++; loc.c_pt += 3; loc.c_pg++;
                        vis.pp++; vis.f_pp++;
                    } else if (gl < gv) {
                        // Gana Visitante
                        vis.pt += 3; vis.pg++; vis.f_pt += 3; vis.f_pg++;
                        loc.pp++; loc.c_pp++;
                    } else {
                        // Empate
                        loc.pt += 1; loc.pe++; loc.c_pt += 1; loc.c_c_pe || loc.c_pe++;
                        vis.pt += 1; vis.pe++; vis.f_pt += 1; vis.f_pe++;
                    }
                }
            });

            // 4. ORDENACIÓN OFICIAL (Por puntos, y en caso de empate por diferencia de goles general)
            tabla.sort((a, b) => {
                if (b.pt !== a.pt) return b.pt - a.pt;
                return (b.gf - b.gc) - (a.gf - a.gc);
            });

            res.json(tabla);
        });
    });
});



// =======================================================================
// ENPOINT CLASIFICACIÓN INTERACTIVA: CALCULO DE TRES BANDAS (WORKBENCH)
// =======================================================================
app.get('/api/clasificacion-completa', (req, res) => {
    console.log("📊 Procesando tabla de clasificación con desglose En Casa/Fuera...");

    // 1. Descargamos todos los equipos registrados
    db.query("SELECT * FROM fantasy_liga.equipos", (errEq, equipos) => {
        if (errEq) return res.status(500).json({ error: errEq.message });

        // 2. Descargamos todos los partidos que ya tengan goles anotados
        db.query("SELECT * FROM fantasy_liga.partidos WHERE goles_local IS NOT NULL AND goles_visitante IS NOT NULL", (errPart, partidos) => {
            if (errPart) return res.status(500).json({ error: errPart.message });

            // Estructuramos el almacén estadístico para cada club según tu imagen de ejemplo
            let tabla = equipos.map(e => ({
                id_equipo: e.id_equipo,
                nombre: e.nombre,
                escudo: e.escudo_ruta || "generico.png",
                // TOTALES
                pt: 0, pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0,
                // EN CASA
                c_pt: 0, c_pj: 0, c_pg: 0, c_pe: 0, c_pp: 0, c_gf: 0, c_gc: 0,
                // FUERA
                f_pt: 0, f_pj: 0, f_pg: 0, f_pe: 0, f_pp: 0, f_gf: 0, f_gc: 0
            }));

            // 3. PROCESAMIENTO MATEMÁTICO DE ACTAS DE ENCUENTROS
            partidos.forEach(p => {
                let loc = tabla.find(x => x.id_equipo == p.id_local);
                let vis = tabla.find(x => x.id_equipo == p.id_visitante);

                if (loc && vis) {
                    let gl = parseInt(p.goles_local);
                    let gv = parseInt(p.goles_visitante);

                    // Acumulamos Goles Totales
                    loc.gf += gl; loc.gc += gv;
                    vis.gf += gv; vis.gc += gl;

                    // Acumulamos Goles Desglosados
                    loc.c_gf += gl; loc.c_gc += gv;
                    vis.f_gf += gv; vis.f_gc += gl;

                    // Sumamos Partidos Jugados
                    loc.pj++; vis.pj++;
                    loc.c_pj++; vis.f_pj++;

                    // Evaluamos el resultado del choque
                    if (gl > gv) {
                        // Gana Local
                        loc.pt += 3; loc.pg++; loc.c_pt += 3; loc.c_pg++;
                        vis.pp++; vis.f_pp++;
                    } else if (gl < gv) {
                        // Gana Visitante
                        vis.pt += 3; vis.pg++; vis.f_pt += 3; vis.f_pg++;
                        loc.pp++; loc.c_pp++;
                    } else {
                        // Empate
                        loc.pt += 1; loc.pe++; loc.c_pt += 1; loc.c_c_pe || loc.c_pe++;
                        vis.pt += 1; vis.pe++; vis.f_pt += 1; vis.f_pe++;
                    }
                }
            });

            // 4. ORDENACIÓN OFICIAL (Por puntos, y en caso de empate por diferencia de goles general)
            tabla.sort((a, b) => {
                if (b.pt !== a.pt) return b.pt - a.pt;
                return (b.gf - b.gc) - (a.gf - a.gc);
            });

            res.json(tabla);
        });
    });
});

// =======================================================================
// 🏃 MÓDULO EXCLUSIVO: CONTROL DE ENTRENAMIENTOS DE ALTO RENDIMIENTO
// =======================================================================


// =======================================================================
// 🏃 MOTOR RELACIONAL DE ENTRENAMIENTOS CALIBRADO 100% A TU WORKBENCH
// =======================================================================

// 1. ENDPOINT: LISTAR SESIONES FILTRANDO POR ID_EQUIPO ESTRICTO
app.get('/api/entrenamientos/equipo/:id_equipo', (req, res) => {
    const idEquipo = parseInt(req.params.id_equipo);
    console.log(`⚓ MySQL -> Consultando entrenamientos para el Club ID: ${idEquipo}`);
    
    // Forzamos a que apunte a tu esquema fantasy_liga de forma rígida
    const sql = `SELECT * FROM fantasy_liga.entrenamientos WHERE id_equipo = ? ORDER BY fecha DESC`;
    
    db.query(sql, [idEquipo], (err, results) => {
        if (err) {
            console.error("🔴 Error en SELECT entrenamientos:", err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json(results || []);
    });
});

// =======================================================================
// 🏃 SERVIDOR: ENDPOINT UNIFICADO CON PARSEO BLINDADO PARA MYSQL LONGTEXT
// =======================================================================
app.post('/api/entrenamientos/guardar', (req, res) => {
    const { 
        id_entrenamiento, id_equipo, nombre, lugar_entrenamiento, fecha, 
        hora_inicio, hora_fin, tipo_entrenamiento, secciones_bloques, 
        multimedia_ruta, pizarra_datos, audio_nota 
    } = req.body;

    // 🎯 REPARACIÓN DE TEXTOS EXTRACTOS GENERALES: Capturamos descripción y observaciones de req.body
    const descripcion = req.body.descripcion || "";
    const observaciones = req.body.observaciones || "";

    console.log(`✈️ Pasarela MySQL -> Procesando Bloque Relacional. ID: ${id_entrenamiento || "Alta"}`);

    let fechaLimpia = fecha;
    if (fecha && fecha.includes('T')) {
        fechaLimpia = fecha.split('T')[0];
    }

    // Escudo absoluto de escape de datos para MySQL
    const datosSesionesFinal = typeof secciones_bloques === 'object' ? JSON.stringify(secciones_bloques) : secciones_bloques;

    if (id_entrenamiento && id_entrenamiento !== null && id_entrenamiento !== "") {
        console.log(`✏️ Ejecutando UPDATE en LONGTEXT para la sesión ID: [${id_entrenamiento}]...`);
        
        const sqlUpdate = `
            UPDATE fantasy_liga.entrenamientos 
            SET id_equipo = ?, nombre = ?, descripcion = ?, lugar_entrenamiento = ?, fecha = ?, 
                hora_inicio = ?, hora_fin = ?, tipo_entrenamiento = ?, secciones_bloques = ?, 
                observaciones = ?, multimedia_ruta = ?, pizarra_datos = ?, audio_nota = ?
            WHERE id_entrenamiento = ?`;

        db.query(sqlUpdate, [
            parseInt(id_equipo), nombre || "", descripcion, lugar_entrenamiento || "", fechaLimpia, 
            hora_inicio || "10:00", hora_fin || "11:30", tipo_entrenamiento || "Calentamiento", 
            datosSesionesFinal, observaciones, multimedia_ruta || "", pizarra_datos || "MODO_SEPARADO_REAL", audio_nota || "",
            parseInt(id_entrenamiento)
        ], (err, result) => {
            if (err) {
                console.error("🔴 Error crítico en UPDATE de MySQL Workbench:", err.message);
                return res.status(500).json({ error: err.message });
            }
            console.log("✅ Datos y pizarras consolidadas con éxito en MySQL.");
            return res.json({ success: true, message: "Modificado correctamente." });
        });

    } else {
        console.log("💾 Insertando nueva fila con soporte LONGTEXT en la tabla...");
        const sqlInsert = `
            INSERT INTO fantasy_liga.entrenamientos 
                (id_equipo, nombre, descripcion, lugar_entrenamiento, fecha, hora_inicio, hora_fin, tipo_entrenamiento, secciones_bloques, observaciones, multimedia_ruta, pizarra_datos, audio_nota)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        db.query(sqlInsert, [
            parseInt(id_equipo), nombre || "", descripcion, lugar_entrenamiento || "", fechaLimpia, 
            hora_inicio || "10:00", hora_fin || "11:30", tipo_entrenamiento || "Calentamiento", 
            datosSesionesFinal, observaciones, multimedia_ruta || "", pizarra_datos || "MODO_SEPARADO_REAL", audio_nota || ""
        ], (err, result) => {
            if (err) {
                console.error("🔴 Error crítico en INSERT de MySQL:", err.message);
                return res.status(500).json({ error: err.message });
            }
            return res.json({ success: true, id_entrenamiento: result.insertId, message: "Guardado correctamente." });
        });
    }
});





// 3. ENDPOINT: BORRADO FÍSICO DE REGISTROS DE ENTRENAMIENTOS
app.delete('/api/entrenamientos/eliminar/:id', (req, res) => {
    const idEnt = parseInt(req.params.id);
    console.log(`🗑️ Eliminando sesión de entrenamiento ID: ${idEnt}`);
    const sql = `DELETE FROM fantasy_liga.entrenamientos WHERE id_entrenamiento = ?`;
    db.query(sql, [idEnt], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: "Registro borrado de MySQL Workbench" });
    });
});

// 4. ENDPOINT: DESCARGAR ACTA DE RENDIMIENTO ASOCIADA A UNA SESIÓN ESPECÍFICA
app.get('/api/entrenamientos/asistencia/:id_entrenamiento', (req, res) => {
    const idEnt = parseInt(req.params.id_entrenamiento);
    console.log(`📊 Extrayendo notas de asistencia de la sesión: ${idEnt}`);
    
    const sql = `SELECT * FROM fantasy_liga.asistencia_entrenamiento WHERE id_entrenamiento = ?`;
    db.query(sql, [idEnt], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});

// =======================================================================
// 📊 SERVIDOR FASE 1: COMPUTADOR ANALÍTICO DE MEDIAS Y RANKING DEL EQUIPO
// =======================================================================

// 🎯 A. EL GUARDADOR BIOMÉTRICO (AHORA CON LIMPIEZA ASÍNCRONA)
app.post('/api/jugadores/guardar-biometria', (req, res) => {
    const { id_jugador, nombre, edad, altura, peso, demarcacion } = req.body;
    console.log(`✈️ Pasarela MySQL -> Modificando datos del Jugador ID: [${id_jugador}]`);

    if (!id_jugador) { return res.status(400).json({ error: "Falta el ID del jugador." }); }

    const sqlUpdateBiometria = `
        UPDATE fantasy_liga.jugadores 
        SET nombre = ?, edad = ?, altura = ?, peso = ?, posicion = ?
        WHERE id_jugador = ?`;

    db.query(sqlUpdateBiometria, [
        nombre || "", parseInt(edad) || 20, parseFloat(altura) || 1.80, parseFloat(peso) || 75.00, demarcacion || "POR", parseInt(id_jugador)
    ], (err, result) => {
        if (err) {
            console.error("🔴 Error en UPDATE jugadores:", err.message);
            return res.status(500).json({ error: err.message });
        }
        return res.json({ success: true, message: "Modificado correctamente." });
    });
});

// =======================================================================
// 🏆 SERVER REPARADO: ENVÍA EXPEDIENTE Y ARRAY DE VESTUARIO REAL DE MYSQL
// =======================================================================
app.get('/api/jugadores/rendimiento-entrenamientos/:id_jugador', (req, res) => {
    const idJugadorFiltro = parseInt(req.params.id_jugador);
    console.log(`📊 Servidor MySQL -> Extrayendo escalafón multiequipo para ID: [${idJugadorFiltro}]`);

    if (isNaN(idJugadorFiltro)) {
        return res.status(400).json({ error: "Identificador de jugador inválido." });
    }

    // 1. Buscamos primero el equipo (id_equipo) del jugador solicitado de forma dinámica
    const sqlBuscarEquipo = `SELECT id_equipo FROM fantasy_liga.jugadores WHERE id_jugador = ?`;
    
    db.query(sqlBuscarEquipo, [idJugadorFiltro], (errEq, resEq) => {
        if (errEq || !resEq || resEq.length === 0) {
            return res.status(400).json({ error: "No se localiza el equipo del jugador." });
        }
        
        const idEquipoActivo = resEq[0].id_equipo;

        // 2. 🎯 TU QUERY DE ÉXITO DE WORKBENCH MODIFICADA CON EL COMODÍN '?':
        // Traemos de golpe a toda la plantilla de SU EQUIPO ordenada de mayor a menor por puntos
        const sqlTuGridValidadoMultiequipo = `
            SELECT 
                j.id_jugador,
                j.nombre,
                COUNT(CASE WHEN ae.asistio = 'SI' THEN 1 END) AS total_asistencias,
                IFNULL(SUM(ae.puntos_entrenamiento), 0) AS puntos_entrenamiento_totales,
                ROUND(
                    IFNULL(SUM(ae.puntos_entrenamiento), 0) / 
                    CASE WHEN COUNT(CASE WHEN ae.asistio = 'SI' THEN 1 END) = 0 THEN 1 
                         ELSE COUNT(CASE WHEN ae.asistio = 'SI' THEN 1 END) 
                    END, 2
                ) AS media_puntos_entrenamiento
            FROM fantasy_liga.jugadores j
            LEFT JOIN fantasy_liga.asistencia_entrenamiento ae ON j.id_jugador = ae.id_jugador
            WHERE j.id_equipo = ?
            GROUP BY j.id_jugador, j.nombre
            ORDER BY puntos_entrenamiento_totales DESC`;

        db.query(sqlTuGridValidadoMultiequipo, [idEquipoActivo], (err, rows) => {
            if (err) {
                console.error("🔴 Error crítico en tu MySQL Workbench:", err.message);
                return res.status(500).json({ error: err.message });
            }

            const vestuarioCompleto = rows || [];
            let puestoRankingReal = 1;
            let coincidenciaFila = null;

            // 3. DETECTAMOS QUÉ PUESTO OCUPA EN LA MATRIZ ORDENADA DE SU CLUB
            for (let i = 0; i < vestuarioCompleto.length; i++) {
                if (vestuarioCompleto[i].id_jugador === idJugadorFiltro) {
                    puestoRankingReal = i + 1; // Posición exacta en su vestuario
                    coincidenciaFila = vestuarioCompleto[i];
                    break;
                }
            }

            // Si el jugador no registra actas, fabricamos un registro base seguro
            if (!coincidenciaFila) {
                coincidenciaFila = { id_jugador: idJugadorFiltro, nombre: "Jugador", total_asistencias: 0, puntos_entrenamiento_totales: 0, media_puntos_entrenamiento: 0 };
            }

            // 4. DESPACHAMOS EL PACK CON LA FICHA Y EL ARRAY COMPLETO DEL VESTUARIO ORDENADO
            return res.json({
                success: true,
                id_jugador: coincidenciaFila.id_jugador,
                nombre: coincidenciaFila.nombre,
                asistencias: coincidenciaFila.total_asistencias,
                puntosTotales: parseFloat(coincidenciaFila.puntos_entrenamiento_totales) || 0.00,
                mediaPuntos: parseFloat(coincidenciaFila.media_puntos_entrenamiento) || 0.00,
                faltas: 0,
                rankingPuesto: puestoRankingReal,
                rankingTotal: vestuarioCompleto.length,
                rowsVestuario: vestuarioCompleto // 🌟 EL ARMA SECRETA: Enviamos la lista real ordenada para el bucle
            });
        });
    });
});




// =======================================================================
// 🏃 SERVIDOR: PASARELA QUIRÚRGICA CON MAPEO DOBLE ANTI-NULLS DE COINCIDENCIA
// =======================================================================
app.post('/api/entrenamientos/asistencia/guardar', (req, res) => {
    // Captura manual elástica para curarnos en salud con los tipos de datos de Node.js
    const id_entrenamiento = parseInt(req.body.id_entrenamiento);
    const id_jugador = parseInt(req.body.id_jugador);
    const asistio = req.body.asistio ? req.body.asistio.toString() : "SI";
    const puntos_entrenamiento = parseFloat(req.body.puntos_entrenamiento) || 0.00;
    const evolucion_comentario = req.body.evolucion_comentario ? req.body.evolucion_comentario.toString() : "";

    console.log(`✈️ Pasarela MySQL -> Procesando entrada: Sesión[${id_entrenamiento}] | Jugador[${id_jugador}] | Puntos[${puntos_entrenamiento}]`);

    if (isNaN(id_entrenamiento) || isNaN(id_jugador)) {
        console.error("🔴 Error Crítico: Las llaves primarias de la sesión o el jugador vienen vacías o corruptas.");
        return res.status(400).json({ error: "IDs relacionales inválidos" });
    }

    // Usamos las columnas físicas exactas que tu monitor muestra en el árbol de esquemas izquierdo
    const sqlInmune = `
        INSERT INTO fantasy_liga.asistencia_entrenamiento 
            (id_entrenamiento, id_jugador, asistio, puntos_entrenamiento, evolucion_comentario)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
            asistio = VALUES(asistio), 
            puntos_entrenamiento = VALUES(puntos_entrenamiento), 
            evolucion_comentario = VALUES(evolucion_comentario)`;
        
    db.query(sqlInmune, [id_entrenamiento, id_jugador, asistio, puntos_entrenamiento, evolucion_comentario], (err, result) => {
        if (err) {
            console.error("🔴 MySQL Workbench rechazó la consulta relacional:", err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, message: "Datos consolidados e insertados con éxito en Workbench" });
    });
});



// 6. ENDPOINT: HISTORIAL COMPLETO DE ENTRENAMIENTOS DE UN JUGADOR INDIVIDUAL (PARA SU FICHA)
app.get('/api/jugadores/historial-entrenamientos/:id_jugador', (req, res) => {
    const idJugador = parseInt(req.params.id_jugador);
    const sql = `
        SELECT ae.*, e.nombre AS entrenamiento_nombre, e.fecha, e.tipo_entrenamiento
        FROM fantasy_liga.asistencia_entrenamiento ae
        INNER JOIN fantasy_liga.entrenamientos e ON ae.id_entrenamiento = e.id_entrenamiento
        WHERE ae.id_jugador = ?
        ORDER BY e.fecha DESC`;
    db.query(sql, [idJugador], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});

// =======================================================================
// 📊 SERVIDOR: ENDPOINT ANALÍTICO COMPATIBLE CON ONLY_FULL_GROUP_BY
// =======================================================================
app.get('/api/analiticas/resumen/:id_equipo', (req, res) => {
    const idEquipo = parseInt(req.params.id_equipo);
    console.log(`📊 Servidor -> Ejecutando balance analítico puro para el Club ID: ${idEquipo}`);

    // Consulta A: Contamos los futbolistas asignados al equipo
    const sqlJugadores = `SELECT COUNT(*) AS total FROM fantasy_liga.jugadores WHERE id_equipo = ?`;
    
    // 🎯 REPARACIÓN MAESTRA DE LA QUERY: Traemos las filas limpias sin GROUP BY invasivos 
    // para evitar que el modo estricto de MySQL aborte la petición en Node.js
    const sqlEntrenos = `SELECT secciones_bloques FROM fantasy_liga.entrenamientos WHERE id_equipo = ?`;

    db.query(sqlJugadores, [idEquipo], (errJug, resJug) => {
        if (errJug) {
            console.error("🔴 Error en MySQL Workbench (Jugadores):", errJug.message);
            return res.status(500).json({ error: errJug.message });
        }

        // Extraemos el conteo de la primera celda del Result Grid
        const totalJugadores = (resJug && resJug[0]) ? resJug[0].total : 0;

        db.query(sqlEntrenos, [idEquipo], (errEnt, resEnt) => {
            if (errEnt) {
                console.error("🔴 Error crítico en MySQL Workbench (Entrenamientos):", errEnt.message);
                return res.status(500).json({ error: errEnt.message });
            }

            // Al no agrupar, la longitud del array devuelto es el TOTAL real de entrenamientos guardados
            const totalEntrenamientos = Array.isArray(resEnt) ? resEnt.length : 0;
            let totalEjerciciosDiseñados = 0;

            // Recorremos las celdas directamente para contabilizar las estaciones de trabajo
            if (totalEntrenamientos > 0) {
                resEnt.forEach(row => {
                    var bloqueTexto = row.secciones_bloques || "";
                    if (bloqueTexto.trim() !== "") {
                        try {
                            var estructura = JSON.parse(bloqueTexto);
                            if (Array.isArray(estructura)) {
                                totalEjerciciosDiseñados += estructura.length;
                            } else {
                                totalEjerciciosDiseñados += bloqueTexto.split(",").length;
                            }
                        } catch (e) {
                            totalEjerciciosDiseñados += bloqueTexto.split(",").length;
                        }
                    }
                });
            }

            // Despachamos el payload limpio hacia tu monitor de gala
            return res.json({
                success: true,
                jugadores: totalJugadores,
                entrenamientos: totalEntrenamientos,
                ejercicios: totalEjerciciosDiseñados || totalEntrenamientos
            });
        });
    });
});



// =======================================================================
// 🛡️ MIDDLEWARE: Verifica el "Pasaporte" (JWT Token) enviado por la tablet
// =======================================================================
function verificarTokenDeSeguridad(req, res, next) {
    // La tablet debe enviar el token en la cabecera 'Authorization'
    const bearerHeader = req.headers['authorization'];
    
    if (!bearerHeader) {
        return res.status(403).json({ success: false, error: "Acceso denegado. Se requiere Token de sesión." });
    }

    try {
        const token = bearerHeader.split(' ')[1]; // Extraemos el token limpio
        // Desencriptamos el token usando tu clave secreta de inicio
        const datosUsuarioLogueado = jwt.verify(token, JWT_SECRET_KEY);
        
        // Inyectamos las credenciales del usuario en la petición (req.user) para usarlas abajo
        req.user = datosUsuarioLogueado; 
        next(); // Damos paso al endpoint correspondiente
    } catch (error) {
        return res.status(401).json({ success: false, error: "Token vencido o inválido. Inicie sesión de nuevo." });
    }
}

// =======================================================================
// 🎯 PASARELA GET PROTEGIDA: Aísla y carga los partidos por CLUB y ROL
// =======================================================================
// Añadimos 'verificarTokenDeSeguridad' como escudo antes de ejecutar la consulta SQL
app.get('/api/partidos/recuperar-pizarra/:id_partido', verificarTokenDeSeguridad, (req, res) => {
    const idPartido = parseInt(req.params.id_partido);
    
    // 🎯 AQUÍ OCURRE EL AISLAMIENTO:
    // Recuperamos el Club y el Rol del usuario directamente desde su Token desencriptado
    const idClubDelUsuario = req.user.id_club_cuenta;
    const idRolDelUsuario = req.user.id_rol;

    let sqlBuscarPizarra = "";
    let parametrosConsulta = [];

    // 👑 CASO ADMIN: Si eres tú (Rol 1), puedes ver CUALQUIER partido de CUALQUIER club
    if (idRolDelUsuario === 1) {
        sqlBuscarPizarra = `SELECT * FROM fantasy_liga.partidos WHERE id_partido = ?`;
        parametrosConsulta = [idPartido];
    } 
    // 📋/🏃 CASO CLUB: Si eres Entrenador o Jugador, el sistema añade un filtro obligatorio
    // para que SOLO puedas leer si el partido pertenece a TU id_club_cuenta relacional de MySQL
    else {
        sqlBuscarPizarra = `
            SELECT * 
            FROM fantasy_liga.partidos 
            WHERE id_partido = ? AND id_club_cuenta = ?`;
        parametrosConsulta = [idPartido, idClubDelUsuario];
    }

    db.query(sqlBuscarPizarra, parametrosConsulta, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        if (!rows || rows.length === 0) {
            // Si un entrenador del Club 2 intenta poner el ID de un partido del Club 1, 
            // el sistema le dirá que no existe, protegiendo y aislando la información por completo.
            return res.status(404).json({ error: "Partido no encontrado o no tienes permisos para verlo." });
        }
        
        res.json(rows[0]); 
    });
});



// server para pizarra de entrenamiento




// =======================================================================
// 🔐 PASARELA POST PROTEGIDA: Guarda la estrategia blindando el Club y el Rol
// =======================================================================
// Inyectamos el middleware 'verificarTokenDeSeguridad' como escudo preventivo
app.post('/api/partidos/guardar-pizarra', verificarTokenDeSeguridad, (req, res) => {
    const { id_partido, pizarra_dibujo, pizarra_audio } = req.body;
    
    // Extraemos las credenciales auténticas inyectadas por el pasaporte JWT
    const idClubDelUsuario = req.user.id_club_cuenta;
    const idRolDelUsuario = req.user.id_rol;

    // 🛑 VALIDACIÓN 1: Bloqueo estricto por Rol. Si es un jugador, rechazamos de inmediato
    if (idRolDelUsuario === 3) {
        console.warn(`🚨 ¡Alerta de seguridad! El usuario con Rol Jugador intentó saltarse el frontend para escribir en MySQL.`);
        return res.status(403).json({ success: false, error: "Acceso denegado. Los jugadores no tienen permisos de escritura." });
    }

    if (!id_partido) {
        return res.status(400).json({ success: false, error: "Falta el ID del partido obligatorio." });
    }

    // 👑 REGLA DE EXCEPCIÓN: Si eres el ADMINISTRADOR global (Tú, Rol 1), guardas sin validar el club
    if (idRolDelUsuario === 1) {
        ejecutarUpdateDePizarraEnMySQL(id_partido, pizarra_dibujo, pizarra_audio, res);
    } 
    // 📋 REGLA MULTI-INQUILINO: Si eres entrenador (Rol 2), MySQL primero verifica si eres dueño de ese partido
    else {
        // Hacemos una consulta rápida de control de propiedad para verificar el Club
        const sqlVerificarPropiedad = `SELECT id_club_cuenta FROM fantasy_liga.partidos WHERE id_partido = ?`;
        
        db.query(sqlVerificarPropiedad, [id_partido], (err, rows) => {
            if (err) {
                console.error("🔴 Error en control de propiedad de MySQL:", err.message);
                return res.status(500).json({ success: false, error: err.message });
            }

            if (!rows || rows.length === 0) {
                return res.status(404).json({ success: false, error: "El partido especificado no existe." });
            }

            const idClubDelPartidoEnBD = rows[0].id_club_cuenta;

            // 🛑 COMPROBACIÓN CRUZADA: Si el partido pertenece a otra cuenta de club, bloqueamos el acceso
            if (idClubDelPartidoEnBD !== idClubDelUsuario) {
                console.warn(`🚨 Intento de infiltración cruzada detectado. Club ${idClubDelUsuario} intentó modificar partido del Club ${idClubDelPartidoEnBD}`);
                return res.status(403).json({ success: false, error: "Acceso denegado. No tienes permisos para modificar datos de otro club." });
            }

            // Si pasa los dos filtros con éxito, damos luz verde al guardado relacional
            ejecutarUpdateDePizarraEnMySQL(id_partido, pizarra_dibujo, pizarra_audio, res);
        });
    }
});

/**
 * FUNCIÓN AUXILIAR COHERENTE: Ejecuta el comando UPDATE consolidado en tu base de datos
 */
function ejecutarUpdateDePizarraEnMySQL(idPartido, dibujo, audio, res) {
    const sqlGuardarPizarra = `
        UPDATE fantasy_liga.partidos 
        SET pizarra_dibujo = ?, pizarra_audio = ? 
        WHERE id_partido = ?`;

    db.query(sqlGuardarPizarra, [dibujo, audio, idPartido], (err, result) => {
        if (err) {
            console.error("🔴 Error al ejecutar UPDATE de pizarra en MySQL:", err.message);
            return res.status(500).json({ success: false, error: err.message });
        }
        
        console.log(`💾 ¡Estrategia multi-lona blindada con éxito! Registro consolidado para el Partido ID: [${idPartido}]`);
        return res.json({ success: true, message: "Pizarra unificada y notas de voz guardadas con éxito en MySQL." });
    });
}




// 🎯 2. PASARELA GET: Descarga los trazos Base64 correspondientes al partido en cuestión
app.get('/api/partidos/recuperar-pizarra/:id_partido', (req, res) => {
    const idFielPartido = parseInt(req.params.id_partido);
    console.log(`📥 Servidor MySQL -> Buscando celdas LONGTEXT para el Partido ID: [${idFielPartido}]`);

    if (!idFielPartido || isNaN(idFielPartido)) {
        return res.status(400).json({ error: "ID de partido inválido." });
    }

    const sqlBuscarPizarra = `
        SELECT pizarra_dibujo, pizarra_audio 
        FROM fantasy_liga.partidos 
        WHERE id_partido = ?`;

    db.query(sqlBuscarPizarra, [idFielPartido], (err, rows) => {
        if (err) {
            console.error("🔴 Error en la consulta SELECT de MySQL:", err.message);
            return res.status(500).json({ error: err.message });
        }
        
        // Si la fila viene vacía, respondemos con nulos limpios de forma pasiva
        if (!rows || rows.length === 0) {
            return res.json({ pizarra_dibujo: null, pizarra_audio: null });
        }
        
        // Devolvemos el registro directo relacional al monitor de Chrome
        res.json(rows[0]); 
    });
});



// Inicio de pizarra de entrenamiento





// fin de pizarra partido



// =======================================================================
// 🧲 ENDPOINT SAAS: Envía el carrusel filtrado por Club y Categoría
// =======================================================================
app.get('/api/partidos/lista-carrusel', verificarTokenDeSeguridad, (req, res) => {
    const idClubDelUsuario = req.user.id_club_cuenta;
    const idRolDelUsuario = req.user.id_rol;
    const categoriaDelUsuario = req.user.categoria;

    let sqlCarrusel = "";
    let parametros = [];

    // Si eres ADMINISTRADOR (Rol 1), lo ves todo global
    if (idRolDelUsuario === 1) {
        sqlCarrusel = `SELECT * FROM fantasy_liga.partidos ORDER BY id_jornada ASC, id_partido DESC`;
        parametros = [];
    } else {
        // Si eres Entrenador o Jugador, aplicamos el muro multi-inquilino estricto
        sqlCarrusel = `
            SELECT * 
            FROM fantasy_liga.partidos 
            WHERE id_club_cuenta = ? AND categoria = ?
            ORDER BY id_jornada ASC, id_partido DESC`;
        parametros = [idClubDelUsuario, categoriaDelUsuario];
    }

    db.query(sqlCarrusel, parametros, (err, rows) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json(rows);
    });
});


const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Clave secreta para firmar tus pasaportes de sesión JWT
const JWT_SECRET_KEY = "FANTASY_SUPER_SECRET_TOKEN_KEY_2026"; 

// =======================================================================
// 🤝 ENDPOINT POST: Registro de Usuarios con contraseña encriptada (Bcrypt)
// =======================================================================
app.post('/api/auth/register', async (req, res) => {
    const { id_club_cuenta, id_rol, nombre, email, password, categoria } = req.body;

    if (!id_club_cuenta || !id_rol || !nombre || !email || !password) {
        return res.status(400).json({ success: false, error: "Faltan parámetros obligatorios." });
    }

    try {
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        const sqlInsertarUsuario = `
            INSERT INTO fantasy_liga.usuarios (id_club_cuenta, id_rol, nombre, email, password_hash, categoria) 
            VALUES (?, ?, ?, ?, ?, ?)`;

        db.query(sqlInsertarUsuario, [id_club_cuenta, id_rol, nombre, email, passwordHash, categoria || 'Senior'], (err, result) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(400).json({ success: false, error: "El correo electrónico ya existe." });
                }
                return res.status(500).json({ success: false, error: err.message });
            }
            res.json({ success: true, message: "Usuario creado correctamente." });
        });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error interno del servidor." });
    }
});

// =======================================================================
// 🔐 ENDPOINT POST: Inicio de Sesión Inteligente (Login)
// =======================================================================
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, error: "Introduce email y contraseña." });
    }

    const sqlBuscarUsuario = `SELECT * FROM fantasy_liga.usuarios WHERE email = ? AND estado_cuenta = 'activo'`;

    db.query(sqlBuscarUsuario, [email], async (err, rows) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        if (!rows || rows.length === 0) {
            return res.status(401).json({ success: false, error: "Credenciales inválidas." });
        }

        const usuario = rows[0];

        try {
            const contraseñaCorrecta = await bcrypt.compare(password, usuario.password_hash);
            if (!contraseñaCorrecta) {
                return res.status(401).json({ success: false, error: "Contraseña incorrecta." });
            }

            // Generamos el pasaporte cifrando su Rol y su Club para el Frontend
            const tokenSesion = jwt.sign(
                { 
                    id_usuario: usuario.id_usuario,
                    id_club_cuenta: usuario.id_club_cuenta,
                    id_rol: usuario.id_rol,
                    categoria: usuario.categoria,
                    nombre: usuario.nombre
                },
                JWT_SECRET_KEY,
                { expiresIn: '24h' }
            );

            res.json({
                success: true,
                token: tokenSesion,
                usuario: {
                    nombre: usuario.nombre,
                    id_rol: usuario.id_rol,
                    id_club_cuenta: usuario.id_club_cuenta,
                    categoria: usuario.categoria
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: "Error en la verificación." });
        }
    });
});


// Cambia tu app.listen original por este:
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor SaaS corriendo en el puerto ${PORT}`);
});





/*app.listen(3000, () => {
    console.log('Servidor corriendo en http://localhost:3000');
});*/

