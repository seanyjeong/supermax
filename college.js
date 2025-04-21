const express = require('express');
const mysql = require('mysql');
const cors = require('cors');
const app = express();
const port = 9000;

// 미들웨어
app.use(cors());
app.use(express.json());

// DB 연결
const db = mysql.createConnection({
  host: '211.37.174.218',
  user: 'maxilsan',
  password: 'q141171616!',
  database: '정시엔진',
  charset: 'utf8mb4'
});

db.connect(err => {
  if (err) {
    console.error('❌ DB 연결 실패:', err);
  } else {
    console.log('✅ MySQL 연결 성공');
  }
});

// 테스트 라우트
app.get('/', (req, res) => {
  res.send('🎓 대학 추천 서버 정상 작동 중!');
});

// 서버 실행
app.listen(port, () => {
  console.log(`🚀 대학 추천 서버 포트 ${port}에서 실행 중!`);
});
