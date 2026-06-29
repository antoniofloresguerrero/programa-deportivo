const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

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

// 5. OBTENER DETALLE DEL ACTA INCLUYENDO COORDENADAS PERSONALIZADAS X,Y
app.get('/api/acta/:id_partido', (req, res) => {
    const query = `
        SELECT a.*, j.nombre, j.posicion, j.id_equipo, j.foto_ruta 
        FROM acta_partido a 
        JOIN jugadores j ON a.id_jugador = j.id_jugador 
        WHERE a.id_partido = ?`;
    db.query(query, [req.params.id_partido], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});


// 6. GUARDAR ESTADÍSTICAS Y CALCULAR EL VALOR TOTAL DEL PARTIDO
app.post('/api/acta/guardar', (req, res) => {
    const { 
        id_partido, id_acta, id_jugador, nuevo_nombre, 
        goles_local, goles_visitante, rol, puntos, evento, cambio,
        posicion_x, posicion_y 
    } = req.body;

    // ALGORITMO FANTASY: Calcular puntos extra según los goles del formulario
    let puntosGolesExtra = 0;
    if (evento === "⚽") puntosGolesExtra = 2;
    else if (evento === "⚽⚽" || evento === "⚽⚽⚽") puntosGolesExtra = 3;

    // Suma definitiva: Nota base manual + Bonus de goles
    const puntosTotalesPartido = (puntos !== null) ? (parseInt(puntos) + puntosGolesExtra) : null;

    // 1. Guardar goles del encuentro
    db.query('UPDATE partidos SET goles_local = ?, goles_visitante = ? WHERE id_partido = ?', [goles_local, goles_visitante, id_partido]);

    // 2. Guardar nombre del futbolista
    db.query('UPDATE jugadores SET nombre = ? WHERE id_jugador = ?', [nuevo_nombre, id_jugador]);
    
    // 3. Guardar en acta_partido inyectando los puntos totales calculados en la columna 'puntos'
    const queryActa = `
        UPDATE acta_partido 
        SET rol = ?, puntos = ?, evento = ?, cambio = ?, posicion_x = ?, posicion_y = ? 
        WHERE id_acta = ?`;
        
    db.query(queryActa, [rol, puntosTotalesPartido, evento, cambio, posicion_x, posicion_y, id_acta], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ estatus: "OK", mensaje: "Puntos calculados y guardados en MySQL Workbench" });
    });
});


// 7. OBTENER LISTADO COMPLETO DE EQUIPOS REGISTRADOS
app.get('/api/equipos', (req, res) => {
    db.query('SELECT * FROM equipos ORDER BY division ASC, nombre ASC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});
// 8. ALGORITMO: CALCULAR LA MEDIA DE LOS 3 ÚLTIMOS PARTIDOS Y EL VALOR TOTAL DEL EQUIPO
app.get('/api/valor-equipo/:id_partido', (req, res) => {
    const id_partido = req.params.id_partido;

    // Consulta para obtener los jugadores que están en el acta de este partido
    const queryActa = `
        SELECT a.id_jugador, a.id_acta, a.rol, j.id_equipo, j.nombre, j.posicion 
        FROM acta_partido a
        JOIN jugadores j ON a.id_jugador = j.id_jugador
        WHERE a.id_partido = ?`;

    db.query(queryActa, [id_partido], (err, jugadoresActa) => {
        if (err) return res.status(500).json({ error: err.message });
        if (jugadoresActa.length === 0) return res.json({ valor_local: 0, valor_visitante: 0, jugadores: [] });

        let promesas = [];

        // Para cada jugador, buscamos sus últimos 3 partidos guardados en MySQL Workbench
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
                        // Sumamos las puntuaciones encontradas (máximo 3)
                        let suma = historial.reduce((acc, fila) => acc + fila.puntos, 0);
                        // Dividimos por el número de partidos jugados real (hasta 3) para hallar la media
                        valorActual = parseFloat((suma / historial.length).toFixed(1));
                    }
                    
                    // Añadimos el valor calculado al objeto del jugador
                    jug.valor_actual = valorActual;
                    resolve(jug);
                });
            });
            promesas.push(p);
        });

        // Esperamos a que MySQL procese los historiales de todos los jugadores
        Promise.all(promesas).then((jugadoresConValor) => {
            // Buscamos los IDs de los equipos del partido actual para separarlos
            db.query('SELECT id_local, id_visitante FROM partidos WHERE id_partido = ?', [id_partido], (err, partidoData) => {
                if (err || partidoData.length === 0) return res.json({ error: "Partido no encontrado" });
                
                const id_l = partidoData[0].id_local;
                const id_v = partidoData[0].id_visitante;

                // Sumamos el valor actual únicamente de los jugadores que están con el CHECK marcado (rol: titular)
                let valorLocal = jugadoresConValor
                    .filter(j => j.id_equipo == id_l && j.rol === 'titular')
                    .reduce((acc, j) => acc + j.valor_actual, 0);

                let valorVisitante = jugadoresConValor
                    .filter(j => j.id_equipo == id_v && j.rol === 'titular')
                    .reduce((acc, j) => acc + j.valor_actual, 0);

                res.json({
                    valor_local: parseFloat(valorLocal.toFixed(1)),
                    valor_visitante: parseFloat(valorVisitante.toFixed(1)),
                    jugadores: jugadoresConValor
                });
            });
        });
    });
});

app.listen(3000, () => {
    console.log('Servidor corriendo en http://localhost:3000');
});

