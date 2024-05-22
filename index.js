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

// 배점 조회 API
app.post('/get-score', (req, res) => {
    const record = parseFloat(req.body.record);
    const gender = req.body.gender;

    console.log(`Received request with record: ${record}, gender: ${gender}`);

    let column = gender === 'male' ? 'male_record' : 'female_record';
    const sql = `SELECT score FROM performance_scores
                 WHERE university_name = 'University A' AND event_name = '100m'
                 AND ${column} >= ? ORDER BY ${column} ASC LIMIT 1`;

    console.log(`Executing SQL: ${sql} with value ${record}`);

    pool.query(sql, [record], (err, results) => {
        if (err) {
            console.error('Query error:', err);
            res.status(500).json({ error: err.message });
        } else if (results.length > 0) {
            console.log('Query results:', results);
            res.json({ score: results[0].score });
        } else {
            console.log('No matching score found');
            res.json({ error: 'No matching score found' });
        }
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
