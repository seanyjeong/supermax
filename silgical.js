// silgical.js

/**
 * ⭐️ [규칙 1] 종목명으로 기록방식/기본점수 판단 (하드코딩) ⭐️
 * @param {string} eventName - "100m 달리기", "제자리멀리뛰기" 등
 * @returns {object} - { method: 'lower_is_better'|'higher_is_better', baseScore: 0 }
 */
function getEventRules(eventName) {
  // 여기에 '낮을수록 좋은' 종목 키워드를 모두 등록
  const LOW_IS_BETTER_KEYWORDS = [
    '달리기',
    'm', // 100m, 80m, 20m ...
    'run',
    '런',
    '왕복',
    '초', // 단위가 '초'인 것들
    '오래', // 오래 매달리기 등
  ];

  // 기본값: 높을수록 좋음 (제멀, 윗몸, 던지기 등)
  let method = 'higher_is_better';
  let baseScore = 0; // 기본점수 0점이 디폴트

  // 키워드 검사
  if (LOW_IS_BETTER_KEYWORDS.some((k) => eventName.includes(k))) {
    method = 'lower_is_better';
  }

  // --- 예외 규칙 하드코딩 ---
  // "m"가 포함되지만 '높을수록' 좋은 종목 (예: 핸드볼공 '던지기')
  if (eventName.includes('던지기') || eventName.includes('멀리뛰기')) {
    method = 'higher_is_better';
  }

  return { method, baseScore };
}

/**
 * ⭐️ [규칙 2] 학생 기록으로 배점표에서 '배점 등급' 찾기 (핵심 로직) ⭐️
 * @param {string} studentRecord - 학생 기록 (예: "12.5" 또는 "A" 또는 "P")
 * @param {string} method - 'lower_is_better' | 'higher_is_better'
 * @param {number} baseScore - 기본 점수 (getEventRules에서 받음)
 * @param {Array<object>} scoreTable - 해당 종목/성별의 배점표 데이터 배열
 * @returns {string} - 배점 (예: "98" 또는 "PASS")
 */
function lookupScore(studentRecord, method, baseScore, scoreTable) {
  if (!scoreTable || scoreTable.length === 0) {
    return String(baseScore); // 배점표 없으면 기본 점수
  }

  const studentValueStr = String(studentRecord).trim();
  const studentValueNum = Number(studentValueStr);
  const isNumericInput = !Number.isNaN(studentValueNum) && studentValueStr !== '';

  let numericLevels = []; // 숫자 비교용 { record: 12.2, grade: "98" }
  let exactMatchLevels = new Map(); // 문자 비교용 {"A": "A", "P": "PASS"}
  let rangeLevels = []; // 범위 비교용 {"200 이상", "PASS"}

  // 1. DB 배점표를 3가지 종류로 분류
  for (const level of scoreTable) {
    const recordStr = String(level.기록).trim();
    const recordNum = Number(recordStr);

    if (!Number.isNaN(recordNum) && recordStr !== '') {
      // "12.50", "300" -> 숫자 비교용
      numericLevels.push({ record: recordNum, grade: level.배점 });
    } else if (
      recordStr.includes('이상') ||
      recordStr.includes('이하') ||
      recordStr.includes('초과') ||
      recordStr.includes('미만')
    ) {
      // "200 이상", "199 이하" -> 범위 비교용
      rangeLevels.push({ rangeStr: recordStr, grade: level.배점 });
    } else {
      // "A", "P", "F", "실격" -> 문자 일치용
      exactMatchLevels.set(recordStr, level.배점);
    }
  }

  // 2. [1순위] 문자 일치 (학생 기록 "A", "P" 등)
  if (exactMatchLevels.has(studentValueStr)) {
    return exactMatchLevels.get(studentValueStr);
  }

  // 3. [2,3순위] 학생 기록이 숫자인 경우 ("12.5", "210" 등)
  if (isNumericInput) {
    // 3a. [2순위] 범위 비교 ("200 이상", "199 이하")
    for (const level of rangeLevels) {
      // "200 이상" 에서 숫자(200)와 조건(이상) 분리
      const parts = level.rangeStr.match(/([0-9.]+)\s*(이상|이하|초과|미만)/);
      if (parts && parts[1]) {
        const limit = Number(parts[1]);
        const type = parts[2];
        if (type === '이상' && studentValueNum >= limit) return level.grade;
        if (type === '이하' && studentValueNum <= limit) return level.grade;
        if (type === '초과' && studentValueNum > limit) return level.grade;
        if (type === '미만' && studentValueNum < limit) return level.grade;
      }
    }

    // 3b. [3순위] 숫자 비교 ("12.20", "297")
    if (numericLevels.length > 0) {
      if (method === 'lower_is_better') {
        // 기록 오름차순 정렬 (12.0, 12.1, ...)
        numericLevels.sort((a, b) => a.record - b.record);
        // 학생기록(12.15)이 DB기록(12.20)보다 작거나 같은 첫 번째 값
        for (const level of numericLevels) {
          if (studentValueNum <= level.record) return level.grade;
        }
        // 만점(12.0)보다 잘했어도 만점
        if (studentValueNum < numericLevels[0].record) {
          return numericLevels[0].grade;
        }
      } else {
        // 'higher_is_better'
        // 기록 내림차순 정렬 (300, 298, ...)
        numericLevels.sort((a, b) => b.record - a.record);
        // 학생기록(299)이 DB기록(298)보다 크거나 같은 첫 번째 값
        for (const level of numericLevels) {
          if (studentValueNum >= level.record) return level.grade;
        }
        // 만점(300)보다 잘했어도 만점
        if (studentValueNum > numericLevels[0].record) {
          return numericLevels[0].grade;
        }
      }
    }
  }

  // 4. 어디에도 해당 안 됨 (기준 미달 또는 "FAIL" "F" 같은 문자)
  return String(baseScore);
}

