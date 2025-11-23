/**
 * MySQL Database Connection Configuration
 */

const mysql = require('mysql2/promise');

// Create MySQL connection pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || '211.37.174.218',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'Qq141171616!',
    database: process.env.DB_NAME || 'paca',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    timezone: '+09:00', // 한국 시간
    dateStrings: true // DATE 타입을 문자열로 반환
});

// Test connection on startup
pool.getConnection()
    .then(connection => {
        console.log('Database connection pool created');
        connection.release();
    })
    .catch(err => {
        console.error('Error creating database connection pool:', err.message);
    });

module.exports = pool;
