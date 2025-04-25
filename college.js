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
// 📌 대학 룰 업로드 API
app.post('/college/upload-rule', async (req, res) => {
  const rules = req.body.rules;
  if (!rules || !Array.isArray(rules)) {
    return res.status(400).json({ success: false, message: 'rules 배열이 필요해!' });
  }

  let errorOccurred = false;

  const processRule = (rule, callback) => {
    const query1 = `
      INSERT INTO university_rules
      (대학명, 학과명, 수능반영비율, 내신반영비율, 실기반영비율, 기타반영비율, 수능선택조건)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 수능반영비율 = VALUES(수능반영비율)
    `;
    const values1 = [
      rule.대학명, rule.학과명, rule.수능반영비율 || 0,
      rule.내신반영비율 || 0, rule.실기반영비율 || 0,
      rule.기타반영비율 || 0, rule.수능선택조건 || ''
    ];

    db.query(query1, values1, (err1) => {
      if (err1) return callback(err1);

      // 2️⃣ 과목별 저장
      const subjQueries = (rule.과목들 || []).map(subj => {
        return new Promise((resolve, reject) => {
          db.query(`
            INSERT INTO university_score_weights
            (대학명, 학과명, 과목, 반영지표, 반영비율, 표준점수기준, 가산방식)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 반영비율 = VALUES(반영비율)
          `, [
            rule.대학명,
            rule.학과명,
            subj.과목 || '',
            subj.반영지표 || '',
            subj.반영비율 || 0,
            subj.표준점수기준 || '',
            subj.가산방식 || ''
          ], (err2) => {
            if (err2) reject(err2);
            else resolve();
          });
        });
      });

      // 3️⃣ 등급 점수
      const gradeQueries = (rule.등급점수 || []).map(scoreRow => {
        return new Promise((resolve, reject) => {
          db.query(`
            INSERT INTO university_grade_score
            (대학명, 학과명, 과목, 등급, 점수)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 점수 = VALUES(점수)
          `, [
            rule.대학명,
            rule.학과명,
            scoreRow.과목 || '',
            scoreRow.등급 || '',
            scoreRow.점수 || 0
          ], (err3) => {
            if (err3) reject(err3);
            else resolve();
          });
        });
      });

      // 4️⃣ 가산 조건
      const adjQueries = (rule.가산조건 || []).map(adj => {
        return new Promise((resolve, reject) => {
          db.query(`
            INSERT INTO university_adjustments
            (대학명, 학과명, 과목, 적용과목, 가산비율)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 가산비율 = VALUES(가산비율)
          `, [
            rule.대학명,
            rule.학과명,
            adj.과목 || '',
            adj.적용과목 || '',
            adj.가산비율 || 0
          ], (err4) => {
            if (err4) reject(err4);
            else resolve();
          });
        });
      });

      Promise.all([...subjQueries, ...gradeQueries, ...adjQueries])
        .then(() => callback(null))
        .catch(callback);
    });
  };

  let processed = 0;
  for (const rule of rules) {
    await new Promise((resolve) => {
      processRule(rule, (err) => {
        if (err) {
          errorOccurred = true;
          console.error('❌ 룰 저장 실패:', err);
        }
        processed++;
        resolve();
      });
    });
  }

  if (errorOccurred) {
    res.status(500).json({ success: false, message: '일부 룰 저장 중 오류 발생' });
  } else {
    res.json({ success: true, message: '✅ 모든 룰 저장 완료' });
  }
});

