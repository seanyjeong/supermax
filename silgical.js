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
     'm', 'run', '달리기', '왕복', '초', '벽','지그','z'
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

/**
 * ⭐️ [신규 헬퍼] 배점표에서 해당 종목의 '최고 배점(만점)'을 찾음
 */
function findMaxScore(scoreTable) {
    if (!scoreTable || scoreTable.length === 0) return 0;
    const max = scoreTable
        .map(l => Number(l.배점))
        .filter(n => !Number.isNaN(n))
        .reduce((max, current) => Math.max(max, current), 0);
    return max;
}

/**
 * ⭐️ [신규 헬퍼] "감수" (급간 레벨)를 찾음
 */
function lookupDeductionLevel(studentScore, scoreTable) {
    if (!scoreTable || scoreTable.length === 0) return 0;
    
    // 1. 배점표에서 모든 '배점'을 중복 없이 추출
    const allScores = [...new Set(
        scoreTable
            .map(l => Number(l.배점))
            .filter(n => !Number.isNaN(n))
    )];
    
    // 2. 내림차순 정렬 (예: [100, 98, 96, 94, ...])
    allScores.sort((a, b) => b - a);
    
    // 3. 학생 점수가 이 배열에서 몇 번째 인덱스인지 찾음
    const levelIndex = allScores.indexOf(studentScore);
    
    // (100점 -> 0 (0감), 98점 -> 1 (1감), 96점 -> 2 (2감))
    return (levelIndex === -1) ? 0 : levelIndex; 
}
// ⭐️ 학생 실기기록을 대학 실기배점표와 매칭해서 "종목별 점수 배열"로 돌려주는 헬퍼
function buildPracticalScoreList(studentRecords = [], scoreTable = [], studentGender = '') {
// ▲▲▲▲▲ [수정 1] ▲▲▲▲▲
  
  const out = [];

  for (const rec of studentRecords) {
    const eventName = rec.event || rec.종목명;
    if (!eventName) continue;

    // 이 종목에 해당하는 배점표만 필터
    const tableForEvent = scoreTable.filter(row => {
      // ▼▼▼▼▼ [수정 2] rec.gender 대신 studentGender 사용 ▼▼▼▼▼
      if (studentGender && row.성별 && row.성별 !== studentGender) return false;
      // ▲▲▲▲▲ [수정 2] ▲▲▲▲▲
      return row.종목명 === eventName;
    });

    const { method } = getEventRules(eventName);
    
    // (이전 수정사항) rec.record 또는 rec.value 둘 다 읽기
    const studentRawRecord = rec.record !== undefined ? rec.record : rec.value;
    const score = lookupScore(studentRawRecord, method, tableForEvent, '0점');

    const maxScore = findMaxScore(tableForEvent);

    out.push({
      event: eventName,
      record: studentRawRecord,
      score: Number(score || 0),
      maxScore: Number(maxScore || 100)
    });
  }

  return out;
}


/**
 * ⭐️ [규칙 2] 학생 기록으로 '배점 등급' 찾기
 * (수정) "최소값" 규칙 적용 (달리기)
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
        
        // ⭐️ [수정] "최소값" 규칙 적용 (예: 9.71, 9.61, 9.51 순으로 정렬)
        numericLevels.sort((a, b) => b.record - a.record); 
        for (const level of numericLevels) {
          // ⭐️ [수정] 학생 기록이 DB 기록보다 "크거나 같으면" (더 느리면)
          // (예: 9.6 >= 9.51 (130점) -> true)
          if (studentValueNum >= level.record) return level.grade; 
        }
        // ⭐️ [수정] 배점표 최고 기록(예: 9.51)보다 잘했을 때 (예: 9.50)
        if (studentValueNum < numericLevels[numericLevels.length - 1].record) {
          return numericLevels[numericLevels.length - 1].grade; // 만점
        }

      } else { // higher_is_better (이건 기존 로직 유지)
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
  
  // 5. [4순위] 어디에도 해당 안 됨 (기준 미달)
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
    return '0';
  }
}

/**
 * [규칙 3] '배점 등급'을 '최종 점수'로 환산
 */
