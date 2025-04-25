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

// 📌 대학 룰 업로드 API
app.post('/college/upload-rule', async (req, res) => {
  try {
    const rules = req.body.rules; // 전체 JSON 객체 배열

    for (const rule of rules) {
      // 1️⃣ 메인 룰 저장
      await conn.promise().query(`
        INSERT INTO university_rules
        (대학명, 학과명, 수능반영비율, 내신반영비율, 실기반영비율, 기타반영비율, 수능선택조건)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 수능반영비율 = VALUES(수능반영비율)
      `, [rule.대학명, rule.학과명, rule.수능반영비율, rule.내신반영비율, rule.실기반영비율, rule.기타반영비율, rule.수능선택조건]);

      // 2️⃣ 과목별 반영 지표 저장
      for (const subj of rule.과목들) {
        await conn.promise().query(`
          INSERT INTO university_score_weights
          (대학명, 학과명, 과목, 반영지표, 반영비율, 표준점수기준, 가산방식)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE 반영비율 = VALUES(반영비율)
        `, [rule.대학명, rule.학과명, subj.과목, subj.반영지표, subj.반영비율, subj.표준점수기준, subj.가산방식]);
      }

      // 3️⃣ 영어, 한국사 등급 점수
      if (rule.등급점수) {
        for (const scoreRow of rule.등급점수) {
          await conn.promise().query(`
            INSERT INTO university_grade_score
            (대학명, 학과명, 과목, 등급, 점수)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 점수 = VALUES(점수)
          `, [rule.대학명, rule.학과명, scoreRow.과목, scoreRow.등급, scoreRow.점수]);
        }
      }

      // 4️⃣ 수학/탐구 가산 조건
      if (rule.가산조건) {
        for (const adj of rule.가산조건) {
          await conn.promise().query(`
            INSERT INTO university_adjustments
            (대학명, 학과명, 과목, 적용과목, 가산비율)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 가산비율 = VALUES(가산비율)
          `, [rule.대학명, rule.학과명, adj.과목, adj.적용과목, adj.가산비율]);
        }
      }
    }

    res.json({ success: true, message: '룰 등록 완료!' });
  } catch (err) {
    console.error('❌ 룰 업로드 오류:', err);
    res.status(500).json({ success: false, message: '서버 오류', error: err });
  }
});


app.post('/college/recommend', (req, res) => {
  console.log('✅ [REQUEST] POST /college/recommend 도착');
  const input = req.body;

  db.query('SELECT * FROM 대학점수계산 WHERE 반영지표 IN ("백/백", "표/표", "표")', (err, rows) => {
    if (err) {
      console.error('❌ [DB] 대학점수계산 SELECT 오류:', err);
      return res.status(500).json({ success: false, message: 'DB 오류: 대학점수계산' });
    }

    db.query('SELECT * FROM 표준점수최고점', (err2, maxRows) => {
      if (err2) {
        console.error('❌ [DB] 표준점수최고점 SELECT 오류:', err2);
        return res.status(500).json({ success: false, message: 'DB 오류: 최고점' });
      }

      console.log('✅ [DB] 쿼리 정상 실행됨');

      const 최고점Map = maxRows[0];

      rows.forEach(row => {
        Object.keys(row).forEach(key => {
          if (row[key] === null) row[key] = 0;
        });
      });

      try {
        const 백백Rows = rows.filter(r => r.반영지표 === '백/백');
        const 표표Rows = rows.filter(r => r.반영지표 === '표/표');
        const 표Rows   = rows.filter(r => r.반영지표 === '표');

        const percentResults = require('./percent')(input, 백백Rows);
        const standardResults = require('./standard')(input, 표표Rows, 최고점Map);
        const standardSingleResults = require('./standardsingle')(input, 표Rows, 최고점Map);

        const results = [...percentResults, ...standardResults, ...standardSingleResults]
          .sort((a, b) => b.최종합산점수 - a.최종합산점수);

        console.log(`✅ [COMPLETE] 결과 ${results.length}개 계산됨`);
        res.json({ success: true, data: results });

   } catch (e) {
  console.error('❌ [LOGIC] 점수 계산 중 오류 발생:', e);  // 전체 에러 로그
  res.status(500).json({
    success: false,
    message: '서버 내부 계산 에러',
    error: e.message || '메시지 없음',
    stack: e.stack || '스택 없음'
  });
}

    });
  });
});


  
  



app.listen(port, () => {
  console.log(`🚀 대학 추천 서버 ${port}번 포트에서 실행 중`);
});
