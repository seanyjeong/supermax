const express = require('express');
const mysql = require('mysql');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = mysql.createConnection({
    host: 'my8003.gabiadb.com',
    user: 'maxilsan',
    password: 'q141171616!',
    database: 'supermax',
    charset: 'utf8mb4'
});

db.connect((err) => {
    if (err) throw err;
    console.log('MySQL Connected...');
});

// HTML 파일 서빙
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 배점 조회 API
app.post('/get-score', (req, res) => {
    const record = parseFloat(req.body.record);
    const gender = req.body.gender;

    let column = gender === 'male' ? 'male_record' : 'female_record';
    const sql = `SELECT score FROM performance_scores
                 WHERE university_name = 'University A' AND event_name = '100m'
                 AND ${column} >= ? ORDER BY ${column} ASC LIMIT 1`;

    db.query(sql, [record], (err, results) => {
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
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
