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
