const express = require('express');
const mysql = require('mysql');
const bodyParser = require('body-parser');
const https = require('https');
const fs = require('fs');
const cors = require('cors'); // CORS 미들웨어 추가
const app = express();

// MySQL connection
const db = mysql.createConnection({
    host: '211.37.174.218',
    user: 'maxilsan',
    password: 'q141171616!',
    database: 'supermax'
});

db.connect(err => {
    if (err) {
        throw err;
    }
    console.log('MySQL Connected...');
});

app.use(cors()); // 모든 요청에 대해 CORS 헤더 추가

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Handle form submission
app.post('/submit', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // 특정 요청에 대해 CORS 헤더 설정

    const { university_name, event_name, gender, record } = req.body;

    let query;
    if (event_name === '10m') {
        query = `SELECT score FROM records WHERE university_name = ? AND event_name = ? AND ? <= (CASE WHEN ? = 'male' THEN male_record ELSE female_record END) ORDER BY (CASE WHEN ? = 'male' THEN male_record ELSE female_record END) LIMIT 1`;
    } else {
        query = `SELECT score FROM records WHERE university_name = ? AND event_name = ? AND ? >= (CASE WHEN ? = 'male' THEN male_record ELSE female_record END) ORDER BY (CASE WHEN ? = 'male' THEN male_record ELSE female_record END) DESC LIMIT 1`;
    }

    db.query(query, [university_name, event_name, record, gender, gender], (err, results) => {
        if (err) throw err;

        let score = results.length ? results[0].score : 0;
        res.json({ score });
    });
});

// SSL options
const sslOptions = {
    key: fs.readFileSync('/etc/letsencrypt/live/supermax.kr/privkey.pem'),
    cert: fs.readFileSync('/etc/letsencrypt/live/supermax.kr/fullchain.pem')
};

const PORT = 3000;
https.createServer(sslOptions, app).listen(PORT, 'supermax.kr', () => {
    console.log(`Server running on https://supermax.kr:${PORT}`);
});
