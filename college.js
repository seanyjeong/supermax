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

// ✅ 추천 API (백/백 그룹 + 수영택1 / 국수영탐택2 계산 포함 + 한국사 가산점 적용)
app.post('/college/recommend', (req, res) => {
  const input = req.body;

  db.query('SELECT * FROM 대학점수계산 WHERE 반영지표 = "백/백"', (err, rows) => {
    if (err) {
      console.error('❌ 대학 불러오기 실패:', err);
      return res.status(500).json({ success: false, message: 'DB 오류' });
    }

    const 과탐목록 = ["물리1", "물리2", "화학1", "화학2", "생명과학1", "생명과학2", "지구과학1", "지구과학2"];

    const results = rows.map(row => {
      const 영어등급점수 = row[`영어${input.englishGrade}등급점수`] || 0;
      const 한국사등급점수 = row[`한국사${input.khistoryGrade}등급점수`] || 0;

      let 수능최종반영점수 = 0;
      let 선택점수 = 0;

      let 수학점수 = input.math;
      let 탐구1점수 = input.subject1;
      let 탐구2점수 = input.subject2;

      // 수학 가산점 적용
      if (row.수학가산과목조건) {
        const 조건들 = row.수학가산과목조건.split(',');
        조건들.forEach(조건 => {
          const [과목, 퍼센트] = 조건.split(':');
          if (input.mathSubject === 과목.trim()) {
            수학점수 *= (1 + parseFloat(퍼센트 || 0) / 100);
          }
        });
      }

      // 탐구 가산점 적용
      if (row.탐구가산과목조건?.includes('과탐')) {
        const 가산 = parseFloat(row.탐구가산과목조건.split(':')[1] || 0);
        if (과탐목록.includes(input.subject1Name)) 탐구1점수 *= (1 + 가산 / 100);
        if (과탐목록.includes(input.subject2Name)) 탐구2점수 *= (1 + 가산 / 100);
      }

      let 탐구 = 0;
      if (row.탐구과목수 === 2) {
        탐구 = (탐구1점수 + 탐구2점수) / 2;
      } else if (row.탐구과목수 === 1) {
        탐구 = Math.max(탐구1점수, 탐구2점수);
      }

      if (!row.수능선택조건 || row.수능선택조건.trim() === '') {
        const 국어점수 = input.korean * (row.국어비율 / 100);
        const 수학점수_가산 = 수학점수 * (row.수학비율 / 100);
        const 영어점수 = 영어등급점수 * (row.영어비율 / 100);
        const 탐구점수 = 탐구 * (row.탐구비율 / 100);

        선택점수 = 국어점수 + 수학점수_가산 + 영어점수 + 탐구점수;
        수능최종반영점수 = 선택점수 * (row.수능반영비율 / 100);
      } else if (row.수능선택조건 === '수영택1') {
        const 선택 = 수학점수 >= 영어등급점수
          ? 수학점수 * (row.수학비율 / 100)
          : 영어등급점수 * (row.영어비율 / 100);
        const 국어점수 = input.korean * (row.국어비율 / 100);
        const 탐구점수 = 탐구 * (row.탐구비율 / 100);
        선택점수 = 선택;
        수능최종반영점수 = (국어점수 + 선택 + 탐구점수) * (row.수능반영비율 / 100);
      } else if (row.수능선택조건 === '국수영탐택2') {
        const candidates = [input.korean, 수학점수, 영어등급점수, 탐구];
        candidates.sort((a, b) => b - a);
        선택점수 = (candidates[0] + candidates[1]) / 2;
        수능최종반영점수 = 선택점수 * (row.수능반영비율 / 100);
      } else {
        return null;
      }

      if (row.한국사반영방식 === '가산점') {
        수능최종반영점수 += 한국사등급점수;
      }

      return {
        대학명: row.대학명,
        학과명: row.학과명,
        최종합산점수: Math.round(수능최종반영점수 * 10) / 10,
        수능최종반영점수: Math.round(수능최종반영점수 * 10) / 10,
        선택점수: Math.round(선택점수 * 10) / 10,
        국어: input.korean,
        수학: input.math,
        영어: input.english,
        영어등급: input.englishGrade,
        탐구: 탐구,
        한국사등급: input.khistoryGrade,
        수능반영비율: row.수능반영비율,
        수능선택조건: row.수능선택조건,
        국어비율: row.국어비율,
        수학비율: row.수학비율,
        영어비율: row.영어비율,
        탐구비율: row.탐구비율,
        탐구과목수: row.탐구과목수,
        한국사반영방식: row.한국사반영방식
      };
    }).filter(Boolean);

    results.sort((a, b) => b.최종합산점수 - a.최종합산점수);
    res.json({ success: true, data: results });
  });
});

app.listen(port, () => {
  console.log(`🚀 대학 추천 서버 ${port}번 포트에서 실행 중`);
});