function convertGradeToScore(grade, U_ID, eventName) {
  const score = Number(grade);
  return Number.isNaN(score) ? 0 : score;
}
function practicalTopN(list, n, maxScore) {
  if (!list || list.length === 0) return 0;
  const sorted = [...list].sort((a,b) => (b.score || 0) - (a.score || 0));
  const picked = sorted.slice(0, n);
  const sum = picked.reduce((s, r) => s + (r.score || 0), 0);
  // n개 × 100점 기준을 우리가 원하는 maxScore로 스케일
  return (sum / (n * 100)) * maxScore;
}

function practicalAverage(list, maxScore) {
  if (!list || list.length === 0) return 0;
  const avg = list.reduce((s, r) => s + (r.score || 0), 0) / list.length;
  return (avg / 100) * maxScore;
}

function calcPracticalSpecial(F, list, log) { // ⭐️ log 파라미터 추가
  // list 중에서 프론트가 "-"로 보였던 애들(점수 0)은 빼고 계산
  const cleaned = (list || []).filter(it => Number.isFinite(it.score) && it.score > 0);

  const uid = Number(F.U_ID);
  const cfg = typeof F.실기특수설정 === 'string'
    ? JSON.parse(F.실기특수설정)
    : (F.실기특수설정 || {});

  switch (uid) {
    // ↓↓↓ 여기에 네가 원하는 대학 케이스를 계속 추가하면 됨 ↓↓↓

    // ======================================================
    // ⭐️ [신규 추가] ID 2번 학교 (배점 총합 -> 점수 환산)
    // ======================================================
    case 2:
    {
      // (이하 로직 동일...)
      const sumOfScores = cleaned.reduce((sum, item) => sum + (item.score || 0), 0);
      if (sumOfScores >= 286) return 700;
      else if (sumOfScores >= 271) return 691;
      else if (sumOfScores >= 256) return 682;
      else if (sumOfScores >= 241) return 673;
      else if (sumOfScores >= 226) return 664;
      else if (sumOfScores >= 211) return 655;
      else if (sumOfScores >= 196) return 646;
      else if (sumOfScores >= 181) return 637;
      else return 630;
    }
    // ======================================================

    case 1234: // 예: ○○대 - 상위 2종목만, 180점 만점
      return practicalTopN(cleaned, 2, cfg.maxScore || 180);

    case 5678: // 예: △△대 - 전체 평균, 150점 만점
      return practicalAverage(cleaned, cfg.maxScore || 150);

    // ↑↑↑ 여기는 네가 필요한 만큼 케이스 추가 ↑↑↑

    default:
      // special인데도 등록 안 돼 있으면 일단 기본으로라도 돌리기
      // (주의: Special인데 분기 없으면 기본 점수(0) 반환)
      log.push(`[경고] Special 모드 U_ID(${uid})가 분기에 없습니다. 0점을 반환합니다.`);
      return 0; // ⭐️ Special인데 분기 없으면 0점 처리 (Basic으로 빠지면 안 됨)
  }
}

/**
 * ⭐️ [메인] 실기 점수 계산 함수 (수정됨)
 */
