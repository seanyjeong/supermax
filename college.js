const express = require('express');
const mysql = require('mysql');
const cors = require('cors');

const app = express();
const port = 9000;

app.set('trust proxy', true);
app.use(cors());
app.use(express.json());

// DB 연결 설정
const db = mysql.createConnection({
  host: '211.37.174.218',
  user: 'maxilsan',
  password: 'q141171616!',
  database: '정시엔진',
  charset: 'utf8mb4',
});

db.connect(err => {
  if (err) {
    console.error('❌ MySQL 연결 실패:', err);
  } else {
    console.log('✅ MySQL 연결 성공!');
  }
});

// ✅ 테스트 라우트
app.get('/test', (req, res) => {
  const ip = req.ip;
  res.send(`✅ 대학추천 서버 정상 작동 중! 당신의 IP는 ${ip} 입니다.`);
});

// ✅ 루트 라우트
app.get('/', (req, res) => {
  res.send('🎓 대학추천 서버 루트입니다!');
});

// 서버 실행
app.listen(port, () => {
  console.log(`🚀 대학추천 서버가 ${port}번 포트에서 실행 중입니다.`);
});