/**
 * ⭐️ [규칙 3] '배점 등급'을 '최종 점수'로 환산 (1% 예외 하드코딩) ⭐️
 * @param {string} grade - '배점 등급' (예: "98" 또는 "PASS")
 * @param {number} U_ID - 학교 U_ID
 * @param {string} eventName - 종목명
 * @returns {number} - 최종 환산 점수 (예: 98 또는 50)
 */
function convertGradeToScore(grade, U_ID, eventName) {
  // --- 1% 예외 학교 (U_ID와 종목명으로 분기) ---
  
  /* // 예시: U_ID 102번 학교의 '핸드볼던지기' 종목
  if (U_ID === 102 && eventName === '핸드볼던지기') {
    if (grade === 'PASS') return 50;
    if (grade === 'FAIL') return 0;
  }
  
  // 예시: U_ID 103번 학교의 '봉사활동' 종목
  if (U_ID === 103 && eventName === '봉사활동') {
    if (grade === 'A') return 20;
    if (grade === 'B') return 15;
    if (grade === 'C') return 10;
  }
  */
  
  // --- (여기에 1% 예외 계속 추가) ---


  // --- 99% 일반 학교 (배점 = 점수) ---
  const score = Number(grade);
  
  // "FAIL"이나 "실격"이 예외처리에 안 걸리고 넘어오면 0점 처리
  return Number.isNaN(score) ? 0 : score;
}

/**
 * ⭐️ [메인] 실기 점수 계산 함수 (1단계: 기본 합산) ⭐️
 */
function calculateScore(F, S) {
  const log = [];
  log.push('========== 실기 계산 시작 ==========');

  const practicalRatio = (Number(F.실기) || 0) / 100;
  if (practicalRatio <= 0) {
    log.push('[패스] 실기 반영 비율 0%');
    return { totalScore: 0, breakdown: {}, calculationLog: log };
  }

  const SCHOOL_TOTAL = Number(F?.총점) > 0 ? Number(F.총점) : 1000;
  const PRACTICAL_MAX = Number(F.실기총점) || 0;
  const studentGender = S?.gender || ''; // '남' 또는 '여'
  const studentRecords = S?.practicals || []; // [{event: "100m 달리기", value: "12.5"}]
  const allScoreData = F?.실기배점 || []; // DB에서 가져온 배점표 원본 배열

  log.push(`[정보] 학교총점=${SCHOOL_TOTAL}, 실기만점(DB)=${PRACTICAL_MAX}, 실기비율=${practicalRatio}`);

  if (PRACTICAL_MAX <= 0) {
    log.push(`[오류] '정시반영비율.실기총점'이 0입니다. 계산 불가.`);
    return { totalScore: 0, breakdown: {}, calculationLog: log };
  }
  if (studentGender !== '남' && studentGender !== '여') {
    log.push(`[오류] 학생 성별(S.gender)이 '남' 또는 '여'가 아닙니다.`);
    return { totalScore: 0, breakdown: {}, calculationLog: log };
  }

  let rawPracticalSum = 0; // 학생이 받은 실기 점수 총합

  // ⭐️ 나중에 2단계 (선택 반영) 하려면 이 부분을 수정하면 됨
  studentRecords.forEach((record) => {
    const eventName = record.event; // "100m 달리기"
    const eventValue = record.value; // "12.5"

    // 1. [규칙1] 이 종목의 규칙(method, baseScore) 가져오기
    const { method, baseScore } = getEventRules(eventName);

    // 2. [데이터] DB에서 이 종목, 이 성별에 맞는 배점표만 필터링
    const scoreTable = allScoreData.filter(
      (r) => r.종목명 === eventName && r.성별 === studentGender
    );

    // 3. [규칙2] 학생 기록으로 '배점 등급'(예: "98" or "PASS") 찾기
    const rawGrade = lookupScore(eventValue, method, baseScore, scoreTable);
    
    // 4. [규칙3] '배점 등급'을 '최종 점수'(예: 98 or 50)로 환산
    const score = convertGradeToScore(rawGrade, F.U_ID, eventName);

    log.push(
      `[${eventName}] (규칙: ${method}) 기록: ${eventValue} → 배점: "${rawGrade}" → 환산: ${score}점`
    );
    rawPracticalSum += score;
  });

  log.push(`[결과] 실기 원점수 합계: ${rawPracticalSum} / ${PRACTICAL_MAX}`);

  // 5. 최종 점수 환산
  // (실기점수 / 실기만점) * 학교총점 * 실기반영비율
  const rawPracticalTotal = (rawPracticalSum / PRACTICAL_MAX) * SCHOOL_TOTAL;
  const finalPracticalScore = rawPracticalTotal * practicalRatio;

  log.push('========== 실기 최종 ==========');
  log.push(
    `실기 환산 점수 (총점화) = (${rawPracticalSum} / ${PRACTICAL_MAX}) * ${SCHOOL_TOTAL} = ${rawPracticalTotal.toFixed(
      3
    )}`
  );
  log.push(
    `실기 최종 점수 (비율 적용) = ${rawPracticalTotal.toFixed(
      3
    )} * ${practicalRatio} = ${finalPracticalScore.toFixed(3)}`
  );

  return {
    totalScore: finalPracticalScore.toFixed(3),
    breakdown: { practical_raw_sum: rawPracticalSum },
    calculationLog: log,
  };
}

// 모듈로 내보내기
module.exports = {
  calculateScore,
};
