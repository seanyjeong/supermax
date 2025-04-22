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



app.post('/college/recommend', (req, res) => {
    const input = req.body;
  
    db.query('SELECT * FROM 대학점수계산 WHERE 반영지표 IN ("백/백", "표/표", "표")', (err, rows) => {
      if (err) return res.status(500).json({ success: false, message: 'DB 오류' });
  
      db.query('SELECT * FROM 표준점수최고점', (err2, maxRows) => {
        if (err2) return res.status(500).json({ success: false, message: 'DB 오류' });
  
        const 최고점Map = maxRows[0];
  
        const 백백Rows = rows.filter(r => r.반영지표 === '백/백');
        const 표표Rows = rows.filter(r => r.반영지표 === '표/표');
        const 표Rows   = rows.filter(r => r.반영지표 === '표');
  
        const percentResults = require('./percent')(input, 백백Rows);
        const standardResults = require('./standard')(input, 표표Rows, 최고점Map);
        const standardSingleResults = require('./standardsingle')(input, 표Rows, 최고점Map);
  
        const results = [...percentResults, ...standardResults, ...standardSingleResults]
          .sort((a, b) => b.최종합산점수 - a.최종합산점수);
  
        res.json({ success: true, data: results });
      });
    });
  });
  
  
  



app.listen(port, () => {
  console.log(`🚀 대학 추천 서버 ${port}번 포트에서 실행 중`);
});
