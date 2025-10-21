// silgical.js (라우터 버전)
const express = require('express');
const router = express.Router();

// -----------------------------------------------------------------
// ⭐️ [1] 내부 헬퍼 함수들
// -----------------------------------------------------------------

/**
 * [규칙 1] 종목명으로 기록방식 판단
 */
function getEventRules(eventName) {
  const LOW_IS_BETTER_KEYWORDS = [
    '달리기', 'm', 'run', '런', '왕복', '초', '오래',
  ];
  let method = 'higher_is_better';
  if (LOW_IS_BETTER_KEYWORDS.some((k) => eventName.includes(k))) {
    method = 'lower_is_better';
  }
  if (eventName.includes('던지기') || eventName.includes('멀리뛰기')) {
    method = 'higher_is_better';
  }
  return { method };
}

// ⭐️ [신규 헬퍼] 배점표에서 해당 종목의 '최고 배점(만점)'을 찾음
function findMaxScore(scoreTable) {
    if (!scoreTable || scoreTable.length === 0) return 0;
    // 배점(숫자)만 추출해서 최대값을 찾음
    const max = scoreTable
        .map(l => Number(l.배점))
        .filter(n => !Number.isNaN(n))
        .reduce((max, current) => Math.max(max, current), 0);
    return max;
}

/**
 * ⭐️ [규칙 2] 학생 기록으로 '배점 등급' 찾기
 * (수정) '미달 시 처리' 규칙(outOfRangeRule)을 파라미터로 받음
 */
