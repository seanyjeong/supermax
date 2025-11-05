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
 * ⭐️ [신규 헬퍼] 배점표에서 'F', 'P' 등을 제외한 '순수 숫자 최하점'을 찾음
 * (예: [100, 90, ..., 30] 과 {'F': 0}이 섞여있어도 '30'을 반환)
 */
function findMinScore(scoreTable) {
    if (!scoreTable || scoreTable.length === 0) return '0';
    
    // 최하점 계산 시 무시할 '기록' 키워드 (e.g., 'F', 'P'는 점수가 아님)
    const keywordsToIgnore = ['F', 'G', '미응시', '파울', '실격', 'P', 'PASS'];
    const allScores = [];

    for (const level of scoreTable) {
        const recordStr = String(level.기록).trim().toUpperCase();
        
        // ⭐️ 'F' 같이 무시할 키워드 '기록'을 가진 항목은 최하점 계산에서 제외
        if (keywordsToIgnore.includes(recordStr)) {
            continue;
        }
        
        // ⭐️ '기록'이 숫자인 항목 (e.g. 254) 또는
        // ⭐️ '기록'이 A,B,C 등급인 항목 (e.g. 'E')의 '배점'만 추출
        const score = Number(level.배점);
        if (!Number.isNaN(score)) {
            allScores.push(score);
        }
    }

    if (allScores.length > 0) {
        // [100, 90, 80, ..., 30] 중에서 최하점 '30'을 찾아 반환
        return String(Math.min(...allScores));
    } else {
        return '0'; // 배점표에 숫자 점수가 아예 없으면 0점
    }
}


/**
 * ⭐️ [신규 헬퍼] "감수" (급간 레벨)을 찾음
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
  
  const out = [];

  for (const rec of studentRecords) {
    const eventName = rec.event || rec.종목명;
    if (!eventName) continue;

    // 이 종목에 해당하는 배점표만 필터
    const tableForEvent = scoreTable.filter(row => {
      if (studentGender && row.성별 && row.성별 !== studentGender) return false;
      return row.종목명 === eventName;
    });

    const { method } = getEventRules(eventName);
    
    // (이전 수정사항) rec.record 또는 rec.value 둘 다 읽기
    const studentRawRecord = rec.record !== undefined ? rec.record : rec.value;
    
    const score = lookupScore(studentRawRecord, method, tableForEvent, '0점'); // ⭐️ 원본 유지 (혹시 다른 곳에서 쓸까봐)

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
 * (수정) 'F', 'G' 등이 들어오면 '최하점' 헬퍼 즉시 호출
 * (수정) higher_is_better에서 numericLevels가 비어있을 때 에러 수정
 */
function lookupScore(studentRecord, method, scoreTable, outOfRangeRule) {
  // 1. 배점표가 아예 없으면 0점
  if (!scoreTable || scoreTable.length === 0) {
    return '0';
  }
  
  // ⭐️ 학생 기록(f)과 DB 기록(F)을 비교하기 위해 둘 다 대문자로 통일
  const studentValueStr = String(studentRecord).trim().toUpperCase(); // ⭐️ .toUpperCase()
  
  // ⭐️ 'F', 'G' 등이면 'findMinScore' 헬퍼를 즉시 호출
  const FORCE_MIN_SCORE_KEYWORDS = ['F', 'G', '미응시', '파울', '실격'];
  if (FORCE_MIN_SCORE_KEYWORDS.includes(studentValueStr)) {
      // ⭐️ 'F' -> '0' 매핑을 무시하고, 배점표의 실제 최하점(e.g. 30)을 찾음
      return findMinScore(scoreTable);
  }

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
      // ⭐️ DB 기록도 대문자로 저장 (e.g., "P" -> "P", "F" -> "F")
      exactMatchLevels.set(recordStr.toUpperCase(), level.배점); // ⭐️ .toUpperCase()
    }
  }

  // 3. [1순위] 문자 일치 (e.g., "P" -> "P")
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
        // [달리기: 9.71(80), 9.61(90), 9.51(100)]
        numericLevels.sort((a, b) => b.record - a.record); 
        for (const level of numericLevels) {
          if (studentValueNum >= level.record) return level.grade; 
        }
        if (studentValueNum < numericLevels[numericLevels.length - 1].record) {
          return numericLevels[numericLevels.length - 1].grade; // 만점
        }
        
      } else { // higher_is_better (제자리멀리뛰기)
        numericLevels.sort((a, b) => b.record - a.record);
        for (const level of numericLevels) {
          if (studentValueNum >= level.record) return level.grade;
        }
        
        // ▼▼▼▼▼ [⭐️ 수정됨 - 11/05 버그 수정] ▼▼▼▼▼
        // ⭐️ 'numericLevels' 배열이 비어있지 않을 때만 이 로직을 실행
        if (numericLevels.length > 0) {
          // 학생 200 (기준 미달) -> 루프 통과 (못 찾음)
          // 'outOfRangeRule'을 무시하고 '최하점'을 강제로 반환.
          return numericLevels[numericLevels.length - 1].grade; // e.g. 60점 반환
        }
        // ▲▲▲▲▲ [⭐️ 수정됨 - 11/05 버그 수정] ▲▲▲▲▲
      }
    }
  }
  
  // 5. [4순위] 어디에도 해당 안 됨 (e.g. 배점표에 없는 문자 "H", "J" 등)
  if (outOfRangeRule === '최하점') {
    // ⭐️ 'findMinScore' 헬퍼를 사용 (F/G 등을 제외한 순수 숫자 최하점)
    return findMinScore(scoreTable);
  } else {
    return '0'; // '0점' 규칙이면 0점
  }
}
// ▲▲▲▲▲ lookupScore 함수 끝 ▲▲▲▲▲


