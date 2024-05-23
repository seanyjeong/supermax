const express = require('express');
const mysql = require('mysql');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const https = require('https');
const helmet = require('helmet');

const app = express();
app.use(bodyParser.json());
app.use(cors());
app.use(helmet());

app.use((req, res, next) => {
    res.setHeader("Permissions-Policy", "interest-cohort=()");
    next();
});

const dbConfig = {
    host: 'my8003.gabiadb.com',
    user: 'maxilsan',
    password: 'q141171616!',
    database: 'supermax',
    charset: 'utf8mb4'
};

const pool = mysql.createPool({
    ...dbConfig,
    connectionLimit: 10,
    waitForConnections: true,
    queueLimit: 0
});

pool.getConnection((err, connection) => {
    if (err) {
        console.error('MySQL connection failed:', err);
    } else {
        console.log('MySQL Connected...');
        connection.release();
    }
});

function getScore(universityName, eventName, record, gender, callback) {
    let column = gender === 'male' ? 'male_record' : 'female_record';
    let sql;

    if (eventName === '제멀' || eventName === '배근력' || eventName === '메던') {
        sql = `SELECT score FROM \`실기테이블\`
               WHERE university_name = ? AND event_name = ?
               AND ${column} <= ? ORDER BY ${column} DESC LIMIT 1`;
    } else if (eventName === '10m') {
        sql = `SELECT score FROM \`실기테이블\`
               WHERE university_name = ? AND event_name = ?
               AND ${column} >= ? ORDER BY ${column} ASC LIMIT 1`;
    } else {
        console.error(`Unknown event: ${eventName}`);
        callback('Unknown event', null);
        return;
    }

    console.log(`Executing SQL: ${sql}`);
    console.log(`With parameters: ${universityName}, ${eventName}, ${record}`);

    pool.query(sql, [universityName, eventName, record], (err, results) => {
        if (err) {
            console.error('Query error:', err);
            callback(err, null);
        } else if (results.length > 0) {
            console.log('Query results:', results);
            callback(null, results[0].score);
        } else {
            console.log('No matching score found');
            if (eventName === '제멀' || eventName === '배근력' || eventName === '메던') {
                callback(null, record > 300 ? 100 : 0);
            } else if (eventName === '10m') {
                callback(null, record < 5 ? 0 : 100);
            } else {
                callback('No matching score found', null);
            }
        }
    });
}

app.post('/get-total-score', (req, res) => {
    const records = req.body.records;
    const university = req.body.university;

    console.log(`Received request for university: ${university}`);
    console.log('Records:', records);

    let totalScore = 0;
    let processed = 0;
    let errors = [];

    records.forEach(record => {
        getScore(university, record.event, parseFloat(record.record), record.gender, (err, score) => {
            if (err) {
                errors.push(err);
            } else {
                totalScore += score;
            }

            processed++;
            if (processed === records.length) {
                if (errors.length > 0) {
                    console.error('Errors:', errors);
                    res.json({ error: errors.join(', ') });
                } else {
                    console.log('Total score:', totalScore);
                    res.json({ totalScore: totalScore });
                }
            }
        });
    });
});

const sslOptions = {
    key: fs.readFileSync('/etc/letsencrypt/live/supermax.kr/privkey.pem'),
    cert: fs.readFileSync('/etc/letsencrypt/live/supermax.kr/fullchain.pem')
};

const PORT = 4000;
https.createServer(sslOptions, app).listen(PORT, () => {
    console.log(`HTTPS Server running on port ${PORT}`);
});
