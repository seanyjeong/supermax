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
const calculator = require('./collegeCalculator');


app.post('/college/school', (req, res) => {
  const { 군명, 대학명, 학과명, 수능비율, 내신비율, 실기비율, 기타비율 } = req.body;

  if (!군명 || !대학명 || !학과명) {
    return res.status(400).json({ message: '군명, 대학명, 학과명 모두 입력하세요.' });
  }

  const sql = `
    INSERT INTO 학교 (군명, 대학명, 학과명, 수능비율, 내신비율, 실기비율, 기타비율)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(sql, [군명, 대학명, 학과명, 수능비율, 내신비율, 실기비율, 기타비율], (err, result) => {
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
    그룹3_과목, 그룹3_선택개수, 그룹3_반영비율,
    수학가산점, 과탐가산점   // ⭐️ 추가된 부분
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
      그룹3_과목, 그룹3_선택개수, 그룹3_반영비율,
      수학가산점, 과탐가산점
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        safeJson(그룹3_반영비율),
        수학가산점 || 0,  // ⭐️
        과탐가산점 || 0   // ⭐️
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


app.post('/college/korean-history-score', (req, res) => {
  const { 대학학과ID, 등급, 점수 } = req.body;

  if (!대학학과ID || !등급 || !점수) {
    return res.status(400).json({ message: '필수 데이터가 없습니다.' });
  }

  const sql = `
    INSERT INTO 한국사등급별점수 (대학학과ID, 등급, 점수)
    VALUES (?, ?, ?)
  `;

  db.query(sql, [대학학과ID, JSON.stringify(등급), JSON.stringify(점수)], (err) => {
    if (err) {
      console.error('❌ 한국사 점수 저장 실패:', err);
      return res.status(500).json({ message: '한국사 점수 저장 실패' });
    }
    res.json({ message: '✅ 한국사 점수 저장 완료' });
  });
});

app.post('/college/english-score', (req, res) => {
  const { 대학학과ID, 등급, 점수 } = req.body;

  if (!대학학과ID || !등급 || !점수) {
    return res.status(400).json({ message: '필수 데이터가 없습니다.' });
  }

  const sql = `
    INSERT INTO 영어등급별점수 (대학학과ID, 등급, 점수)
    VALUES (?, ?, ?)
  `;

  db.query(sql, [대학학과ID, JSON.stringify(등급), JSON.stringify(점수)], (err) => {
    if (err) {
      console.error('❌ 영어 점수 저장 실패:', err);
      return res.status(500).json({ message: '영어 점수 저장 실패' });
    }
    res.json({ message: '✅ 영어 점수 저장 완료' });
  });
});

app.get('/college/korean-history-score/:id', (req, res) => {
  const 대학학과ID = req.params.id;

  const sql = `
    SELECT 등급, 점수
    FROM 한국사등급별점수
    WHERE 대학학과ID = ?
  `;

  db.query(sql, [대학학과ID], (err, results) => {
    if (err) {
      console.error('❌ 한국사 점수 조회 실패:', err);
      return res.status(500).json({ message: 'DB 조회 실패' });
    }
    if (results.length === 0) {
      return res.status(404).json({ message: '해당 데이터 없음' });
    }
    res.json({
      success: true,
      등급: JSON.parse(results[0].등급),
      점수: JSON.parse(results[0].점수)
    });
  });
});

app.get('/college/english-score/:id', (req, res) => {
  const 대학학과ID = req.params.id;

  const sql = `
    SELECT 등급, 점수
    FROM 영어등급별점수
    WHERE 대학학과ID = ?
  `;

  db.query(sql, [대학학과ID], (err, results) => {
    if (err) {
      console.error('❌ 영어 점수 조회 실패:', err);
      return res.status(500).json({ message: 'DB 조회 실패' });
    }
    if (results.length === 0) {
      return res.status(404).json({ message: '해당 데이터 없음' });
    }
    res.json({
      success: true,
      등급: JSON.parse(results[0].등급),
      점수: JSON.parse(results[0].점수)
    });
  });
});

app.post('/college/calculate', async (req, res) => {
  const { 대학학과ID, studentScore } = req.body;

  if (!대학학과ID || !studentScore) {
    return res.status(400).json({ message: '대학학과ID, studentScore는 필수입니다.' });
  }

  try {
    // 1. 학교 비율 불러오기
    const [school] = await dbQuery('SELECT 수능비율, 내신비율, 실기비율 FROM 학교 WHERE 대학학과ID = ?', [대학학과ID]);
    if (!school) return res.status(404).json({ message: '학교 정보 없음' });

    // 2. 반영비율 규칙 불러오기
    const [rule] = await dbQuery('SELECT * FROM 반영비율규칙 WHERE 대학학과ID = ?', [대학학과ID]);
    if (!rule) return res.status(404).json({ message: '반영비율 규칙 없음' });

    // 3. 탐구/한국사 규칙 불러오기
    const [khistoryRule] = await dbQuery('SELECT * FROM 탐구한국사 WHERE 대학학과ID = ?', [대학학과ID]);
    if (!khistoryRule) return res.status(404).json({ message: '탐구한국사 규칙 없음' });

    // 4. 한국사 등급별 점수
    const [khistoryScore] = await dbQuery('SELECT 등급, 점수 FROM 한국사등급별점수 WHERE 대학학과ID = ?', [대학학과ID]);
    const koreanHistoryScoreRule = khistoryScore ? JSON.parse(khistoryScore.점수) : [];

    // 5. 영어 등급별 점수
    const [englishScore] = await dbQuery('SELECT 등급, 점수 FROM 영어등급별점수 WHERE 대학학과ID = ?', [대학학과ID]);
    const englishScoreRule = englishScore ? JSON.parse(englishScore.점수) : [];

    // 6. 점수셋 만들기
    const 점수셋 = {
      국어: calculator.getSubjectScore(studentScore.국어, rule.국수영반영지표),
      수학: calculator.getSubjectScore(studentScore.수학, rule.국수영반영지표),
      영어: calculator.normalizeEnglishScore(studentScore.영어등급, englishScoreRule, rule.영어표준점수만점) * 100,
      탐구: calculator.processScienceScore(
        calculator.getSubjectScore(studentScore.탐구1, rule.탐구반영지표),
        calculator.getSubjectScore(studentScore.탐구2, rule.탐구반영지표),
        khistoryRule.탐구과목반영수
      )
    };

    // 7. 계산
    const 반영과목리스트 = JSON.parse(rule.과목 || '[]');
    const 반영비율 = JSON.parse(rule.반영비율 || '[]');
    const finalScore = calculator.calculateCollegeScore(
      studentScore,
      { ...school, 국수영반영지표: rule.국수영반영지표, 탐구반영지표: rule.탐구반영지표 },
      점수셋,
      반영과목리스트,
      반영비율,
      rule.반영규칙,
      rule.반영과목수
    );

    res.json({ success: true, totalScore: finalScore });

  } catch (err) {
    console.error('❌ 계산 에러:', err);
    res.status(500).json({ message: '계산 실패' });
  }
});

// ✨ DB query promise 버전
function dbQuery(sql, params) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
}



  



app.listen(port, () => {
  console.log(`🚀 대학 추천 서버 ${port}번 포트에서 실행 중`);
});
