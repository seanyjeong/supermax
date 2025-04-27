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
  const { 군명, 대학명, 학과명, 수능비율, 내신비율, 실기비율, 기타비율 , 총점기준} = req.body;

  if (!군명 || !대학명 || !학과명) {
    return res.status(400).json({ message: '군명, 대학명, 학과명 모두 입력하세요.' });
  }

  const sql = `
    INSERT INTO 학교 (군명, 대학명, 학과명, 수능비율, 내신비율, 실기비율, 기타비율, 총점기준)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(sql, [군명, 대학명, 학과명, 수능비율, 내신비율, 실기비율, 기타비율, 총점기준], (err, result) => {
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

// ✨ 1. 백자표 학교 리스트 뽑기
app.get('/college/tanguback-create-list', async (req, res) => {
  try {
    const results = await dbQuery(`
      SELECT DISTINCT 학교.대학학과ID, 학교.대학명, 학교.학과명
      FROM 학교
      INNER JOIN 반영비율규칙 ON 학교.대학학과ID = 반영비율규칙.대학학과ID
      WHERE 반영비율규칙.탐구반영지표 = '백자표'
      ORDER BY 학교.대학명, 학교.학과명
    `);
    res.json({ success: true, schools: results });
  } catch (err) {
    console.error('❌ 백자표 학교리스트 에러:', err);
    res.status(500).json({ message: '서버 에러' });
  }
});

// ✨ 2. 백자표 변환점수 저장
app.post('/college/tanguback-save', async (req, res) => {
  const { 대학학과ID, 구분, 변환표 } = req.body;
  
  if (!대학학과ID || !구분 || !변환표 || !Array.isArray(변환표)) {
    return res.status(400).json({ message: '필수 데이터 부족' });
  }

  try {
    // 기존 데이터 삭제
    await dbQuery('DELETE FROM 탐구백자표변환점수 WHERE 대학학과ID = ? AND 구분 = ?', [대학학과ID, 구분]);

    // 새 데이터 삽입
    for (const item of 변환표) {
      const { 백분위, 변환점수 } = item;
      await dbQuery('INSERT INTO 탐구백자표변환점수 (대학학과ID, 구분, 백분위, 변환점수) VALUES (?, ?, ?, ?)', 
        [대학학과ID, 구분, 백분위, 변환점수]);
    }

    res.json({ success: true, message: '✅ 변환표 저장 완료' });
  } catch (err) {
    console.error('❌ 변환표 저장 에러:', err);
    res.status(500).json({ message: '서버 에러' });
  }
});

// ✨ 3. 백자표 변환점수 불러오기
app.get('/college/tanguback-get/:대학학과ID/:구분', async (req, res) => {
  const { 대학학과ID, 구분 } = req.params;

  try {
    const results = await dbQuery(
      'SELECT 백분위, 변환점수 FROM 탐구백자표변환점수 WHERE 대학학과ID = ? AND 구분 = ? ORDER BY 백분위 DESC',
      [대학학과ID, 구분]
    );
    res.json({ success: true, 변환표: results });
  } catch (err) {
    console.error('❌ 변환표 조회 에러:', err);
    res.status(500).json({ message: '서버 에러' });
  }
});



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
const [school] = await dbQuery('SELECT 수능비율, 내신비율, 실기비율, 기타비율,총점기준 FROM 학교 WHERE 대학학과ID = ?', [대학학과ID]);

    if (!school) return res.status(404).json({ message: '학교 정보 없음' });
    // ✨ [추가] 표준점수 최고점 불러오기
// 최고점 데이터 가져오기
const 최고점데이터 = await dbQuery('SELECT * FROM 표준점수최고점 LIMIT 1');

const 표준점수최고점데이터 = {};
if (최고점데이터.length > 0) {
  const row = 최고점데이터[0];
  for (const key in row) {
    if (key !== 'created_at') {  // created_at 컬럼은 제외
      표준점수최고점데이터[key.trim()] = row[key];
    }
  }
}


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
    // 5번 영어등급별 점수까지 다 불러온 후
// ✨ 탐구 백자표 변환점수 미리 추가
if (rule.탐구반영지표 === '백자표') {
  const 탐구1구분 = calculator.과목구분(studentScore.subject1Name);
  const 탐구2구분 = calculator.과목구분(studentScore.subject2Name);

  studentScore.탐구1.변환점수 = await get백자표변환점수(대학학과ID, 탐구1구분, studentScore.탐구1.백분위);
  studentScore.탐구2.변환점수 = await get백자표변환점수(대학학과ID, 탐구2구분, studentScore.탐구2.백분위);
  console.log(`🧪 탐구1 변환점수 (${studentScore.subject1Name} - ${탐구1구분}):`, studentScore.탐구1.변환점수);
  console.log(`🧪 탐구2 변환점수 (${studentScore.subject2Name} - ${탐구2구분}):`, studentScore.탐구2.변환점수);
}


// 6. 점수셋 만들기
const is기본 = rule.표준점수반영기준 === '기본';

const normalize = (score) => is기본 ? score : score * 100;

const 점수셋 = {
  국어: normalize(calculator.normalizeScore(
    calculator.getSubjectScore(studentScore.국어, rule.국수영반영지표),
    rule.국수영반영지표,
    rule.표준점수반영기준,
    studentScore.국어과목명,
    표준점수최고점데이터
  )),
  수학: normalize(calculator.normalizeScore(
    calculator.getSubjectScore(studentScore.수학, rule.국수영반영지표),
    rule.국수영반영지표,
    rule.표준점수반영기준,
    studentScore.수학과목명,
    표준점수최고점데이터
  )),
  영어: normalize(calculator.normalizeEnglishScore(
    studentScore.영어등급,
    englishScoreRule,
    rule.영어표준점수만점
  )),
  탐구: (() => {
    if (rule.탐구반영지표 === '백자표') {
      const 탐구1최고점 = studentScore.탐구1_백자표변환표?.[100] ?? 70;
      const 탐구2최고점 = studentScore.탐구2_백자표변환표?.[100] ?? 70;
  
      let t1 = 0;
      let t2 = 0;
  
      if (rule.표준점수반영기준 === '최고점') {
        t1 = (studentScore.탐구1.변환점수 || 0) / 탐구1최고점;
        t2 = (studentScore.탐구2.변환점수 || 0) / 탐구2최고점;
      } else if (rule.표준점수반영기준 === '200') {
        t1 = (studentScore.탐구1.변환점수 || 0) / 100;
        t2 = (studentScore.탐구2.변환점수 || 0) / 100;
      } else {
        t1 = (studentScore.탐구1.변환점수 || 0);
        t2 = (studentScore.탐구2.변환점수 || 0);
      }
  
      if (khistoryRule.탐구과목반영수 === 1) {
        // 1개 반영이면 큰 값만
        return Math.max(t1, t2) * 100;
      } else {
        // 2개 반영이면 평균
        return ((t1 + t2) / 2) * 100;
      }
    } else {
      return calculator.processScienceScore(
        calculator.getSubjectScore(studentScore.탐구1, rule.탐구반영지표),
        calculator.getSubjectScore(studentScore.탐구2, rule.탐구반영지표),
        khistoryRule.탐구과목반영수
      );
    }
  })()
  
  
};





    // 7. 계산
    const 반영과목리스트 = JSON.parse(rule.과목 || '[]');
    const 반영비율 = JSON.parse(rule.반영비율 || '[]');
    
    const 그룹정보 = [
      {
        과목리스트: JSON.parse(rule.그룹1_과목 || '[]'),
        선택개수: rule.그룹1_선택개수 || 0,
        반영비율: rule.그룹1_반영비율 || 0
      },
      {
        과목리스트: JSON.parse(rule.그룹2_과목 || '[]'),
        선택개수: rule.그룹2_선택개수 || 0,
        반영비율: rule.그룹2_반영비율 || 0
      },
      {
        과목리스트: JSON.parse(rule.그룹3_과목 || '[]'),
        선택개수: rule.그룹3_선택개수 || 0,
        반영비율: rule.그룹3_반영비율 || 0
      }
    ];
    
    // ✨ 수능 점수 계산
const 수능환산점수 = calculator.calculateCollegeScore(
  studentScore,
  { ...school, 국수영반영지표: rule.국수영반영지표, 탐구반영지표: rule.탐구반영지표 },
  점수셋,
  반영과목리스트,
  반영비율,
  rule.반영규칙,
  rule.반영과목수,
  그룹정보,
  school.총점기준
);

const koreanHistoryResult = calculator.applyKoreanHistoryScore(studentScore, khistoryRule, koreanHistoryScoreRule);

// 수능비율 가져오기
const 수능비율 = school.수능비율 || 0;

// 최종 점수
let finalScore = 0;

// 한국사 처리 방식 분기
if (koreanHistoryResult) {
  if (koreanHistoryResult.처리방식 === '수능환산') {
    // 수능환산이면 ➔ 그냥 수능환산점수 + (한국사 점수 × 수능비율 / 100)
    finalScore = 수능환산점수 + (koreanHistoryResult.점수 * (school.수능비율 / 100));
  } else if (koreanHistoryResult.처리방식 === '직접더함') {
    // 직접더함이면 ➔ 그냥 수능환산점수 + 한국사 점수
    finalScore = 수능환산점수 + koreanHistoryResult.점수;
  } else {
    // 다른 경우는 그냥 수능환산점수만
    finalScore = 수능환산점수;
  }
} else {
  // 한국사 아예 없으면 그냥 수능환산점수
  finalScore = 수능환산점수;
}


// 최종 결과 반환
res.json({ success: true, totalScore: finalScore });



        console.log('🏫 school:', school);
console.log('📏 rule:', rule);
console.log('🧮 점수셋:', 점수셋);
console.log('📚 반영과목리스트:', 반영과목리스트);
console.log('📊 반영비율:', 반영비율);
console.log('🔥 최종합산점수:', finalScore);
    console.log('🔥 수능환산점수:', 수능환산점수);
console.log('🔥 수능비율:', 수능비율);
console.log('🏛 한국사 처리결과:', koreanHistoryResult);


  } catch (err) {
    console.error('❌ 계산 에러:', err);
    res.status(500).json({ message: '계산 실패' });
  }
});

// ✨ 탐구 백자표 변환점수 가져오는 함수
async function get백자표변환점수(대학학과ID, 구분, 백분위) {
  const sql = `
    SELECT 변환점수 
    FROM 탐구백자표변환점수 
    WHERE 대학학과ID = ? AND 구분 = ? AND 백분위 = ?
  `;
  try {
    const [result] = await dbQuery(sql, [대학학과ID, 구분, 백분위]);
    return result ? parseFloat(result.변환점수) : 0;
  } catch (err) {
    console.error('❌ 백자표 변환점수 조회 실패:', err);
    return 0;
  }
}


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
