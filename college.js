const express = require('express');
const mysql = require('mysql');
const cors = require('cors');
const app = express();
const port = 9000;

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());

const db = mysql.createConnection({
  host: '211.37.174.218',
  user: 'maxilsan',
  password: 'q141171616!',
  database: '정시엔진',
  charset: 'utf8mb4'
});

db.connect(err => {
  if (err) console.error('❌ DB 연결 실패:', err);
  else console.log('✅ MySQL 연결 성공');
});

const calculatePercentLogic = require('./percent');

app.post('/college/recommend', (req, res) => {
  const input = req.body;

  db.query('SELECT * FROM 대학점수계산 WHERE 반영지표 = "백/백"', (err, rows) => {
    if (err) {
      console.error('❌ 대학 불러오기 실패:', err);
      return res.status(500).json({ success: false, message: 'DB 오류' });
    }

    const results = calculatePercentLogic(input, rows);
    res.json({ success: true, data: results });
  });
});

app.post('/college/insert-max-score', (req, res) => {
  const data = req.body;
  const keys = Object.keys(data);
  const values = keys.map(k => data[k]);

  const columns = keys.join(',');
  const placeholders = keys.map(() => '?').join(',');

  const sql = `INSERT INTO 표준점수최고점 (${columns}) VALUES (${placeholders})`;

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error('❌ 표준점수최고점 INSERT 실패:', err);
      return res.status(500).json({ success: false });
    }
    res.json({ success: true });
  });
});




app.listen(port, () => {
  console.log(`🚀 대학 추천 서버 ${port}번 포트에서 실행 중`);
});
