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

// 학교 등록 API
app.post('/college/school', (req, res) => {
  const { 군명, 대학명, 학과명 } = req.body;

  if (!군명 || !대학명 || !학과명) {
    return res.status(400).json({ message: '군명, 대학명, 학과명 모두 입력하세요.' });
  }

  const sql = 'INSERT INTO 학교 (군명, 대학명, 학과명) VALUES (?, ?, ?)';

  db.query(sql, [군명, 대학명, 학과명], (err, result) => {
    if (err) {
      console.error('❌ 학교 등록 실패:', err);
      return res.status(500).json({ message: '학교 등록 실패' });
    }
    res.json({ message: '✅ 학교 등록 완료', 대학학과ID: result.insertId });
  });
});

// 학교 리스트 불러오기 API
app.get('/college/schools', (req, res) => {
  const sql = 'SELECT 대학학과ID, 군명, 대학명, 학과명 FROM 학교 ORDER BY 대학명, 학과명';
  
  db.query(sql, (err, results) => {
    if (err) {
      console.error('❌ 학교 리스트 불러오기 실패:', err);
      return res.status(500).json({ message: 'DB 조회 실패' });
    }
    res.json({ success: true, schools: results });
  });
});

app.post('/college/school-detail', (req, res) => {
  const {
    대학학과ID, 탐구과목반영수, 한국사반영,
    국수영반영지표, 탐구반영지표, 표준점수반영기준, 영어표준점수만점,
    과목, 반영과목수, 반영규칙, 반영비율,
    그룹1_과목, 그룹1_선택개수, 그룹1_반영비율,
    그룹2_과목, 그룹2_선택개수, 그룹2_반영비율,
    그룹3_과목, 그룹3_선택개수, 그룹3_반영비율
  } = req.body;

  if (!대학학과ID) {
    return res.status(400).json({ message: '학교를 선택하세요' });
  }

  const sql1 = `
    INSERT INTO 탐구한국사 (대학학과ID, 탐구과목반영수, 한국사반영) 
    VALUES (?, ?, ?)
  `;

  const sql2 = `
    INSERT INTO 반영비율규칙 (
      대학학과ID, 국수영반영지표, 탐구반영지표, 표준점수반영기준, 영어표준점수만점,
      과목, 반영과목수, 반영규칙, 반영비율,
      그룹1_과목, 그룹1_선택개수, 그룹1_반영비율,
      그룹2_과목, 그룹2_선택개수, 그룹2_반영비율,
      그룹3_과목, 그룹3_선택개수, 그룹3_반영비율
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.beginTransaction(err => {
    if (err) throw err;

    db.query(sql1, [대학학과ID, 탐구과목반영수, 한국사반영], (err) => {
      if (err) {
        return db.rollback(() => {
          res.status(500).json({ message: '탐구한국사 저장 실패' });
        });
      }

      db.query(sql2, [
        대학학과ID,
        국수영반영지표,
        탐구반영지표,
        표준점수반영기준,
        영어표준점수만점,
        safeJson(과목),
        반영과목수,
        반영규칙,
        safeJson(반영비율),
        safeJson(그룹1_과목),
        그룹1_선택개수 || null,
        safeJson(그룹1_반영비율),
        safeJson(그룹2_과목),
        그룹2_선택개수 || null,
        safeJson(그룹2_반영비율),
        safeJson(그룹3_과목),
        그룹3_선택개수 || null,
        safeJson(그룹3_반영비율)
      ], (err) => {
        if (err) {
          return db.rollback(() => {
            res.status(500).json({ message: '반영비율 저장 실패' });
          });
        }

        db.commit(err => {
          if (err) {
            return db.rollback(() => {
              res.status(500).json({ message: '커밋 실패' });
            });
          }
          res.json({ message: '✅ 세부정보 저장 완료' });
        });
      });
    });
  });
});

// 안전하게 JSON 파싱하는 함수
function safeJson(input) {
  if (!input || input.trim() === "") return null;
  try {
    return JSON.stringify(JSON.parse(input));
  } catch (e) {
    return null;
  }
}



  



app.listen(port, () => {
  console.log(`🚀 대학 추천 서버 ${port}번 포트에서 실행 중`);
});
