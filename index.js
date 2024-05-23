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

// Permissions-Policy 헤더 설정
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

// MySQL 연결 설정
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
    let sql;

    if (eventName === '제멀') {
        sql = `SELECT score FROM \`실기테이블\`
               WHERE university_name = ? AND event_name = ?
               AND gender = ? AND record <= ? ORDER BY record DESC LIMIT 1`;
    } else if (eventName === '메던') {
        sql = `SELECT score FROM \`실기테이블\`
               WHERE university_name = ? AND event_name = ?
               AND gender = ? AND record >= ? ORDER BY record ASC LIMIT 1`;
    } else {
        callback('Unknown event', null);
        return;
    }

    pool.query(sql, [universityName, eventName, gender, record], (err, results) => {
        if (err) {
            callback(err, null);
        } else if (results.length > 0) {
            callback(null, results[0].score);
        } else {
            callback('No matching score found', null);
        }
    });
}

// 배점 조회 API
app.post('/get-total-score', (req, res) => {
    const records = req.body.records;
    const university = req.body.university;

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
                    res.json({ error: errors.join(', ') });
                } else {
                    res.json({ totalScore: totalScore });
                }
            }
        });
    });
});

// SSL 인증서 로드
const sslOptions = {
    key: fs.readFileSync('/etc/letsencrypt/live/supermax.kr/privkey.pem'),
    cert: fs.readFileSync('/etc/letsencrypt/live/supermax.kr/fullchain.pem')
};

// HTTPS 서버 시작
const PORT = 4000;
https.createServer(sslOptions, app).listen(PORT, () => {
    console.log(`HTTPS Server running on port ${PORT}`);
});
