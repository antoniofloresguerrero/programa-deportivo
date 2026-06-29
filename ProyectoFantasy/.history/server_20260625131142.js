const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// CONTROL DE CONEXIÓN SEGURA A MYSQL WORKBENCH
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'tu_contraseña', // Pon aquí la contraseña real de tu MySQL Workbench
    database: 'fantasy_liga'
});

db.connect(function(err) {
    if (err) {
        console.error('Error crítico al conectar a MySQL Workbench:', err);
        return;
    }
    console.log('¡Conectado con éxito a MySQL Workbench (fantasy_liga)!');
});

// 1. OBTENER JORNADAS CON VALIDACIÓN DE VACÍO
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

// 4. REGISTRAR PARTIDO EN ACTA CLONANDO PLANTILLAS REALES
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

// 5. OBTENER DETALLE DEL ACTA DEL ENCUENTRO
app.get('/api/acta/:id_partido', (req, res) => {
    const query = 'SELECT a.*, j.nombre, j.posicion, j.id_equipo FROM acta_partido a JOIN jugadores j ON a.id_jugador = j.id_jugador WHERE a.id_partido = ?';
    db.query(query, [req.params.id_partido], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});

// 6. ACTUALIZAR ACTA, GOLES Y NOMBRE SIN ACCIDENTES
app.post('/api/acta/guardar', (req, res) => {
    const { id_partido, id_acta, id_jugador, nuevo_nombre, goles_local, goles_visitante, rol, puntos, evento, cambio } = req.body;
    
    db.query('UPDATE partidos SET goles_local = ?, goles_visitante = ? WHERE id_partido = ?', [goles_local, goles_visitante, id_partido], (err) => {
        if (err) console.error("Error goles:", err);
    });

    db.query('UPDATE jugadores SET nombre = ? WHERE id_jugador = ?', [nuevo_nombre, id_jugador], (err) => {
        if (err) console.error("Error nombre:", err);
    });
    
    const queryActa = 'UPDATE acta_partido SET rol = ?, puntos = ?, evento = ?, cambio = ? WHERE id_acta = ?';
    db.query(queryActa, [rol, puntos, evento, cambio, id_acta], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ estatus: "OK", mensaje: "Acta guardada con éxito en MySQL Workbench" });
    });
});

app.listen(3000, () => {
    console.log('Servidor corriendo en http://localhost:3000');
});

