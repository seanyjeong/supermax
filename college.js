const express = require('express');
const mysql = require('mysql');
const cors = require('cors');
const app = express();
const port = 9000;

app.use(cors({ origin: '*' }));
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

// ✅ 대학 정보 입력 API
app.post('/college/insert', (req, res) => {
  const data = req.body;

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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    data.군구분, data.대학형태, data.대학명, data.학과명, data.교직이수여부, data.지역,
    data.수능반영비율, data.내신반영비율, data.실기반영비율,
    data.국어비율, data.수학비율, data.영어비율, data.탐구비율, data.탐구과목수,
    data.한국사반영방식,
    data.영어1등급점수, data.영어2등급점수, data.영어3등급점수, data.영어4등급점수, data.영어5등급점수,
    data.영어6등급점수, data.영어7등급점수, data.영어8등급점수, data.영어9등급점수,
    data.한국사1등급점수, data.한국사2등급점수, data.한국사3등급점수, data.한국사4등급점수, data.한국사5등급점수,
    data.한국사6등급점수, data.한국사7등급점수, data.한국사8등급점수, data.한국사9등급점수,
    data.반영지표, data.표준점수기준, data.수능선택조건, data.계산방식그룹,
    data.수학가산과목조건, data.탐구가산과목조건
  ];

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error('❌ INSERT 실패:', err);
      res.status(500).send('DB INSERT 오류');
    } else {
      res.send({ success: true, id: result.insertId });
    }
  });
});

app.listen(port, () => {
  console.log(`🚀 대학 추천 서버 ${port}번 포트에서 실행 중`);
});