function calculateScore(F, S_original) {
  const log = [];
  log.push('========== 실기 계산 시작 ==========');

  // --- 1. S_data 포맷 어댑터 (신/구형식 호환) ---
  let S = S_original;
  if (S && !S.gender && S.practicals && Array.isArray(S.practicals) && S.practicals.length > 0) {
    log.push('[어댑터] S_data.gender가 없어 구형 포맷으로 간주. 변환 시도...');
    const oldPracticals = S.practicals;
    const firstRecord = oldPracticals[0];
    const detectedGender = firstRecord.gender;
    if (detectedGender === '남' || detectedGender === '여') {
      const newPracticals = oldPracticals.map(p => ({
        event: p.event,
        value: p.record !== undefined ? p.record : p.value
      }));
      S = { gender: detectedGender, practicals: newPracticals };
      log.push(`[어댑터] 변환 완료. Gender: ${S.gender}, Records: ${S.practicals.length}건`);
    } else {
      log.push(`[어댑터] 변환 실패: 구형 practicals 배열에서 gender ('남'/'여')를 찾을 수 없습니다.`);
      S = { gender: '', practicals: [] };
    }
  } else if (!S) {
    log.push('[오류] S_data가 null 또는 undefined입니다.');
    S = { gender: '', practicals: [] };
  }
  // --- 어댑터 끝 ---
  
  const mode = F.실기모드 || 'basic';
  log.push(`[정보] 실기 모드: ${mode}`);

  const studentGender = S?.gender || '';
  const studentRecords = S?.practicals || [];
  const allScoreData = F?.실기배점 || [];

  // --- 2. 모드 분기 ---

  // ▼▼▼▼▼ [Special 로직 수정] ▼▼▼▼▼
  if (mode === 'special') {
    log.push(`[Special] 'special' 모드 실행...`);
    
    // ⭐️ 1. 'Basic' 로직에서 `eventBreakdowns` 계산 로직을 그대로 가져옴
    const eventBreakdowns = []; // 감수 포함, 'score'만 있는 객체 배열
    const schoolOutOfRangeRule = F.미달처리 || '0점'; // Special 모드도 미달처리 규칙 필요
    
    studentRecords.forEach((record) => {
      const eventName = record.event;
      const eventValue = String(record.value || '').trim();

      if (eventValue === '') {
        log.push(`[${eventName}] 기록 없음. 계산 보류.`);
        eventBreakdowns.push({
          event: eventName,
          record: '',
          score: null,
          deduction_level: null // ⭐️ 감수 필드
        });
        return;
      }

      const { method } = getEventRules(eventName);
      const scoreTable = allScoreData.filter(
        (r) => r.종목명 === eventName && r.성별 === studentGender
      );

      const rawGrade = lookupScore(eventValue, method, scoreTable, schoolOutOfRangeRule);
      const score = convertGradeToScore(rawGrade, F.U_ID, eventName);
      
      // ⭐️ 핵심: Special 모드에서도 감수 계산
      const deductionLevel = lookupDeductionLevel(score, scoreTable); 
      
      log.push(
        `[${eventName}] (규칙: ${method}) 기록: ${eventValue} → 배점: "${rawGrade}"(환산: ${score}점) → ⭐️급간(감수): ${deductionLevel}감`
      );
      
      eventBreakdowns.push({
          event: eventName,
          record: eventValue,
          score: score, // ⭐️ 'score' (e.g., 100점)
          deduction_level: deductionLevel // ⭐️ 'deduction_level' (e.g., 0감)
      });
    });
    // ⭐️ 1. 계산 끝: eventBreakdowns가 'Basic'처럼 완벽하게 채워짐
    
    // 2. ⭐️ 특수 총점 계산: calcPracticalSpecial에는 이 풍부한 `eventBreakdowns` 배열을 전달
    // (calcPracticalSpecial 함수는 내부적으로 `item.score`만 사용하므로 수정할 필요 없음)
    const finalPracticalScore = calcPracticalSpecial(F, eventBreakdowns, log);
    
    log.push('========== 실기 최종 ==========');
    log.push(`'special' 모드 계산 최종 총점: ${finalPracticalScore}`); // 예: 700점
    
    // 3. ⭐️ 반환: totalScore는 특수 점수(700)를, breakdown.events는 감수가 포함된 `eventBreakdowns`를 반환
    return {
      totalScore: finalPracticalScore.toFixed(3), // ⭐️ 700.000
      breakdown: { 
          events: eventBreakdowns, // ⭐️ [{ event: '제멀', score: 100, deduction_level: 0 }, ...]
          practical_raw_sum: finalPracticalScore, 
          total_deduction_level: 0 // 'special'은 총 감수는 0으로 고정 (totalScore에 영향 안 줌)
      },
      calculationLog: log,
    };
    // ▲▲▲▲▲ [Special 로직 수정 끝] ▲▲▲▲▲

  } else {
    // ⭐️ [Basic 로직] ⭐️ (수정 없음, 그대로 둠)
    
    log.push(`[Basic] 'basic' 모드(기존 로직) 실행...`);
    
    const practicalRatio = (Number(F.실기) || 0) / 100;
    if (practicalRatio <= 0) {
      log.push('[패스] 실기 반영 비율 0%');
      return { totalScore: 0, breakdown: { events: [], practical_raw_sum: 0, total_deduction_level: 0 }, calculationLog: log };
    }

    const SCHOOL_TOTAL = Number(F?.총점) > 0 ? Number(F.총점) : 1000;
    const PRACTICAL_MAX = Number(F.실기총점) || 0;
    const schoolTotalBaseScore = Number(F.기본점수) || 0;
    const schoolOutOfRangeRule = F.미달처리 || '0점';

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

    let rawPracticalSum = 0;
    const eventBreakdowns = [];
    let totalDeductionLevel = 0;

    studentRecords.forEach((record) => {
      const eventName = record.event;
      const eventValue = String(record.value || '').trim();

      if (eventValue === '') {
        log.push(`[${eventName}] 기록 없음. 계산 보류.`);
        eventBreakdowns.push({
          event: eventName,
          record: '',
          score: null,
          deduction_level: null
        });
        return;
      }

      const { method } = getEventRules(eventName);
      const scoreTable = allScoreData.filter(
        (r) => r.종목명 === eventName && r.성별 === studentGender
      );

      const rawGrade = lookupScore(eventValue, method, scoreTable, schoolOutOfRangeRule);
      const score = convertGradeToScore(rawGrade, F.U_ID, eventName);
      
      const deductionLevel = lookupDeductionLevel(score, scoreTable);
      
      log.push(
        `[${eventName}] (규칙: ${method}) 기록: ${eventValue} → 배점: "${rawGrade}"(환산: ${score}점) → ⭐️급간(감수): ${deductionLevel}감`
      );
      rawPracticalSum += score;
      totalDeductionLevel += deductionLevel;
      
      eventBreakdowns.push({
          event: eventName,
          record: eventValue,
          score: score,
          deduction_level: deductionLevel
      });
    });

    log.push(`[결과] 종목 합계: ${rawPracticalSum}점`);
    
    const finalRawScore = rawPracticalSum + schoolTotalBaseScore;
    log.push(`[조정] 종목 합계(${rawPracticalSum}) + 기본 점수(${schoolTotalBaseScore}) = ${finalRawScore}점`);
    log.push(`[결과] 실기 원점수 합계 (최종): ${finalRawScore} / ${PRACTICAL_MAX}`);
    log.push(`[결과] ⭐️ 총 감수 (레벨 합): ${totalDeductionLevel}감`);

    const rawPracticalTotal = (finalRawScore / PRACTICAL_MAX) * SCHOOL_TOTAL;
    const finalPracticalScore = rawPracticalTotal * practicalRatio;

    log.push('========== 실기 최종 ==========');
    log.push(
      `실기 환산 점수 (총점화) = (${finalRawScore} / ${PRACTICAL_MAX}) * ${SCHOOL_TOTAL} = ${rawPracticalTotal.toFixed(3)}`
    );
    log.push(
      `실기 최종 점수 (비율 적용) = ${rawPracticalTotal.toFixed(3)} * ${practicalRatio} = ${finalPracticalScore.toFixed(3)}`
    );

    return {
      totalScore: finalPracticalScore.toFixed(3),
      breakdown: { 
          events: eventBreakdowns,
          practical_raw_sum: finalRawScore,
          total_deduction_level: totalDeductionLevel
      },
      calculationLog: log,
    };
  }
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
module.exports.buildPracticalScoreList = buildPracticalScoreList;
module.exports.findMaxScore = findMaxScore;
