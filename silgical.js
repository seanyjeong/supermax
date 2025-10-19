// silgical.js (라우터 버전)
const express = require('express');
const router = express.Router();

// -----------------------------------------------------------------
// ⭐️ [1] 기존 계산 로직 (getEventRules, lookupScore 등)은
//       파일 '내부' 헬퍼 함수로 그대로 둠 (exports는 안 함)
// -----------------------------------------------------------------

/**
 * [규칙 1] 종목명으로 기록방식/기본점수 판단
 */
function getEventRules(eventName) {
  // ... (기존 코드와 동일) ...
  const LOW_IS_BETTER_KEYWORDS = [
    '달리기', 'm', 'run', '런', '왕복', '초', '오래',
  ];
  let method = 'higher_is_better';
  let baseScore = 0;
  if (LOW_IS_BETTER_KEYWORDS.some((k) => eventName.includes(k))) {
    method = 'lower_is_better';
  }
  if (eventName.includes('던지기') || eventName.includes('멀리뛰기')) {
    method = 'higher_is_better';
  }
  return { method, baseScore };
}

/**
 * [규칙 2] 학생 기록으로 '배점 등급' 찾기
 */
function lookupScore(studentRecord, method, baseScore, scoreTable) {
  // ... (기존 코드와 동일) ...
  if (!scoreTable || scoreTable.length === 0) {
    return String(baseScore);
  }
  const studentValueStr = String(studentRecord).trim();
  const studentValueNum = Number(studentValueStr);
  const isNumericInput = !Number.isNaN(studentValueNum) && studentValueStr !== '';
  let numericLevels = [];
  let exactMatchLevels = new Map();
  let rangeLevels = [];
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
      exactMatchLevels.set(recordStr, level.배점);
    }
  }
  if (exactMatchLevels.has(studentValueStr)) {
    return exactMatchLevels.get(studentValueStr);
  }
  if (isNumericInput) {
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
  return String(baseScore);
}

/**
 * [규칙 3] '배점 등급'을 '최종 점수'로 환산
 */
function convertGradeToScore(grade, U_ID, eventName) {
  // ... (1% 예외 하드코딩 ... 나중에 DB로 빼도 됨) ...

  // 99% 일반 학교
  const score = Number(grade);
  return Number.isNaN(score) ? 0 : score;
}

/**
 * [메인] 실기 점수 계산 함수 (1단계: 기본 합산)
 */
function calculateScore(F, S) {
  // ... (기존 코드와 동일) ...
  // (F: 학교정보, S: 학생정보)
  const log = [];
  log.push('========== 실기 계산 시작 ==========');
  const practicalRatio = (Number(F.실기) || 0) / 100;
  if (practicalRatio <= 0) {
    log.push('[패스] 실기 반영 비율 0%');
    return { totalScore: 0, breakdown: {}, calculationLog: log };
  }
  const SCHOOL_TOTAL = Number(F?.총점) > 0 ? Number(F.총점) : 1000;
  const PRACTICAL_MAX = Number(F.실기총점) || 0;
  const studentGender = S?.gender || '';
  const studentRecords = S?.practicals || [];
  const allScoreData = F?.실기배점 || [];
  log.push(`[정보] 학교총점=${SCHOOL_TOTAL}, 실기만점(DB)=${PRACTICAL_MAX}, 실기비율=${practicalRatio}`);
  if (PRACTICAL_MAX <= 0) {
    log.push(`[오류] '정시반영비율.실기총점'이 0입니다. 계산 불가.`);
    return { totalScore: 0, breakdown: {}, calculationLog: log };
  }
  if (studentGender !== '남' && studentGender !== '여') {
    log.push(`[오류] 학생 성별(S.gender)이 '남' 또는 '여'가 아닙니다.`);
    return { totalScore: 0, breakdown: {}, calculationLog: log };
  }
  let rawPracticalSum = 0;
  studentRecords.forEach((record) => {
    const eventName = record.event;
    const eventValue = record.value;
    const { method, baseScore } = getEventRules(eventName);
    const scoreTable = allScoreData.filter(
      (r) => r.종목명 === eventName && r.성별 === studentGender
    );
    const rawGrade = lookupScore(eventValue, method, baseScore, scoreTable);
    const score = convertGradeToScore(rawGrade, F.U_ID, eventName);
    log.push(
      `[${eventName}] (규칙: ${method}) 기록: ${eventValue} → 배점: "${rawGrade}" → 환산: ${score}점`
    );
    rawPracticalSum += score;
  });
  log.push(`[결과] 실기 원점수 합계: ${rawPracticalSum} / ${PRACTICAL_MAX}`);
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

// -----------------------------------------------------------------
// ⭐️ [2] jungsical.js 처럼 (db, auth)를 받는 라우터 모듈로 변경
// -----------------------------------------------------------------
module.exports = (db, authMiddleware) => {

  /**
   * ⭐️ API 엔드포인트: POST /calculate
   * (jungsi.js에서 /silgi 로 등록했으니, 최종 주소는 POST /silgi/calculate 가 됨)
   */
  router.post('/calculate', authMiddleware, async (req, res) => {
    
    // 1. 프론트에서 학생 점수(S)와 학교 정보(F)를 POST body로 보냄
    // F 안에는 F.실기배점 (배점표 배열)이 포함되어 있어야 함!
    const { F_data, S_data } = req.body; 

    if (!F_data || !S_data) {
      return res.status(400).json({ 
        success: false, 
        message: 'F_data (학교정보+배점표)와 S_data (학생정보)가 필요합니다.' 
      });
    }

    try {
      // 2. 위에서 만든 내부 계산 함수 '호출'
      const silgiResult = calculateScore(F_data, S_data);

      // 3. 계산 결과를 클라이언트에게 응답
      res.json({
        success: true,
        message: '실기 계산 완료',
        result: silgiResult 
        // (silgiResult 안에는 totalScore, breakdown, calculationLog 가 들어있음)
      });

    } catch (err) {
      console.error("❌ 실기 계산 API 오류:", err);
      res.status(500).json({ success: false, message: '실기 계산 중 서버 오류' });
    }
  });

  // 나중에 실기 배점표 저장 API (POST /silgi/score-table/set) 같은 것도
  // 여기에 추가하면 됨.

  return router; // ⭐️ 라우터를 반환
};
