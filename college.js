const express = require('express');
const mysql = require('mysql');
const cors = require('cors');
const app = express();
const port = 9000;

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*'); // 모든 출처 허용
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200); // preflight 대응
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

// ✅ 추천 API (백/백 그룹 전용 계산)
app.post('/college/recommend', (req, res) => {
  const input = req.body;

  db.query('SELECT * FROM 대학점수계산 WHERE 반영지표 = "백/백"', (err, rows) => {
    if (err) {
      console.error('❌ 대학 불러오기 실패:', err);
      return res.status(500).json({ success: false, message: 'DB 오류' });
    }

    const results = rows.map(row => {
      const 탐구 = (input.subject1 + input.subject2) / 2;
      const 선택값 = row.수능선택조건?.includes('수영택1')
        ? Math.max(input.math, input.english)
        : (input.math + input.english) / 2;

      const 점수합 =
        (input.korean * ((row.국어비율 || 0) / 100)) +
        (탐구 * ((row.탐구비율 || 0) / 100)) +
        (선택값 * ((row.수학비율 || 0) + (row.영어비율 || 0) === 0
          ? row.수능반영비율 / 3 / 100
          : ((row.수학비율 || 0) + (row.영어비율 || 0)) / 100));

      const 총점 = 점수합 * (1000 / (row.수능반영비율 || 100));

      return {
        대학명: row.대학명,
        학과명: row.학과명,
        총점: Math.round(총점 * 10) / 10,
        국어: input.korean,
        수학: input.math,
        영어: input.english,
        탐구: 탐구
      };
    });

    results.sort((a, b) => b.총점 - a.총점);
    res.json({ success: true, data: results });
  });
});

app.listen(port, () => {
  console.log(`🚀 대학 추천 서버 ${port}번 포트에서 실행 중`);
});
