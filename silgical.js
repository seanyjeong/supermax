// silgical.js (라우터 버전)
const express = require('express');
const router = express.Router();

/* -----------------------------------------------------------------
 * [1] 내부 헬퍼 함수들
 * ----------------------------------------------------------------- */

/**
 * [규칙 1] 종목명으로 기록방식 판단
 */
function getEventRules(eventName) {
  eventName = eventName || '';
  const LOW_IS_BETTER_KEYWORDS = [
    'm', 'run', '달리기', '왕복', '초', '벽', '지그', 'z'
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
 * ⭐️ 배점표에서 해당 종목의 '최고 배점(만점)'을 찾음
 */
function findMaxScore(scoreTable) {
  if (!scoreTable || scoreTable.length === 0) return 0;
  const max = scoreTable
    .map((l) => Number(l.배점))
    .filter((n) => !Number.isNaN(n))
    .reduce((m, cur) => Math.max(m, cur), 0);
  return max;
}

/**
 * ⭐️ 배점표에서 'F', 'P' 등을 제외한 '순수 숫자 최하점'을 찾음
 * (예: [100, 90, ..., 30] 과 {'F': 0}이 섞여있어도 '30'을 반환)
 */
function findMinScore(scoreTable) {
  if (!scoreTable || scoreTable.length === 0) return '0';

  const keywordsToIgnore = ['F', 'G', '미응시', '파울', '실격', 'P', 'PASS'];
  const allScores = [];

  for (const level of scoreTable) {
    const recordStr = String(level.기록).trim().toUpperCase();

    // F, G, P 같은 건 최하점 계산에서 제외
    if (keywordsToIgnore.includes(recordStr)) {
      continue;
    }

    const score = Number(level.배점);
    if (!Number.isNaN(score)) {
      allScores.push(score);
    }
  }

  if (allScores.length > 0) {
    return String(Math.min(...allScores));
  } else {
    return '0';
  }
}

/**
 * ⭐️ "감수" (급간 레벨)을 찾음
 *   - 100점 → 0감, 98점 → 1감 ...
 */
function lookupDeductionLevel(studentScore, scoreTable) {
  if (!scoreTable || scoreTable.length === 0) return 0;

  const allScores = [...new Set(
    scoreTable
      .map((l) => Number(l.배점))
      .filter((n) => !Number.isNaN(n))
  )];

  allScores.sort((a, b) => b - a);

  const studentScoreNum = Number(studentScore);
  if (Number.isNaN(studentScoreNum)) return 0;

  const levelIndex = allScores.indexOf(studentScoreNum);
  return levelIndex === -1 ? 0 : levelIndex;
}

/**
 * ⭐️ 학생 실기기록을 대학 실기배점표와 매칭해서 "종목별 점수 배열"로 돌려주는 헬퍼
 * (다른 곳에서 활용하는 용도)
 */
function buildPracticalScoreList(studentRecords = [], scoreTable = [], studentGender = '') {
  const out = [];

  for (const rec of studentRecords) {
    const eventName = rec.event || rec.종목명;
    if (!eventName) continue;

    const tableForEvent = scoreTable.filter((row) => {
      if (studentGender && row.성별 && row.성별 !== studentGender) return false;
      return row.종목명 === eventName;
    });

    const { method } = getEventRules(eventName);
    const studentRawRecord = rec.record !== undefined ? rec.record : rec.value;

    const score = lookupScore(studentRawRecord, method, tableForEvent, '0점');
    const maxScore = findMaxScore(tableForEvent);

    out.push({
      event: eventName,
      record: studentRawRecord,
      score: Number(score || 0),
      maxScore: Number(maxScore || 100),
    });
  }

  return out;
}

/**
 * [규칙 2] 학생 기록으로 '배점 등급' 찾기
 *  - F/G/미응시 등은 최하점 처리
 */
function lookupScore(studentRecord, method, scoreTable, outOfRangeRule) {
  if (!scoreTable || scoreTable.length === 0) {
    return '0';
  }

  const studentValueStr = String(studentRecord).trim().toUpperCase();

  const FORCE_MIN_SCORE_KEYWORDS = ['F', 'G', '미응시', '파울', '실격'];
  if (FORCE_MIN_SCORE_KEYWORDS.includes(studentValueStr)) {
    return findMinScore(scoreTable);
  }

  const studentValueNum = Number(studentValueStr);
  const isNumericInput = !Number.isNaN(studentValueNum) && studentValueStr !== '';

  let numericLevels = [];
  const exactMatchLevels = new Map();
  const rangeLevels = [];

  for (const level of scoreTable) {
    const recordStr = String(level.기록).trim();
    const recordNum = Number(recordStr);

    if (!Number.isNaN(recordNum) && recordStr !== '') {
      numericLevels.push({ record: recordNum, grade: level.배점 });
    } else if (
      recordStr.includes('이상') ||
      recordStr.includes('이하') ||
      recordStr.includes('초과') ||
      recordStr.includes('미만')
    ) {
      rangeLevels.push({ rangeStr: recordStr, grade: level.배점 });
    } else {
      exactMatchLevels.set(recordStr.toUpperCase(), level.배점);
    }
  }

  // 1순위: 문자(P/F 등) 일치
  if (exactMatchLevels.has(studentValueStr)) {
    return exactMatchLevels.get(studentValueStr);
  }

  if (isNumericInput) {
    // 2순위: "200 이상" 같은 범위
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

    // 3순위: 단순 숫자 비교
    if (numericLevels.length > 0) {
      if (method === 'lower_is_better') {
        numericLevels.sort((a, b) => b.record - a.record);
        for (const level of numericLevels) {
          if (studentValueNum >= level.record) return level.grade;
        }
        if (studentValueNum < numericLevels[numericLevels.length - 1].record) {
          return numericLevels[numericLevels.length - 1].grade;
        }
      } else {
        numericLevels.sort((a, b) => b.record - a.record);
        for (const level of numericLevels) {
          if (studentValueNum >= level.record) return level.grade;
        }
        if (numericLevels.length > 0) {
          return numericLevels[numericLevels.length - 1].grade;
        }
      }
    }
  }

  // 4순위: 어디에도 안 맞는 문자 등
  if (outOfRangeRule === '최하점') {
    return findMinScore(scoreTable);
  } else {
    return '0';
  }
}

/**
 * [규칙 3] '배점 등급'을 '최종 점수'로 환산
 *  - 숫자이면 그대로
 *  - P / PASS → 100
 *  - NP / N / FAIL → 0
 */
function convertGradeToScore(grade, U_ID, eventName) {
  const g = String(grade).toUpperCase();

  if (g === 'P' || g === 'PASS') return 100;
  if (g === 'NP' || g === 'N' || g === 'FAIL') return 0;

  const score = Number(grade);
  return Number.isNaN(score) ? 0 : score;
}

/* ---- 실기 합산용 헬퍼들 ---- */

function practicalTopN(list, n, maxScore) {
  if (!list || list.length === 0) return 0;
  const sorted = [...list].sort((a, b) => (b.score || 0) - (a.score || 0));
  const picked = sorted.slice(0, n);
  const sum = picked.reduce((s, r) => s + (r.score || 0), 0);
  return (sum / (n * 100)) * maxScore;
}

function practicalAverage(list, maxScore) {
  if (!list || list.length === 0) return 0;
  const avg = list.reduce((s, r) => s + (r.score || 0), 0) / list.length;
  return (avg / 100) * maxScore;
}

/**
 * [규칙 4] Special 모드 대학 계산
 */
function calcPracticalSpecial(F, list, log, studentGender) {
  const uid = Number(F.U_ID);
  const cfg =
    typeof F.실기특수설정 === 'string'
      ? JSON.parse(F.실기특수설정)
      : F.실기특수설정 || {};

  /* ======================================================
   * ID 13번 학교 (수동 공식 계산)
   * ====================================================== */
  if (uid === 13) {
    log.push(`[Special-Case 13] 수동 공식 계산 시작 (Gender: ${studentGender})`);

    if (studentGender !== '남' && studentGender !== '여') {
      log.push(`[오류] 성별 정보 없음. 0점 반환.`);
      return 0;
    }

    const standards = {
      배근력: { 남: { min: 130, max: 220 }, 여: { min: 60, max: 151 } },
      좌전굴: { 남: { min: 11.9, max: 30 }, 여: { min: 13.9, max: 32 } },
      제자리멀리뛰기: { 남: { min: 254, max: 300 }, 여: { min: 199, max: 250 } },
      중량메고달리기: { 남: { min: 9.9, max: 7.19 }, 여: { min: 10.9, max: 7.6 } },
    };

    let totalScore = 0;

    for (const item of list) {
      const eventName = item.event;
      const std = standards[eventName]?.[studentGender];
      const record = parseFloat(item.record);

      if (!std || isNaN(record)) {
        log.push(
          `[Special-Case 13] ${eventName}: 기록(${item.record})이 없거나 숫자가 아님. 0점 처리.`
        );
        item.score = 0;
        item.deduction_level = 0;
        continue;
      }

      let eventScoreRaw = 0;
      const min = std.min;
      const max = std.max;

      let cappedRecord = record;
      const isLowerBetter = max < min;

      if (isLowerBetter) {
        if (record < max) cappedRecord = max;
        if (record > min) cappedRecord = min;
      } else {
        if (record > max) cappedRecord = max;
        if (record < min) cappedRecord = min;
      }

      if (max - min === 0) {
        eventScoreRaw = 0;
      } else {
        eventScoreRaw = ((cappedRecord - min) / (max - min)) * 100;
      }

      const eventScore = Math.round(eventScoreRaw * 100) / 100;

      item.score = eventScore;
      item.deduction_level = 0;

      log.push(
        `[Special-Case 13] ${eventName}: (기록 ${record} -> ${cappedRecord}) → ${eventScore.toFixed(
          2
        )}점 (0감)`
      );

      totalScore += eventScore;
    }

    const finalTotalScore = Math.round(totalScore * 100) / 100;
    log.push(
      `[Special-Case 13] 최종 합산 점수: ${finalTotalScore.toFixed(
        2
      )} (반올림 전: ${totalScore})`
    );
    return finalTotalScore;
  }

  /* ---- 공통용 scoreMap / cleaned / sumOfAllScores ---- */
  const scoreMap = new Map();
  for (const item of list) {
    scoreMap.set(item.event, item.score || 0);
  }

  const cleaned = (list || []).filter(
    (it) => Number.isFinite(it.score) && it.score > 0
  );

  const sumOfAllScores = Array.from(scoreMap.values()).reduce(
    (sum, score) => sum + score,
    0
  );

  switch (uid) {
    /* ======================================================
     * ID 2번 학교
     * ====================================================== */
    case 2: {
      const sumOfScores = cleaned.reduce(
        (sum, item) => sum + (item.score || 0),
        0
      );
      let lookedUpScore;
      if (sumOfScores >= 286) lookedUpScore = 700;
      else if (sumOfScores >= 271) lookedUpScore = 691;
      else if (sumOfScores >= 256) lookedUpScore = 682;
      else if (sumOfScores >= 241) lookedUpScore = 673;
      else if (sumOfScores >= 226) lookedUpScore = 664;
      else if (sumOfScores >= 211) lookedUpScore = 655;
      else if (sumOfScores >= 196) lookedUpScore = 646;
      else if (sumOfScores >= 181) lookedUpScore = 637;
      else lookedUpScore = 630;

      log.push(
        `[Special-Case 2] 배점 합(${sumOfScores}) -> 환산 점수(${lookedUpScore})`
      );
      return lookedUpScore;
    }

    /* ======================================================
     * ID 3번 학교
     * ====================================================== */
    case 3: {
      const sumOfScores = cleaned.reduce(
        (sum, item) => sum + (item.score || 0),
        0
      );
      log.push(`[Special-Case 3] 배점 합(${sumOfScores}) + 기본점수(1)`);
      return sumOfScores + 1;
    }

    /* ======================================================
     * ID 17번 학교 (가중치 합산 1)
     * ====================================================== */
    case 17: {
      const runScore = scoreMap.get('10m왕복달리기') || 0;
      const jumpScore = scoreMap.get('제자리멀리뛰기') || 0;
      const situpScore = scoreMap.get('윗몸일으키기') || 0;

      const totalScore =
        runScore * 5.6 + jumpScore * 5.6 + situpScore * 4.8;

      log.push(
        `[Special-Case 17] (10m왕복 ${runScore}점 * 5.6) + (제멀 ${jumpScore}점 * 5.6) + (윗몸 ${situpScore}점 * 4.8)`
      );
      log.push(`[Special-Case 17] 최종 합산 점수: ${totalScore.toFixed(3)}`);
      return totalScore;
    }

    /* ======================================================
     * ID 16번 학교 (가중치 합산 2)
     * ====================================================== */
    case 16: {
      const runScore = scoreMap.get('10m왕복달리기') || 0;
      const jumpScore = scoreMap.get('제자리멀리뛰기') || 0;
      const situpScore = scoreMap.get('윗몸일으키기') || 0;

      const totalScore =
        runScore * 9.8 + jumpScore * 9.8 + situpScore * 8.4;

      log.push(
        `[Special-Case 16] (10m왕복 ${runScore}점 * 9.8) + (제멀 ${jumpScore}점 * 9.8) + (윗몸 ${situpScore}점 * 8.4)`
      );
      log.push(`[Special-Case 16] 최종 합산 점수: ${totalScore.toFixed(3)}`);
      return totalScore;
    }

    /* ======================================================
     * ID 19번 학교
     * ====================================================== */
    case 19: {
      const sumOfScores = cleaned.reduce(
        (sum, item) => sum + (item.score || 0),
        0
      );
      log.push(`[Special-Case 19] 배점 합(${sumOfScores}) + 기본점수(2)`);
      return sumOfScores + 2;
    }

    /* ======================================================
     * ID 69, 70번 학교 (평균 × 4 + 기본점수 400)
     * ====================================================== */
    case 69:
    case 70: {
      const avg = sumOfAllScores / 3;
      const totalScore = avg * 4 + 400;

      log.push(
        `[Special-Case ${uid}] (전체 합산 ${sumOfAllScores}점 / 3) * 4 + 400`
      );
      log.push(
        `[Special-Case ${uid}] 최종 합산 점수: ${totalScore.toFixed(3)}`
      );
      return totalScore;
    }

    /* ======================================================
     * ID 99, 147 (상위 3종목, 800점 만점)
     * ====================================================== */
    case 99:
    case 147: {
      const finalScore = practicalTopN(cleaned, 3, 800);
      log.push(`[Special-Case ${uid}] 상위 3종목 합산 (800점 만점 환산)`);
      log.push(
        `[Special-Case ${uid}] 최종 점수: ${finalScore.toFixed(3)}`
      );
      return finalScore;
    }

    /* ======================================================
     * ID 146 (상위 3종목, 400점 만점)
     * ====================================================== */
    case 146: {
      const finalScore = practicalTopN(cleaned, 3, 400);
      log.push(`[Special-Case 146] 상위 3종목 합산 (400점 만점 환산)`);
      log.push(
        `[Special-Case 146] 최종 점수: ${finalScore.toFixed(3)}`
      );
      return finalScore;
    }

    /* ======================================================
     * ID 121번 학교: (100 * P개수) + 200
     *  - list[i].rawGrade 가 P / NP 로 들어옴
     * ====================================================== */
    case 121: {
      let passCount = 0;

      for (const item of list || []) {
        const gradeStr = String(item.rawGrade || '').toUpperCase();
        if (gradeStr === 'P' || gradeStr === 'PASS') {
          passCount++;
        }
      }

      const totalScore = 100 * passCount + 200;
      log.push(
        `[Special-Case 121] PASS 종목 수: ${passCount}개 → (100 * ${passCount}) + 200 = ${totalScore}`
      );
      return totalScore;
    }

    /* 예시: 상위 2종목만, 180점 만점 */
    case 1234:
      return practicalTopN(cleaned, 2, cfg.maxScore || 180);

    /* 예시: 전체 평균, 150점 만점 */
    case 5678:
      return practicalAverage(cleaned, cfg.maxScore || 150);

    default:
      log.push(
        `[경고] Special 모드 U_ID(${uid})가 분기에 없습니다. 0점을 반환합니다.`
      );
      return 0;
  }
}

/**
 * ⭐️ [메인] 실기 점수 계산 함수
 */
function calculateScore(F, S_original) {
  const log = [];
  log.push('========== 실기 계산 시작 ==========');

  /* --- S_data 포맷 어댑터 (신/구 형식 호환) --- */
  let S = S_original;
  if (
    S &&
    !S.gender &&
    S.practicals &&
    Array.isArray(S.practicals) &&
    S.practicals.length > 0
  ) {
    log.push('[어댑터] S_data.gender가 없어 구형 포맷으로 간주. 변환 시도...');
    const oldPracticals = S.practicals;
    const firstRecord = oldPracticals[0];
    const detectedGender = firstRecord.gender;
    if (detectedGender === '남' || detectedGender === '여') {
      const newPracticals = oldPracticals.map((p) => ({
        event: p.event,
        value: p.record !== undefined ? p.record : p.value,
      }));
      S = { gender: detectedGender, practicals: newPracticals };
      log.push(
        `[어댑터] 변환 완료. Gender: ${S.gender}, Records: ${S.practicals.length}건`
      );
    } else {
      log.push(
        `[어댑터] 변환 실패: practicals 배열에서 gender('남'/'여')를 찾을 수 없음.`
      );
      S = { gender: '', practicals: [] };
    }
  } else if (!S) {
    log.push('[오류] S_data가 null 또는 undefined입니다.');
    S = { gender: '', practicals: [] };
  }

  const mode = F.실기모드 || 'basic';
  log.push(`[정보] 실기 모드: ${mode}`);

  const studentGender = S?.gender || '';
  const studentRecords = S?.practicals || [];
  const allScoreData = F?.실기배점 || [];

  /* ------------------ Special 모드 ------------------ */
  if (mode === 'special') {
    log.push(`[Special] 'special' 모드 실행...`);

    const eventBreakdowns = [];
    const schoolOutOfRangeRule = F.미달처리 || '0점';

    studentRecords.forEach((record) => {
      const eventName = record.event;
      const eventValue = String(record.value || '').trim();

      if (eventValue === '') {
        log.push(`[${eventName}] 기록 없음. 계산 보류.`);
        eventBreakdowns.push({
          event: eventName,
          record: '',
          score: null,
          rawGrade: null,
          deduction_level: null,
        });
        return;
      }

      const { method } = getEventRules(eventName);
      const scoreTable = allScoreData.filter(
        (r) => r.종목명 === eventName && r.성별 === studentGender
      );

      let rawGrade;
      let score;
      let deductionLevel = 0;

      // 🔥 U_ID = 121 전용 PASS/NP 처리
      if (Number(F.U_ID) === 121) {
        const studentNum = Number(eventValue);
        let pass = false;

        if (!Number.isNaN(studentNum) && scoreTable.length > 0) {
          const threshold = Number(scoreTable[0].기록); // DB 기준값
          if (!Number.isNaN(threshold)) {
            if (method === 'lower_is_better') {
              pass = studentNum <= threshold;
            } else {
              pass = studentNum >= threshold;
            }
          }
        }

        rawGrade = pass ? 'P' : 'NP';
        score = convertGradeToScore(rawGrade, F.U_ID, eventName); // P→100, NP→0
        deductionLevel = 0;

        log.push(
          `[121전용] ${eventName}: 기준 ${scoreTable[0]?.기록} / 학생기록 ${eventValue} → ${rawGrade}(${score}점)`
        );
      } else {
        // ✅ 다른 학교는 기존 special 로직
        rawGrade = lookupScore(
          eventValue,
          method,
          scoreTable,
          schoolOutOfRangeRule
        );
        score = convertGradeToScore(rawGrade, F.U_ID, eventName);
        deductionLevel = lookupDeductionLevel(score, scoreTable);

        log.push(
          `[${eventName}] (규칙: ${method}) 기록: ${eventValue} → 배점: "${rawGrade}"(환산: ${score}점) → ⭐️급간(감수): ${deductionLevel}감`
        );
      }

      eventBreakdowns.push({
        event: eventName,
        record: eventValue,
        score: score,
        rawGrade: rawGrade,
        deduction_level: deductionLevel,
      });
    });

    const finalPracticalScore = calcPracticalSpecial(
      F,
      eventBreakdowns,
      log,
      studentGender
    );

    log.push('========== 실기 최종 ==========');
    log.push(`'special' 모드 계산 최종 총점: ${finalPracticalScore}`);

    return {
      totalScore: finalPracticalScore.toFixed(3),
      breakdown: {
        events: eventBreakdowns,
        practical_raw_sum: finalPracticalScore,
        total_deduction_level: 0,
      },
      calculationLog: log,
    };
  }

  /* ------------------ Basic 모드 ------------------ */

  log.push(`[Basic] 'basic' 모드(신규 로직) 실행...`);

  const PRACTICAL_MAX = Number(F.실기총점) || 0;
  const schoolTotalBaseScore = Number(F.기본점수) || 0;
  const schoolOutOfRangeRule = F.미달처리 || '0점';

  log.push(
    `[정보] 실기총점(목표 만점)=${PRACTICAL_MAX}, 기본점수(추가)=${schoolTotalBaseScore}`
  );

  if (studentGender !== '남' && studentGender !== '여') {
    log.push(`[오류] 학생 성별(S.gender)이 '남' 또는 '여'가 아닙니다.`);
    return { totalScore: 0, breakdown: {}, calculationLog: log };
  }

  let rawPracticalSum = 0;
  let scoreTableMaxSum = 0;
  const eventBreakdowns = [];
  let totalDeductionLevel = 0;

  studentRecords.forEach((record) => {
    const eventName = record.event;
    const eventValue = String(record.value || '').trim();

    const scoreTable = allScoreData.filter(
      (r) => r.종목명 === eventName && r.성별 === studentGender
    );

    const eventMaxScore = findMaxScore(scoreTable);
    scoreTableMaxSum += eventMaxScore;
    log.push(
      `[정보] ${eventName} 배점표 만점: ${eventMaxScore}점 (누적 배점표 만점: ${scoreTableMaxSum}점)`
    );

    if (eventValue === '') {
      log.push(`[${eventName}] 기록 없음. 계산 보류.`);
      eventBreakdowns.push({
        event: eventName,
        record: '',
        score: null,
        deduction_level: null,
      });
      return;
    }

    const { method } = getEventRules(eventName);

    const rawGrade = lookupScore(
      eventValue,
      method,
      scoreTable,
      schoolOutOfRangeRule
    );
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
      deduction_level: deductionLevel,
    });
  });

  log.push(`[결과] 종목 합계: ${rawPracticalSum}점`);

  if (scoreTableMaxSum <= 0) {
    log.push(
      `[오류] 배점표 만점 합계(${scoreTableMaxSum})가 0입니다. 계산 불가.`
    );
    return {
      totalScore: schoolTotalBaseScore.toFixed(3),
      breakdown: {
        events: eventBreakdowns,
        practical_raw_sum: schoolTotalBaseScore,
        total_deduction_level: totalDeductionLevel,
      },
      calculationLog: log,
    };
  }

  const finalRawScore = rawPracticalSum + schoolTotalBaseScore;
  log.push(
    `[조정] 종목 합계(${rawPracticalSum}) + 기본 점수(${schoolTotalBaseScore}) = ${finalRawScore}점`
  );
  log.push(
    `[결과] 실기 원점수 합계 (최종): ${finalRawScore} / ${scoreTableMaxSum}`
  );
  log.push(`[결과] ⭐️ 총 감수 (레벨 합): ${totalDeductionLevel}감`);

  const finalPracticalScore =
    (finalRawScore / scoreTableMaxSum) * PRACTICAL_MAX;

  log.push('========== 실기 최종 ==========');
  log.push(
    `실기 환산 점수 = (학생 원점수 ${finalRawScore} / 배점표 만점 ${scoreTableMaxSum}) * 실기총점(DB) ${PRACTICAL_MAX}`
  );
  log.push(`실기 최종 점수: ${finalPracticalScore.toFixed(3)}`);

  return {
    totalScore: finalPracticalScore.toFixed(3),
    breakdown: {
      events: eventBreakdowns,
      practical_raw_sum: finalPracticalScore,
      total_deduction_level: totalDeductionLevel,
    },
    calculationLog: log,
  };
}

/* -----------------------------------------------------------------
 * [2] 라우터 모듈
 * ----------------------------------------------------------------- */

module.exports = (db, authMiddleware) => {
  /**
   * API: POST /silgi/calculate
   */
  router.post('/calculate', authMiddleware, async (req, res) => {
    const { F_data, S_data } = req.body;

    if (!F_data || !S_data) {
      return res.status(400).json({
        success: false,
        message:
          'F_data (학교정보+배점표)와 S_data (학생정보)가 필요합니다.',
      });
    }

    try {
      const silgiResult = calculateScore(F_data, S_data);
      res.json({
        success: true,
        message: '실기 계산 완료',
        result: silgiResult,
      });
    } catch (err) {
      console.error('❌ 실기 계산 API 오류:', err);
      res
        .status(500)
        .json({ success: false, message: '실기 계산 중 서버 오류' });
    }
  });

  return router;
};

// 헬퍼들 외부에서도 쓰려고 export
module.exports.buildPracticalScoreList = buildPracticalScoreList;
module.exports.findMaxScore = findMaxScore;
module.exports.findMinScore = findMinScore;