app.post('/college/recommend-debug', (req, res) => {
  console.log('✅ [DEBUG] 추천 디버깅 요청 도착');
  console.log('📦 입력값:', req.body);

  const input = req.body;
  if (!input || !input.korean || !input.math || !input.subject1 || !input.subject2) {
    return res.status(400).json({ success: false, message: '성적 정보가 누락되었습니다.' });
  }

  try {
    db.query('SELECT * FROM university_rules', (err, ruleRows) => {
      if (err) return res.status(500).json({ success: false, message: '룰 조회 실패', error: err });

      db.query('SELECT * FROM university_score_weights', (err2, weightRows) => {
        if (err2) return res.status(500).json({ success: false, message: '과목 조건 조회 실패', error: err2 });

        db.query('SELECT * FROM university_grade_score', (err3, gradeRows) => {
          if (err3) return res.status(500).json({ success: false, message: '등급 점수 조회 실패', error: err3 });

          db.query('SELECT * FROM 표준점수최고점 LIMIT 1', (err4, maxScoreRows) => {
            if (err4) return res.status(500).json({ success: false, message: '최고점 조회 실패', error: err4 });

            const 최고점Map = maxScoreRows[0];
            const results = [];

            for (const rule of ruleRows) {
              const 학과과목 = weightRows.filter(w => w.대학명 === rule.대학명 && w.학과명 === rule.학과명);

              const 영어등급점수 = gradeRows.find(g =>
                g.대학명 === rule.대학명 &&
                g.학과명 === rule.학과명 &&
                g.과목 === '영어' &&
                String(g.등급) === String(input.englishGrade)
              )?.점수 || 0;

              const 한국사점수 = gradeRows.find(g =>
                g.대학명 === rule.대학명 &&
                g.학과명 === rule.학과명 &&
                g.과목 === '한국사' &&
                String(g.등급) === String(input.khistoryGrade)
              )?.점수 || 0;

              let 선택점수 = 0;
              let 탐구점수 = 0;
              let 영어점수 = 0;

              for (const subj of 학과과목) {
                let raw = 0;
                let 기준 = 100;

                // 과목별 raw 점수 추출
                if (subj.과목 === '국어') {
                  if (subj.반영지표 === '표준점수') raw = input.korean.std;
                  else if (subj.반영지표 === '백분위') raw = input.korean.percent;
                  else if (subj.반영지표 === '등급') raw = input.korean.grade;
                } else if (subj.과목 === '수학') {
                  if (subj.반영지표 === '표준점수') raw = input.math.std;
                  else if (subj.반영지표 === '백분위') raw = input.math.percent;
                  else if (subj.반영지표 === '등급') raw = input.math.grade;
                } else if (subj.과목 === '탐구') {
                  const avgRaw = {
                    std: (input.subject1.std + input.subject2.std) / 2,
                    percent: (input.subject1.percent + input.subject2.percent) / 2,
                    grade: Math.round((input.subject1.grade + input.subject2.grade) / 2)
                  };
                  if (subj.반영지표 === '표준점수') raw = avgRaw.std;
                  else if (subj.반영지표 === '백분위') raw = avgRaw.percent;
                  else if (subj.반영지표 === '등급') raw = avgRaw.grade;
                } else if (subj.과목 === '영어') {
                  // 영어 별도 처리
                  if (subj.표준점수기준 === '200') 기준 = 200;
                  else if (subj.표준점수기준 === '100') 기준 = 100;
                  else if (subj.표준점수기준 === '최고점') {
                    기준 = gradeRows.find(
                      g => g.대학명 === rule.대학명 &&
                           g.학과명 === rule.학과명 &&
                           g.과목 === '영어' &&
                           String(g.등급) === '1'
                    )?.점수 || 100;
                  }
                  const 환산 = (영어등급점수 / 기준) * subj.반영비율;
                  영어점수 += 환산;
                  continue;
                }

                // 기준 설정
                if (subj.반영지표 === '표준점수') {
                  기준 = subj.표준점수기준 === '200'
                    ? 200
                    : 최고점Map[subj.과목] || 1;
                } else if (subj.반영지표 === '백분위') {
                  기준 = 100;
                } else if (subj.반영지표 === '등급') {
                  기준 = 9; // 등급 기준은 1~9로 판단
                  const 등급점수 = gradeRows.find(g =>
                    g.대학명 === rule.대학명 &&
                    g.학과명 === rule.학과명 &&
                    g.과목 === subj.과목 &&
                    String(g.등급) === String(raw)
                  )?.점수 || 0;
                  raw = 등급점수;
                }

                const 환산 = (raw / 기준) * subj.반영비율;
                if (subj.과목 === '탐구') 탐구점수 += 환산;
                else 선택점수 += 환산;
              }

              if (rule.한국사반영방식 === '가산점') 선택점수 += 한국사점수;

              const 수능반영 = rule.수능반영비율 || 100;
              const 최종점수 = (선택점수 + 탐구점수 + 영어점수) * (수능반영 / 100);

              results.push({
                대학명: rule.대학명,
                학과명: rule.학과명,
                선택점수: Math.round(선택점수 * 1000) / 1000,
                탐구점수: Math.round(탐구점수 * 1000) / 1000,
                영어점수: Math.round(영어점수 * 1000) / 1000,
                최종합산점수: Math.round(최종점수 * 1000) / 1000
              });
            }

            res.json({ success: true, data: results });
          });
        });
      });
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: '서버 내부 오류',
      error: e.message,
      stack: e.stack
    });
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
