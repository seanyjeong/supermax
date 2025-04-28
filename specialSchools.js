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

// ✨ 영어 점수 배열 가져오기
async function getEnglishData(대학학과ID) {
  const [englishInfo] = await dbQuery('SELECT 등급, 점수 FROM 영어등급별점수 WHERE 대학학과ID = ?', [대학학과ID]);
  return englishInfo ? JSON.parse(englishInfo.점수) : { 등급: [], 점수: [] };
}

// ✨ 한국사 점수 배열 가져오기
async function getKoreanHistoryData(대학학과ID) {
  const [koreanHistoryInfo] = await dbQuery('SELECT 등급, 점수 FROM 한국사등급별점수 WHERE 대학학과ID = ?', [대학학과ID]);
  return koreanHistoryInfo ? JSON.parse(koreanHistoryInfo.점수) : { 등급: [], 점수: [] };
}

// ✨ 학교별 특수 계산 함수 모음
const specialSchoolCalculators = {
  47: calculate강원대체육교육과,   // 강원대 체육교육과
  1: calculate강원대스포츠과학과, // 강원대 스포츠과학과
  49: calculate강원대휴먼스포츠학부 // 강원대 휴먼스포츠학부
};

// ✨ 메인 SpecialSchool 계산기
async function calculateSpecialSchool(대학학과ID, studentScore) {
  try {
    if (!specialSchoolCalculators[대학학과ID]) {
      throw new Error('❌ 이 대학은 SpecialSchools 대상이 아님');
    }

    // 수능비율
    const [schoolInfo] = await dbQuery('SELECT 수능비율 FROM 학교 WHERE 대학학과ID = ?', [대학학과ID]);
    if (!schoolInfo) throw new Error('❌ 학교 정보 없음');

    // 영어 점수 배열 DB에서 가져오기
    const englishData = await getEnglishData(대학학과ID);

    // 한국사 점수 배열 DB에서 가져오기
    const koreanHistoryData = await getKoreanHistoryData(대학학과ID);

    // 계산 호출
    const totalScore = await specialSchoolCalculators[대학학과ID](studentScore, schoolInfo, englishData, koreanHistoryData);

    console.log('🏫 SpecialSchool 계산 완료:', { 대학학과ID, totalScore });

    return totalScore;

  } catch (err) {
    console.error('❌ specialSchool 계산 실패:', err);
    throw err;
  }
}

//
// 🔥 강원대 전용 계산 함수들
//

async function calculate강원대체육교육과(studentScore, schoolInfo, englishData, koreanHistoryData) {
  const 국어 = studentScore.국어?.백분위 || 0;
  const 수학 = studentScore.수학?.백분위 || 0;
  const 영어 = englishData[studentScore.영어등급 - 1] || 0;  // 영어 점수 계산
  const 높은수영 = Math.max(수학, 영어);

  const 한국사 = koreanHistoryData[studentScore.한국사등급 - 1] || 0;  // 한국사 점수 계산

  const 합산 = 국어 + 높은수영;
  const 수능점수 = 합산 * (schoolInfo.수능비율 / 100);

  console.log('📚 [체육교육과]', { 국어, 수학, 영어, 높은수영, 합산, 수능점수, 한국사 });

  return 수능점수 + 한국사;
}

async function calculate강원대스포츠과학과(studentScore, schoolInfo, englishData, koreanHistoryData) {
  const 국어 = studentScore.국어?.백분위 || 0;
  const 탐구1 = Math.max(studentScore.탐구1?.백분위 || 0, studentScore.탐구2?.백분위 || 0);
  const 수학 = studentScore.수학?.백분위 || 0;
  const 영어 = englishData[studentScore.영어등급 - 1] || 0;  // 영어 점수 계산
  const 높은수영 = Math.max(수학, 영어);

  const 한국사 = koreanHistoryData[studentScore.한국사등급 - 1] || 0;  // 한국사 점수 계산

  const 합산 = 국어 + 탐구1 + 높은수영;
  const 수능점수 = 합산 * (schoolInfo.수능비율 / 100);

  console.log('📚 [스포츠과학과]', { 국어, 탐구1, 수학, 영어, 높은수영, 합산, 수능점수, 한국사 });

  return 수능점수 + 한국사;
}

async function calculate강원대휴먼스포츠학부(studentScore, schoolInfo, englishData, koreanHistoryData) {
    // 후보 점수 계산: 국어, 수학, 영어, 탐구1, 탐구2
    const 후보 = [
      studentScore.국어?.백분위 || 0,
      studentScore.수학?.백분위 || 0,
      englishData[studentScore.영어등급 - 1] || 0,  // 영어 점수 계산
      Math.max(studentScore.탐구1?.백분위 || 0, studentScore.탐구2?.백분위 || 0)  // 탐구1, 탐구2 중 큰 값 선택
    ];
  
    후보.sort((a, b) => b - a); // 높은 점수 2개 선택
  
    // 한국사 점수 계산
    const 한국사 = koreanHistoryData[studentScore.한국사등급 - 1] || 0;
  
    // 합산 점수 계산
    const 합산 = 후보[0] + 후보[1];
    const 수능점수 = 합산 * (schoolInfo.수능비율 / 100);
  
    console.log('📚 [휴먼스포츠학부]', { 후보, 합산, 수능점수, 한국사 });
  
    return 수능점수 + 한국사;
  }
  

module.exports = { calculateSpecialSchool };