function lookupScore(studentRecord, method, scoreTable, outOfRangeRule) {
  // 1. 배점표가 아예 없으면 0점
  if (!scoreTable || scoreTable.length === 0) {
    return '0';
  }

  const studentValueStr = String(studentRecord).trim();
  const studentValueNum = Number(studentValueStr);
  const isNumericInput = !Number.isNaN(studentValueNum) && studentValueStr !== '';

  let numericLevels = [];
  let exactMatchLevels = new Map();
  let rangeLevels = [];

  // 2. 배점표 분류
  for (const level of scoreTable) {
    const recordStr = String(level.기록).trim();
    const recordNum = Number(recordStr);
    if (!Number.isNaN(recordNum) && recordStr !== '') {
      numericLevels.push({ record: recordNum, grade: level.배점 });
    } else if (
      recordStr.includes('이상') || recordStr.includes('이하') ||
      recordStr.includes('초과') || recordStr.includes('미만')
    ) {
      rangeLevels.push({ rangeStr: recordStr, grade: level.배점 });
    } else {
      exactMatchLevels.set(recordStr, level.배점); // "P", "F", "실격" 등
    }
  }

  // 3. [1순위] 문자 일치 ("P", "F" 등)
  if (exactMatchLevels.has(studentValueStr)) {
    return exactMatchLevels.get(studentValueStr);
  }

  // 4. [2,3순위] 숫자 기록인 경우
  if (isNumericInput) {
    // 4a. [2순위] 범위 비교 ("200 이상" 등)
    for (const level of rangeLevels) {
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

    // 4b. [3순위] 숫자 비교 ("12.20" 등)
    if (numericLevels.length > 0) {
      if (method === 'lower_is_better') {
        numericLevels.sort((a, b) => a.record - b.record);
        for (const level of numericLevels) {
          if (studentValueNum <= level.record) return level.grade;
        }
        if (studentValueNum < numericLevels[0].record) {
          return numericLevels[0].grade;
        }
      } else {
        numericLevels.sort((a, b) => b.record - a.record);
        for (const level of numericLevels) {
          if (studentValueNum >= level.record) return level.grade;
        }
        if (studentValueNum > numericLevels[0].record) {
          return numericLevels[0].grade;
        }
      }
    }
  }

  // 5. ⭐️ [4순위] 어디에도 해당 안 됨 (기준 미달 또는 "F"인데 배점표에 없는 경우)
  if (outOfRangeRule === '최하점') {
    const allScores = numericLevels
      .map(l => Number(l.grade))
      .filter(n => !Number.isNaN(n));
    
    if (allScores.length > 0) {
      const minScore = Math.min(...allScores);
      return String(minScore);
    } else {
      return '0';
    }
  } else {
    // '0점' 처리 (기본값)
    return '0';
  }
}

/**
 * [규칙 3] '배점 등급'을 '최종 점수'로 환산
 */
function convertGradeToScore(grade, U_ID, eventName) {
  // ... (하드코딩 예외 처리) ...
  const score = Number(grade);
  return Number.isNaN(score) ? 0 : score;
}

/**
 * ⭐️ [메인] 실기 점수 계산 함수 (수정됨)
 */
function calculateScore(F, S) {
  // F: 학교정보 (정시반영비율.* + 실기배점 배열)
  // S: 학생정보 (gender, practicals 배열)
  const log = [];
  log.push('========== 실기 계산 시작 ==========');

  const practicalRatio = (Number(F.실기) || 0) / 100;
  if (practicalRatio <= 0) {
    log.push('[패스] 실기 반영 비율 0%');
    return { 
        totalScore: 0, 
        breakdown: { events: [], practical_raw_sum: 0, total_deduction: 0 }, 
        calculationLog: log 
    };
  }

  const SCHOOL_TOTAL = Number(F?.총점) > 0 ? Number(F.총점) : 1000;
  const PRACTICAL_MAX = Number(F.실기총점) || 0; // 예: 400점 만점
  const schoolTotalBaseScore = Number(F.기본점수) || 0;
  const schoolOutOfRangeRule = F.미달처리 || '0점'; 

  const studentGender = S?.gender || '';
  const studentRecords = S?.practicals || [];
  const allScoreData = F?.실기배점 || [];

  log.push(`[정보] 학교총점=${SCHOOL_TOTAL}, 실기만점(DB)=${PRACTICAL_MAX}, 실기비율=${practicalRatio}`);
  log.push(`[정보] 학교기본점수(추가)=${schoolTotalBaseScore}, 미달처리규칙=${schoolOutOfRangeRule}`);


  if (PRACTICAL_MAX <= 0) {
    log.push(`[오류] '정시반영비율.실기총점'이 0입니다. 계산 불가.`);
    return { totalScore: 0, breakdown: {}, calculationLog: log };
  }
  if (studentGender !== '남' && studentGender !== '여') {
    log.push(`[오류] 학생 성별(S.gender)이 '남' 또는 '여'가 아닙니다.`);
    return { totalScore: 0, breakdown: {}, calculationLog: log };
  }

  let rawPracticalSum = 0; // 학생이 받은 실기 점수 총합
  const eventBreakdowns = []; // ⭐️ [신규] 종목별 내역

  studentRecords.forEach((record) => {
    const eventName = record.event;
    const eventValue = record.value;

    const { method } = getEventRules(eventName);
    const scoreTable = allScoreData.filter(
      (r) => r.종목명 === eventName && r.성별 === studentGender
    );

    // ⭐️ [신규] 해당 종목의 배점표 상 만점 찾기
    const eventMaxScore = findMaxScore(scoreTable);
    
    const rawGrade = lookupScore(eventValue, method, scoreTable, schoolOutOfRangeRule);
    const score = convertGradeToScore(rawGrade, F.U_ID, eventName);

    log.push(
      `[${eventName}] (규칙: ${method}) 기록: ${eventValue} → 배점: "${rawGrade}" → 환산: ${score}점 / (종목만점: ${eventMaxScore}점)`
    );
    rawPracticalSum += score;
    
    // ⭐️ [신규] 종목별 상세 내역 저장
    eventBreakdowns.push({
        event: eventName,
        record: eventValue,
        score: score,
        max_score: eventMaxScore,
        deduction: score - eventMaxScore // (예: 90 - 100 = -10)
    });
  });

  log.push(`[결과] 종목 합계: ${rawPracticalSum}점`);
  
  const finalRawScore = rawPracticalSum + schoolTotalBaseScore; // 학생이 받은 최종 원점수 (기본점수 포함)
  log.push(`[조정] 종목 합계(${rawPracticalSum}) + 기본 점수(${schoolTotalBaseScore}) = ${finalRawScore}점`);
  log.push(`[결과] 실기 원점수 합계 (최종): ${finalRawScore} / ${PRACTICAL_MAX}`);

  // ⭐️ [신규] 총 감점 계산 (학생 원점수 - 실기 만점)
  const totalDeduction = finalRawScore - PRACTICAL_MAX; // (예: 380 - 400 = -20)
  log.push(`[결과] 총 감점: ${totalDeduction}점`);

  // 5. 최종 점수 환산
  const rawPracticalTotal = (finalRawScore / PRACTICAL_MAX) * SCHOOL_TOTAL;
  const finalPracticalScore = rawPracticalTotal * practicalRatio;

  log.push('========== 실기 최종 ==========');
  log.push(
    `실기 환산 점수 (총점화) = (${finalRawScore} / ${PRACTICAL_MAX}) * ${SCHOOL_TOTAL} = ${rawPracticalTotal.toFixed(
      3
    )}`
  );
  log.push(
    `실기 최종 점수 (비율 적용) = ${rawPracticalTotal.toFixed(
      3
    )} * ${practicalRatio} = ${finalPracticalScore.toFixed(3)}`
  );

  // ⭐️ [수정] 반환 객체에 상세 내역(breakdown) 추가
  return {
    totalScore: finalPracticalScore.toFixed(3),
    breakdown: { 
        events: eventBreakdowns,
        practical_raw_sum: finalRawScore,
        total_deduction: totalDeduction
    },
    calculationLog: log,
  };
}


// -----------------------------------------------------------------
// ⭐️ [2] 라우터 모듈 (이 부분은 수정 없음)
// -----------------------------------------------------------------
module.exports = (db, authMiddleware) => {

  /**
   * API: POST /silgi/calculate
   */
  router.post('/calculate', authMiddleware, async (req, res) => {
    
    const { F_data, S_data } = req.body;

    if (!F_data || !S_data) {
      return res.status(400).json({ 
        success: false, 
        message: 'F_data (학교정보+배점표)와 S_data (학생정보)가 필요합니다.'
      });
    }

    try {
      // ⭐️ calculateScore가 이제 상세 내역(breakdown)을 포함한 result를 반환
      const silgiResult = calculateScore(F_data, S_data); 
      res.json({
        success: true,
        message: '실기 계산 완료',
        result: silgiResult
      });

    } catch (err) {
      console.error("❌ 실기 계산 API 오류:", err);
      res.status(500).json({ success: false, message: '실기 계산 중 서버 오류' });
    }
  });

  return router; // ⭐️ 라우터를 반환
};
