const { db } = require('./college');

// ✨ 공통 DB 쿼리 함수
function dbQuery(sql, params) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
}

// ✨ 학교별 특수 계산 함수 모음
const specialSchoolCalculators = {
  47: calculate강원대체육교육과,   // 강원대 체육교육과
  48: calculate강원대스포츠과학과, // 강원대 스포츠과학과
  49: calculate강원대휴먼스포츠학부 // 강원대 휴먼스포츠학부
  // 🔥 앞으로 추가할 학교들은 여기다가 { 대학학과ID: 함수명 } 등록하면 돼
};

// ✨ 메인 함수 (specialSchools 통합 계산기)
async function calculateSpecialSchool(대학학과ID, studentScore) {
  try {
    if (!specialSchoolCalculators[대학학과ID]) {
      throw new Error('❌ 이 대학은 SpecialSchools 대상이 아님');
    }

    // 수능비율
    const [schoolInfo] = await dbQuery('SELECT 수능비율 FROM 학교 WHERE 대학학과ID = ?', [대학학과ID]);
    if (!schoolInfo) throw new Error('❌ 학교 정보 없음');

    // 영어등급별 점수
    const [englishInfo] = await dbQuery('SELECT 점수 FROM 영어등급별점수 WHERE 대학학과ID = ?', [대학학과ID]);
    const englishScoreTable = englishInfo ? JSON.parse(englishInfo.점수) : {};

    // 한국사등급별 점수
    const [koreanHistoryInfo] = await dbQuery('SELECT 점수 FROM 한국사등급별점수 WHERE 대학학과ID = ?', [대학학과ID]);
    const koreanHistoryScoreTable = koreanHistoryInfo ? JSON.parse(koreanHistoryInfo.점수) : {};

    // 해당 학교 계산기 호출
    const totalScore = await specialSchoolCalculators[대학학과ID](studentScore, schoolInfo, englishScoreTable, koreanHistoryScoreTable);

    return totalScore;

  } catch (err) {
    console.error('❌ specialSchool 계산 실패:', err);
    throw err;
  }
}

//
// 🔥 강원대 전용 계산 함수들
//

async function calculate강원대체육교육과(studentScore, schoolInfo, englishScoreTable, koreanHistoryScoreTable) {
  const 국어 = studentScore.국어?.백분위 || 0;
  const 수학 = studentScore.수학?.백분위 || 0;
  const 영어등급 = studentScore.영어등급 || 9;
  const 영어 = englishScoreTable[영어등급] || 0;
  const 높은수영 = Math.max(수학, 영어);

  const 한국사등급 = studentScore.한국사등급 || 9;
  const 한국사 = koreanHistoryScoreTable[한국사등급] || 0;

  const 합산 = 국어 + 높은수영;
  const 수능점수 = 합산 * (schoolInfo.수능비율 / 100);

  return 수능점수 + 한국사;
}

async function calculate강원대스포츠과학과(studentScore, schoolInfo, englishScoreTable, koreanHistoryScoreTable) {
  const 국어 = studentScore.국어?.백분위 || 0;
  const 탐구1 = studentScore.탐구1?.백분위 || 0;
  const 수학 = studentScore.수학?.백분위 || 0;
  const 영어등급 = studentScore.영어등급 || 9;
  const 영어 = englishScoreTable[영어등급] || 0;
  const 높은수영 = Math.max(수학, 영어);

  const 한국사등급 = studentScore.한국사등급 || 9;
  const 한국사 = koreanHistoryScoreTable[한국사등급] || 0;

  const 합산 = 국어 + 탐구1 + 높은수영;
  const 수능점수 = 합산 * (schoolInfo.수능비율 / 100);

  return 수능점수 + 한국사;
}

async function calculate강원대휴먼스포츠학부(studentScore, schoolInfo, englishScoreTable, koreanHistoryScoreTable) {
  const 후보 = [
    studentScore.국어?.백분위 || 0,
    studentScore.수학?.백분위 || 0,
    englishScoreTable[studentScore.영어등급 || 9] || 0,
    studentScore.탐구1?.백분위 || 0
  ];
  후보.sort((a, b) => b - a); // 높은거 2개 뽑기

  const 한국사등급 = studentScore.한국사등급 || 9;
  const 한국사 = koreanHistoryScoreTable[한국사등급] || 0;

  const 합산 = 후보[0] + 후보[1];
  const 수능점수 = 합산 * (schoolInfo.수능비율 / 100);

  return 수능점수 + 한국사;
}

//
// 🔥 앞으로 추가할 특수학교들은 위에 specialSchoolCalculators에 함수 추가하면 된다
//

module.exports = { calculateSpecialSchool };
