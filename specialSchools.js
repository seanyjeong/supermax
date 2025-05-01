// 📂 specialSchools.js

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
  return englishInfo ? JSON.parse(englishInfo.점수) : [];
}

// ✨ 한국사 점수 배열 가져오기
async function getKoreanHistoryData(대학학과ID) {
  const [koreanHistoryInfo] = await dbQuery('SELECT 등급, 점수 FROM 한국사등급별점수 WHERE 대학학과ID = ?', [대학학과ID]);
  return koreanHistoryInfo ? JSON.parse(koreanHistoryInfo.점수) : [];
}

// ✨ 학교별 특수 계산 함수 모음
const specialSchoolCalculators = {
  30: calculate강원대체육교육과,   // 강원대 체육교육과
  1: calculate강원대스포츠과학과,  // 강원대 스포츠과학과
  31: calculate강원대휴먼스포츠학부, // 강원대 휴먼스포츠학부
  36: calculate공주대학교,         // 공주대 생체 농어촌
  37: calculate공주대학교,         // 공주대 생체 일반
  38: calculate공주대학교,          // 공주대 체육교육과
  28: calculate관동대학교일반,
  29: calculate관동대학교일반,
  65: calculate관동대학교일반,
   2:calculate계명대학교,
   3:calculate계명대학교,
   42:calcualte대가대

};

// ✨ 메인 SpecialSchool 계산기
async function calculateSpecialSchool(대학학과ID, studentScore) {
  try {
    if (!specialSchoolCalculators[대학학과ID]) throw new Error('❌ 이 대학은 SpecialSchools 대상이 아님');

    const [schoolInfo] = await dbQuery('SELECT 수능비율 FROM 학교 WHERE 대학학과ID = ?', [대학학과ID]);
    if (!schoolInfo) throw new Error('❌ 학교 정보 없음');

    const englishData = await getEnglishData(대학학과ID);
    const koreanHistoryData = await getKoreanHistoryData(대학학과ID);

    // ✨ 학생 점수 풀어놓기
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

    // ✨ 계산 함수 호출 (풀어놓은 값 넘기기)
    const totalScore = await specialSchoolCalculators[대학학과ID]({ 국어백, 수학백, 탐구1백, 탐구2백, 영어, 한국사, schoolInfo });

    console.log('🏫 SpecialSchool 계산 완료:', { 대학학과ID, totalScore });

    return totalScore;
  } catch (err) {
    console.error('❌ specialSchool 계산 실패:', err);
    throw err;
  }
}

// ✨ 강원대 체육교육과
async function calculate강원대체육교육과({ 국어백, 수학백, 영어, 한국사 }) {
  const 높은수영 = Math.max(수학백, 영어);
  const 합산 = 국어백 + 높은수영;
  const 수능점수 = 합산 * 1.5;
  return 수능점수 + 한국사;
}

// ✨ 강원대 스포츠과학과
async function calculate강원대스포츠과학과({ 국어백, 수학백, 탐구1백, 탐구2백, 영어, 한국사 }) {
  const 높은수영 = Math.max(수학백, 영어);
  const 탐구평균 = (탐구1백 + 탐구2백) / 2;
  const 합산 = 국어백 + 높은수영 + 탐구평균;
  const 수능점수 = 합산 * 0.6;
  return 수능점수 + 한국사;
}

// ✨ 강원대 휴먼스포츠학부
async function calculate강원대휴먼스포츠학부({ 국어백, 수학백, 탐구1백, 탐구2백, 영어, 한국사 }) {
  const 탐구평균 = (탐구1백 + 탐구2백) / 2;
  const 후보 = [국어백, 수학백, 영어, 탐구평균];
  후보.sort((a, b) => b - a);
  const 반영점수 = 후보[0] * 0.6 + 후보[1] * 0.6;
  return 반영점수 + 한국사;
}

// ✨ 공주대학교 (공통)
async function calculate공주대학교({ 국어백, 수학백, 탐구1백, 탐구2백, 영어, 한국사, schoolInfo }) {
  const 탐구MAX = Math.max(탐구1백, 탐구2백);
  const 후보 = [국어백, 수학백, 영어, 탐구MAX];
  후보.sort((a, b) => b - a);
  const 반영점수 = (후보[0] + 후보[1] + 후보[2]) / 3;
  const 수능점수 = (반영점수 * 8.5 + 150) * (schoolInfo.수능비율 / 100);
  return 수능점수 + 한국사;
}

//관동대학교(일반)
async function calculate관동대학교일반({ 국어백, 수학백, 탐구1백, 탐구2백, 영어, 한국사, schoolInfo }) {
  const 탐구평균 = (탐구1백+탐구2백)/2;
  const 후보 = [국어백, 수학백, 탐구평균];
  후보.sort((a, b) => b - a);
  const 반영점수 = 후보[0]*4 + 후보[1] *4  ;
  const 수능점수 = 반영점수 * (schoolInfo.수능비율 / 100) + 영어;

  console.log('학생점수 완료:', { 국어백, 수학백, 탐구1백, 탐구2백,영어,한국사 });
  console.log('🏫 SpecialSchool 계산 완료:', { 반영점수,수능점수 });
  return 수능점수 + 한국사;
}

//계명대학교(통합)
async function calculate계명대학교({국어백,수학백,탐구1백,탐구2백,영어,한국사,schoolInfo}) {
  const 탐구평균 =(탐구1백+탐구2백)/2;
  const 후보 = [국어백, 수학백];
  후보.sort((a,b) => b - a);
  const 반영점수 = 후보[0]*1.2 + 영어*0.9 + 탐구평균*0.9;
  const 수능점수 = (반영점수+한국사)/3 * (schoolInfo.수능비율 /100);
  console.log('🏫 SpecialSchool 계산 완료:', { 반영점수,수능점수 });
  return 수능점수 
  
}

//대구가톨릭대학교
async function calcualte대가대({국어백,수학백,탐구1백,탐구2백,영어,한국사,schoolInfo}) {
  const 탐구MAX = Math.max(탐구1백, 탐구2백); 
  const 반영점수 = 국어백*0.3+수학백*0.3+영어*0.1+(탐구MAX+한국사)*0.3;
  const 수능점수 = 반영점수 * (schoolInfo.수능비율 / 10);
  return 수능점수
  
}


module.exports = { calculateSpecialSchool };
