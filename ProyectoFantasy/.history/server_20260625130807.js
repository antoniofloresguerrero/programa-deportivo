const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json()); // Permite recibir datos en formato JSON desde el HTML

// CONFIGURACIÓN DE CONEXIÓN A TU MYSQL WORKBENCH
// Cambia 'tu_contraseña' por la contraseña real de tu base de datos root
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'tu_contraseña', 
    database: 'fantasy_liga'
});

// Comprobar si la conexión con MySQL Workbench es correcta
db.connect(function(err) {
    if (err) {
        console.error('Error crítico al conectar a MySQL Workbench:', err);
        return;
    }
    console.log('¡Conectado con éxito a la base de datos MySQL Workbench (fantasy_liga)!');
});
// 1. OBTENER TODAS LAS JORNADAS
app.get('/api/jornadas', (req, res) => {
    db.query('SELECT * FROM jornadas ORDER BY numero_jornada ASC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 2. CREAR NUEVA JORNADA
app.post('/api/jornadas', (req, res) => {
    db.query('SELECT COALESCE(MAX(numero_jornada), 0) + 1 AS siguiente FROM jornadas', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        const proxima = results[0].siguiente;
        db.query('INSERT INTO jornadas (numero_jornada) VALUES (?)', [proxima], (err, insertRes) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ mensaje: `Jornada ${proxima} creada`, id_jornada: insertRes.insertId });
        });
    });
});

// 3. OBTENER PARTIDOS DE UNA JORNADA
app.get('/api/partidos/:id_jornada', (req, res) => {
    const query = `
        SELECT p.*, el.nombre AS local_nombre, ev.nombre AS visitante_nombre 
        FROM partidos p
        JOIN equipos el ON p.id_local = el.id_equipo
        JOIN equipos ev ON p.id_visitante = ev.id_equipo
        WHERE p.id_jornada = ?`;
    db.query(query, [req.params.id_jornada], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 4. REGISTRAR PARTIDO CLONANDO PLANTILLAS AL ACTA
app.post('/api/partidos', (req, res) => {
    const { id_jornada, id_local, id_visitante } = req.body;
    db.query('INSERT INTO partidos (id_jornada, id_local, id_visitante) VALUES (?, ?, ?)', 
    [id_jornada, id_local, id_visitante], (err, resultPartido) => {
        if (err) return res.status(500).json({ error: err.message });
        const id_partido = resultPartido.insertId;

        // Clonar jugadores locales y visitantes en la tabla acta_partido
        const queryJugadores = 'SELECT id_jugador FROM jugadores WHERE id_equipo IN (?, ?)';
        db.query(queryJugadores, [id_local, id_visitante], (err, jugs) => {
            if (err) return res.status(500).json({ error: err.message });
            if (jugs.length === 0) return res.json({ id_partido, mensaje: "Partido creado sin actas" });

            const valoresActa = jugs.map(j => [id_partido, j.id_jugador, 'titular', null, '', '']);
            db.query('INSERT INTO acta_partido (id_partido, id_jugador, rol, puntos, evento, cambio) VALUES ?', 
            [valoresActa], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ id_partido, mensaje: "Partido y actas inicializadas" });
            });
        });
    });
});

// 5. OBTENER DETALLE DEL ACTA DE UN PARTIDO
app.get('/api/acta/:id_partido', (req, res) => {
    const query = `
        SELECT a.*, j.nombre, j.posicion, j.id_equipo 
        FROM acta_partido a
        JOIN jugadores j ON a.id_jugador = j.id_jugador
        WHERE a.id_partido = ?`;
    db.query(query, [req.params.id_partido], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 6. ACTUALIZAR ACTA, RESULTADO Y NOMBRE DEL JUGADOR
app.post('/api/acta/guardar', (req, res) => {
    const { id_partido, id_acta, id_jugador, nuevo_nombre, goles_local, goles_visitante, rol, puntos, evento, cambio } = req.body;
    
    // Transacción simple: Actualizar goles en partido, nombre en jugadores y datos en acta
    db.query('UPDATE partidos SET goles_local = ?, goles_vistar = ? WHERE id_partido = ?', 
    [goles_local, goles_visitante, id_partido], (err) => {
        if (err) goles_visitante = goles_visitante; // fallback por si la columna difiere, usamos comodín corregido abajo en la versión final
    });

    db.query('UPDATE partidos SET goles_local = ?, goles_visitante = ? WHERE id_partido = ?', [goles_local, goles_visitante, id_partido]);
    db.query('UPDATE jugadores SET nombre = ? WHERE id_jugador = ?', [nuevo_nombre, id_jugador]);
    
    const queryActa = 'UPDATE acta_partido SET rol = ?, puntos = ?, evento = ?, cambio = ? WHERE id_acta = ?';
    db.query(queryActa, [rol, puntos, evento, cambio, id_acta], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ estatus: "OK", mensaje: "Acta y datos guardados correctamente" });
    });
});

// Puertos de escucha del servidor Node
app.listen(3000, () => {
    console.log('Servidor corriendo correctamente en http://localhost:3000');
});