/**
 * [규칙 3] '배점 등급'을 '최종 점수'로 환산
 */
function convertGradeToScore(grade, U_ID, eventName) {
  // ⭐️ P/NP/PASS 처리 (기본적으로 PASS = 100, NP = 0)
  const g = String(grade).toUpperCase();
  if (g === 'P' || g === 'PASS') return 100;
  if (g === 'NP' || g === 'N' || g === 'FAIL') return 0;

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

/**
 * [규칙 4] 'Special' 모드 대학 계산
 */
function calcPracticalSpecial(F, list, log, studentGender) {
  const uid = Number(F.U_ID);
  const cfg = typeof F.실기특수설정 === 'string'
    ? JSON.parse(F.실기특수설정)
    : (F.실기특수설정 || {});

  // ======================================================
  // ⭐️ ID 13번 학교 (수동 공식 계산 + 'list' 배열 직접 수정 + 반올림)
  // ======================================================
  if (uid === 13) {
      log.push(`[Special-Case 13] 수동 공식 계산 시작 (Gender: ${studentGender})`);
      
      if (studentGender !== '남' && studentGender !== '여') {
          log.push(`[오류] 성별 정보 없음. 0점 반환.`);
          return 0;
      }

      const standards = {
          '배근력':        { '남': { min: 130, max: 220 }, '여': { min: 60, max: 151 } },
          '좌전굴':        { '남': { min: 11.9, max: 30 }, '여': { min: 13.9, max: 32 } },
          '제자리멀리뛰기': { '남': { min: 254, max: 300 }, '여': { min: 199, max: 250 } },
          '중량메고달리기': { '남': { min: 9.9, max: 7.19 }, '여': { min: 10.9, max: 7.6 } }
      };

      let totalScore = 0; // 400점 만점 (합산)

      for (const item of list) {
          const eventName = item.event;
          const std = standards[eventName]?.[studentGender];
          const record = parseFloat(item.record); 

          if (!std || isNaN(record)) {
              log.push(`[Special-Case 13] ${eventName}: 기록(${item.record})이 없거나 숫자가 아님. 0점 처리.`);
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
          
          log.push(`[Special-Case 13] ${eventName}: (기록 ${record} -> ${cappedRecord}) → ${eventScore.toFixed(2)}점 (0감)`);
          
          totalScore += eventScore; 
      }
      
      const finalTotalScore = Math.round(totalScore * 100) / 100;
      log.push(`[Special-Case 13] 최종 합산 점수: ${finalTotalScore.toFixed(2)} (반올림 전: ${totalScore})`);
      return finalTotalScore; 
  }
  // ======================================================
  // ⭐️ (Case 13 끝)
  // ======================================================

  
  // ▼▼▼▼▼ [⭐️ 중요] case 16, 17, 69, 70을 위한 점수 맵 ▼▼▼▼▼
  // (null은 0점으로, F는 30점 등으로 매핑됨)
  const scoreMap = new Map();
  for (const item of list) {
      scoreMap.set(item.event, item.score || 0); 
  }
  // ▲▲▲▲▲ [⭐️ 중요] ▲▲▲▲▲


  // ⭐️ (기존) 합산 케이스(2, 3, 19)를 위한 'cleaned' 배열 (0점/null 제외)
  const cleaned = (list || []).filter(it => Number.isFinite(it.score) && it.score > 0);

  // ▼▼▼▼▼ [⭐️ 신규] case 69, 70을 위한 '모든' 종목 합산 ▼▼▼▼▼
  // (scoreMap의 모든 점수를 합산. [100, 80, null] -> 100+80+0 = 180)
  const sumOfAllScores = Array.from(scoreMap.values()).reduce((sum, score) => sum + score, 0);
  // ▲▲▲▲▲ [⭐️ 신규] ▲▲▲▲▲


  // ⭐️ 'switch' 문 시작
  switch (uid) {
    // ======================================================
    // ID 2번 학교
    // ======================================================
    case 2:
    {
      // 0점/null 제외 합산
      const sumOfScores = cleaned.reduce((sum, item) => sum + (item.score || 0), 0);
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
      
      log.push(`[Special-Case 2] 배점 합(${sumOfScores}) -> 환산 점수(${lookedUpScore})`);
      return lookedUpScore;
    } // (case 2 끝)
    
    // ======================================================
    // ID 3번 학교
    // ======================================================
    case 3:
    {
      // 0점/null 제외 합산
      const sumOfScores = cleaned.reduce((sum, item) => sum + (item.score || 0), 0);
      log.push(`[Special-Case 3] 배점 합(${sumOfScores}) + 기본점수(1)`);
      return sumOfScores + 1;
    } // (case 3 끝)

    // ======================================================
    // ID 17번 학교 (가중치 합산 1)
    // ======================================================
    case 17:
    {
        // 0점/null 포함 (scoreMap 사용)
        const runScore = scoreMap.get('10m왕복달리기') || 0;
        const jumpScore = scoreMap.get('제자리멀리뛰기') || 0;
        const situpScore = scoreMap.get('윗몸일으키기') || 0;
        
        const totalScore = (runScore * 5.6) + (jumpScore * 5.6) + (situpScore * 4.8);
        
        log.push(`[Special-Case 17] (10m왕복 ${runScore}점 * 5.6) + (제멀 ${jumpScore}점 * 5.6) + (윗몸 ${situpScore}점 * 4.8)`);
        log.push(`[Special-Case 17] 최종 합산 점수: ${totalScore.toFixed(3)}`);
        return totalScore;
    } // (case 17 끝)
    
    // ======================================================
    // ID 16번 학교 (가중치 합산 2)
    // ======================================================
    case 16:
    {
        // 0점/null 포함 (scoreMap 사용)
        const runScore = scoreMap.get('10m왕복달리기') || 0;
        const jumpScore = scoreMap.get('제자리멀리뛰기') || 0;
        const situpScore = scoreMap.get('윗몸일으키기') || 0;
        
        const totalScore = (runScore * 9.8) + (jumpScore * 9.8) + (situpScore * 8.4);

        log.push(`[Special-Case 16] (10m왕복 ${runScore}점 * 9.8) + (제멀 ${jumpScore}점 * 9.8) + (윗몸 ${situpScore}점 * 8.4)`);
        log.push(`[Special-Case 16] 최종 합산 점수: ${totalScore.toFixed(3)}`);
        return totalScore;
    } // (case 16 끝)

    // ======================================================
    // ID 19번 학교
    // ======================================================
    case 19:
    {
      // 0점/null 제외 합산
      const sumOfScores = cleaned.reduce((sum, item) => sum + (item.score || 0), 0);
      log.push(`[Special-Case 19] 배점 합(${sumOfScores}) + 기본점수(2)`);
      return sumOfScores + 2;
    } // (case 19 끝)

    // ======================================================
    // ID 69, 70번 학교 (평균 × 4 + 기본점수 400)
    // ======================================================
    case 69:
    case 70:
    {
      // (3종목의 합산 점수) ÷ 3× 4 + 기본점수 400점
      // ⭐️ 0점/null 포함 합산 (sumOfAllScores 사용)
      const avg = sumOfAllScores / 3; // 3개 종목 평균
      const totalScore = (avg * 4) + 400;
      
      log.push(`[Special-Case ${uid}] (전체 합산 ${sumOfAllScores}점 / 3) * 4 + 400`);
      log.push(`[Special-Case ${uid}] 최종 합산 점수: ${totalScore.toFixed(3)}`);
      return totalScore;
    } // (case 69, 70 끝)

    // ======================================================
    // ID 121번 학교 (PASS 개수 기반: (100 * P 개수) + 200)
    // ======================================================
    case 121:
    {
      let passCount = 0;

      for (const item of list || []) {
        // special 모드에서 breakdown에 rawGrade 넣어둘 거라 그걸 우선 사용
        const raw = item.rawGrade || item.grade || item.score;
        const upper = String(raw).toUpperCase();
        if (upper === 'P' || upper === 'PASS') {
          passCount++;
        }
      }

      const totalScore = (100 * passCount) + 200;
      log.push(`[Special-Case 121] PASS 종목 수: ${passCount}개 → (100 * ${passCount}) + 200 = ${totalScore}`);
      return totalScore;
    } // (case 121 끝)

    case 99:
    case 147:      
    {
      // 0점/null 제외 (cleaned 사용)
      const finalScore = practicalTopN(cleaned, 3,800);
      log.push(`[Special-Case 99] 상위 3종목 합산 (800점 만점 환산)`);
      log.push(`[Special-Case 99] 최종 점수: ${finalScore.toFixed(3)}`);
      return finalScore;
    } 

    case 146:
    {
      // 0점/null 제외 (cleaned 사용)
      const finalScore = practicalTopN(cleaned, 3,400);
      log.push(`[Special-Case 99] 상위 3종목 합산 (400점 만점 환산)`);
      log.push(`[Special-Case 99] 최종 점수: ${finalScore.toFixed(3)}`);
      return finalScore;
    } 

    case 1234: // 예: ○○대 - 상위 2종목만, 180점 만점
      return practicalTopN(cleaned, 2, cfg.maxScore || 180);

    case 5678: // 예: △△대 - 전체 평균, 150점 만점
      return practicalAverage(cleaned, cfg.maxScore || 150);

    default:
      log.push(`[경고] Special 모드 U_ID(${uid})가 분기에 없습니다. 0점을 반환합니다.`);
      return 0;
  } // ⭐️ 'switch' 문 끝
}
// ▲▲▲▲▲ calcPracticalSpecial 함수 끝 ▲▲▲▲▲


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

  if (mode === 'special') {
    // ⭐️ [Special 로직] ⭐️
    
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
      
      eventBreakdowns.push({
          event: eventName,
          record: eventValue,
          score: score,
          rawGrade: rawGrade,      // ⭐️ 121번용: 원래 등급(P/NP 등) 보존
          deduction_level: deductionLevel 
      });
    });
    
    const finalPracticalScore = calcPracticalSpecial(F, eventBreakdowns, log, studentGender);
    
    log.push('========== 실기 최종 ==========');
    log.push(`'special' 모드 계산 최종 총점: ${finalPracticalScore}`);
    
    return {
      totalScore: finalPracticalScore.toFixed(3),
      breakdown: { 
          events: eventBreakdowns, 
          practical_raw_sum: finalPracticalScore, 
          total_deduction_level: 0 
      },
      calculationLog: log,
    };
    
  } else {
    // ▼▼▼▼▼ [⭐️ 'Basic' 로직 수정됨 - 11/05] ▼▼▼▼▼
    
    log.push(`[Basic] 'basic' 모드(신규 로직) 실행...`);
    
    // ⭐️ (신규) F.실기총점 (e.g., 700)이 최종 목표 만점
    const PRACTICAL_MAX = Number(F.실기총점) || 0; 
    
    const schoolTotalBaseScore = Number(F.기본점수) || 0;
    const schoolOutOfRangeRule = F.미달처리 || '0점';

    log.push(`[정보] 실기총점(목표 만점)=${PRACTICAL_MAX}, 기본점수(추가)=${schoolTotalBaseScore}`);

    if (studentGender !== '남' && studentGender !== '여') {
      log.push(`[오류] 학생 성별(S.gender)이 '남' 또는 '여'가 아닙니다.`);
      return { totalScore: 0, breakdown: {}, calculationLog: log };
    }

    let rawPracticalSum = 0; // 학생이 받은 배점표 점수 합계 (e.g., 280)
    let scoreTableMaxSum = 0; // ⭐️ (신규) 배점표 원점수 만점 합계 (e.g., 300)
    const eventBreakdowns = [];
    let totalDeductionLevel = 0;

    studentRecords.forEach((record) => {
      const eventName = record.event;
      const eventValue = String(record.value || '').trim();

      // 1. ⭐️ (신규) 이 종목의 '배점표' 만점을 찾기 위해 scoreTable을 먼저 필터
      const scoreTable = allScoreData.filter(
        (r) => r.종목명 === eventName && r.성별 === studentGender
      );
      
      // 2. ⭐️ (신규) 'findMaxScore' 헬퍼로 이 종목의 배점표 만점(e.g. 100)을 찾아서 합산
      const eventMaxScore = findMaxScore(scoreTable);
      scoreTableMaxSum += eventMaxScore;
      log.push(`[정보] ${eventName} 배점표 만점: ${eventMaxScore}점 (누적 배점표 만점: ${scoreTableMaxSum}점)`);


      // (이하는 기존 로직)
      if (eventValue === '') {
        log.push(`[${eventName}] 기록 없음. 계산 보류.`);
        eventBreakdowns.push({
          event: eventName,
          record: '',
          score: null,
          deduction_level: null
        });
        return; // (rawPracticalSum에는 0이 더해짐)
      }

      const { method } = getEventRules(eventName);
      // (scoreTable은 위에서 이미 만듦)

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
    
    // 3. ⭐️ (신규) 0으로 나누기 방지
    if (scoreTableMaxSum <= 0) {
      log.push(`[오류] 배점표 만점 합계(${scoreTableMaxSum})가 0입니다. 계산 불가.`);
      // (기본점수만 반환)
      return { 
          totalScore: schoolTotalBaseScore.toFixed(3), 
          breakdown: { events: eventBreakdowns, practical_raw_sum: schoolTotalBaseScore, total_deduction_level: totalDeductionLevel }, 
          calculationLog: log 
      };
    }
    
    // 4. ⭐️ (수정) 학생 총점 (기본점수 포함)
    const finalRawScore = rawPracticalSum + schoolTotalBaseScore;
    log.push(`[조정] 종목 합계(${rawPracticalSum}) + 기본 점수(${schoolTotalBaseScore}) = ${finalRawScore}점`);
    log.push(`[결과] 실기 원점수 합계 (최종): ${finalRawScore} / ${scoreTableMaxSum}`);
    log.push(`[결과] ⭐️ 총 감수 (레벨 합): ${totalDeductionLevel}감`);

    // 5. ▼▼▼▼▼ [⭐️ 최종 계산 수정] ▼▼▼▼▼
    // (학생 성취도) * (최종 목표 만점)
    // (e.g., (280+0) / 300) * 700 = 653.33점
    const finalPracticalScore = (finalRawScore / scoreTableMaxSum) * PRACTICAL_MAX;

    log.push('========== 실기 최종 ==========');
    log.push(
      `실기 환산 점수 = (학생 원점수 ${finalRawScore} / 배점표 만점 ${scoreTableMaxSum}) * 실기총점(DB) ${PRACTICAL_MAX}`
    );
    log.push(
      `실기 최종 점수: ${finalPracticalScore.toFixed(3)}`
    );

    return {
      totalScore: finalPracticalScore.toFixed(3),
      breakdown: { 
        events: eventBreakdowns,
        practical_raw_sum: finalPracticalScore, // ⭐️ breakdown에도 최종 환산 점수
        total_deduction_level: totalDeductionLevel
      },
      calculationLog: log,
    };
    // ▲▲▲▲▲ [⭐️ 'Basic' 로직 수정 끝] ▲▲▲▲▲
  }
}


// -----------------------------------------------------------------
// ⭐️ [2] 라우터 모듈
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
module.exports.findMinScore = findMinScore;
