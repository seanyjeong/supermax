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
  30: calculate강원대체육교육과,   // 강원대 체육교육과
  1: calculate강원대스포츠과학과, // 강원대 스포츠과학과
  31: calculate강원대휴먼스포츠학부, // 강원대 휴먼스포츠학부
  36: calculate공주대학교,//공주생체농어촌
  37: calculate공주대학교,//공주대생체일반
  38: calculate공주대학교//공주대체교
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
    //학생점수 끌어오기
const 국어백 = studentScore.국어?.백분위 || 0;
const 국어표 = studentScore.국어?.표준점수 || 0;
const 국어등 = studentScore.국어?.등급 || 0;
const 수학백 = studentScore.수학?.백분위 || 0;
const 수학표 = studentScore.수학?.표준점수 || 0;
const 수학등 = studentScore.수학?.등 || 0;
const 탐구1백 = studentScore.탐구1?.백분위 || 0;
const 탐구2백 = studentScore.탐구2?.백분위 || 0;
const 탐구1표 = studentScore.탐구1?.표준점수 || 0;
const 탐구2표 = studentScore.탐구2?.표준점수 || 0;
const 탐구1등 = studentScore.탐구1?.등급 || 0;
const 탐구2등 = studentScore.탐구2?.등급 || 0;
const 한국사 = koreanHistoryData[studentScore.한국사등급 - 1] || 0; 
const 영어 = englishData[studentScore.영어등급 - 1] || 0; 

    // 계산 호출
    const totalScore = await specialSchoolCalculators[대학학과ID](studentScore, schoolInfo, englishData, koreanHistoryData);

    console.log('🏫 SpecialSchool 계산 완료:', { 대학학과ID, totalScore });

    return totalScore;

  } catch (err) {
    console.error('❌ specialSchool 계산 실패:', err);
    throw err;
  }
}

// 강원대 전용 계산 함수들
//
//국,수영택1 150으로 
async function calculate강원대체육교육과() {

  const 영어 = englishData[studentScore.영어등급 - 1] || 0;  // 영어 점수 계산
  const 높은수영 = Math.max(수학백, 영어);
  const 합산 = 국어백 + 높은수영;
  const 수능점수 = 합산 * 1.5;
  return 수능점수 + 한국사;
}
//수영택1국탐(2) 60비율
async function calculate강원대스포츠과학과() {
  const 높은수영 = Math.max(수학백, 영어);  // 수학과 영어 중 더 높은 값
  const 탐구평균 = (탐구1백 + 탐구2백) / 2; // 두 과목 점수 평균
  const 합산 = 국어백 + 탐구평균 + 높은수영;
  const 수능점수 = 합산 * 0.6;
  return 수능점수 + 한국사;  // 최종 점수
}
//국수영탐(2) 비율60씩 두개 합산후 한국사.
async function calculate강원대휴먼스포츠학부() {
  // 국어, 수학, 영어, 탐구 점수 계산
  const 탐구평균 = (탐구2백 + 탐구2백) / 2;
// 국수영탐 중 잘 본 2개 과목을 선택
  const 후보 = [
    국어백,
    수학백,
    영어,
    탐구평균  // 탐구1과 탐구2 평균 점수 반영
  ];
 후보.sort((a, b) => b - a); // 높은 점수 2개 선택
// 두 개의 높은 점수는 60% 반영, 나머지는 60% 반영
  const 반영점수 = 후보[0] * 0.6 + 후보[1] * 0.6;
// 최종 점수 계산: 반영된 점수 + 한국사 점수
  const 수능점수 = 반영점수;
 console.log('📚 [휴먼스포츠학부]', { 후보, 반영점수, 수능점수, 한국사 });
return 수능점수 + 한국사;  // 최종 점수
}
//국수영탐(2) 비율60씩 두개 합산후 한국사.
async function calculate공주대학교() {
  // 국어, 수학, 영어, 탐구 점수 계산
  const 탐구MAX = Math.max(탐구1백,탐구2백);
// 국수영탐 중 잘 본 2개 과목을 선택
  const 후보 = [
    국어백,
    수학백,
    영어,
    탐구MAX  // 탐구1과 탐구2 잘본것
  ];
 후보.sort((a, b) => b - a); // 높은 점수 2개 선택
// 세개.
  const 반영점수 = (후보[0]  + 후보[1] + 후보[2])/3;
// 한국사 점수 계산
  const 한국사 = koreanHistoryData[studentScore.한국사등급 - 1] || 0;
 // 최종 점수 계산: 반영된 점수 + 한국사 점수
  const 수능점수 = (반영점수*8.5+150)*(schoolInfo.수능비율 /100 );
 console.log('📚 [공주대]', { 후보, 반영점수, 수능점수, 한국사 });
return 수능점수 + 한국사;  // 최종 점수
}




  

module.exports = { calculateSpecialSchool };
