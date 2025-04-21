const express = require('express');
const mysql = require('mysql');
const cors = require('cors');

const app = express();
const port = 9000;

// ✅ CORS 설정
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));
app.options('*', cors()); // preflight 대응

app.use(express.json());

// ✅ MySQL 연결
const db = mysql.createConnection({
  host: '211.37.174.218',
  user: 'maxilsan',
  password: 'q141171616!',
  database: '정시엔진',
  charset: 'utf8mb4'
});

db.connect(err => {
  if (err) {
    console.error('❌ DB 연결 실패:', err.message);
  } else {
    console.log('✅ MySQL 연결 성공');
  }
});

// ✅ 테스트 라우트
app.get('/test', (req, res) => {
  res.send('✅ 대학 추천 서버 정상 작동 중입니다!');
});

// ✅ INSERT API
app.post('/college/insert', (req, res) => {
  const d = req.body;

  const sql = `
    INSERT INTO 대학점수계산 (
      군구분, 대학형태, 대학명, 학과명, 교직이수여부, 지역,
      수능반영비율, 내신반영비율, 실기반영비율,
      국어비율, 수학비율, 영어비율, 탐구비율, 탐구과목수,
      한국사반영방식,
      영어1등급점수, 영어2등급점수, 영어3등급점수, 영어4등급점수, 영어5등급점수,
      영어6등급점수, 영어7등급점수, 영어8등급점수, 영어9등급점수,
      한국사1등급점수, 한국사2등급점수, 한국사3등급점수, 한국사4등급점수, 한국사5등급점수,
      한국사6등급점수, 한국사7등급점수, 한국사8등급점수, 한국사9등급점수,
      반영지표, 표준점수기준, 수능선택조건, 계산방식그룹,
      수학가산과목조건, 탐구가산과목조건
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `;

  const values = [
    d.군구분, d.대학형태, d.대학명, d.학과명, d.교직이수여부, d.지역,
    d.수능반영비율, d.내신반영비율, d.실기반영비율,
    d.국어비율, d.수학비율, d.영어비율, d.탐구비율, d.탐구과목수,
    d.한국사반영방식,
    d.영어1등급점수, d.영어2등급점수, d.영어3등급점수, d.영어4등급점수, d.영어5등급점수,
    d.영어6등급점수, d.영어7등급점수, d.영어8등급점수, d.영어9등급점수,
    d.한국사1등급점수, d.한국사2등급점수, d.한국사3등급점수, d.한국사4등급점수, d.한국사5등급점수,
    d.한국사6등급점수, d.한국사7등급점수, d.한국사8등급점수, d.한국사9등급점수,
    d.반영지표, d.표준점수기준, d.수능선택조건, d.계산방식그룹,
    d.수학가산과목조건, d.탐구가산과목조건
  ];

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error('❌ INSERT 오류:', err.message);
      return res.status(500).json({ success: false, message: 'DB 오류', error: err.message });
    }
    res.json({ success: true, id: result.insertId });
  });
});

// ✅ 서버 실행
app.listen(port, () => {
  console.log(`🚀 대학 추천 서버가 ${port}번 포트에서 실행 중`);
});
