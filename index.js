const express = require('express');
const mysql = require('mysql');
const bodyParser = require('body-parser');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(bodyParser.json());
app.use(cors());

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

    let column = gender === 'male' ? 'male_record' : 'female_record';
    const sql = `SELECT score FROM performance_scores
                 WHERE university_name = 'University A' AND event_name = '100m'
                 AND ${column} >= ? ORDER BY ${column} ASC LIMIT 1`;

    pool.query(sql, [record], (err, results) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else if (results.length > 0) {
            res.json({ score: results[0].score });
        } else {
            res.json({ error: 'No matching score found' });
        }
    });
});

// 서버 시작
const PORT = 4000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
