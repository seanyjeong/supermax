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

// MySQL 연결 테스트
pool.getConnection((err, connection) => {
    if (err) {
        console.error('MySQL connection failed:', err);
    } else {
        console.log('MySQL Connected...');
        connection.release();
    }
});

// 종목별 점수 조회 함수
function getScore(event, record, gender, callback) {
    let column = gender === 'male' ? 'male_record' : 'female_record';
    let sql;

    if (event === '100m') {
        sql = `SELECT score FROM performance_scores
               WHERE university_name = 'University A' AND event_name = ?
               AND ${column} >= ? ORDER BY ${column} ASC LIMIT 1`;
    } else if (event === '제멀') {
        sql = `SELECT score FROM performance_scores
               WHERE university_name = 'University A' AND event_name = ?
               AND ${column} <= ? ORDER BY ${column} DESC LIMIT 1`;
    } else {
        callback('Unknown event', null);
        return;
    }

    pool.query(sql, [event, record], (err, results) => {
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

    let totalScore = 0;
    let processed = 0;
    let errors = [];

    records.forEach(record => {
        getScore(record.event, parseFloat(record.record), record.gender, (err, score) => {
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
