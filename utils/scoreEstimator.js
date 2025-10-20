// /utils/scoreEstimator.js (신규 파일)

/**
 * [핵심] 원점수에 해당하는 예상 표준점수와 백분위를 선형 보간법으로 계산 (반올림)
 * @param {number} rawScore - 학생의 가채점 원점수 (예: 90)
 * @param {Array<Object>} gradeCutTable - 해당 과목의 등급컷 테이블 (DB에서 가져온 것)
 * - 예: [{ raw: 100, std: 136, pct: 98, grade: 1 }, { raw: 94, std: 131, pct: 96, grade: 1 }, ...]
 * @returns {Object} - { std: 예상표점, pct: 예상백분위, grade: 예상등급 }
 */
function interpolateScore(rawScore, gradeCutTable) {
  // 1. 유효성 검사 및 테이블 정렬 (원점수 내림차순)
  if (!gradeCutTable || gradeCutTable.length === 0) {
    return { std: 0, pct: 0, grade: 9 };
  }
  
  const sortedCuts = [...gradeCutTable]
    .map(c => ({
      raw: Number(c.원점수),
      std: Number(c.표준점수),
      pct: Number(c.백분위),
      grade: Number(c.등급)
    }))
    .sort((a, b) => b.raw - a.raw);

  // 2. 엣지 케이스 처리 (최고점, 최저점)
  const maxScore = sortedCuts[0];
  const minScore = sortedCuts[sortedCuts.length - 1];

  if (rawScore >= maxScore.raw) {
    return { std: maxScore.std, pct: maxScore.pct, grade: maxScore.grade };
  }
  if (rawScore <= minScore.raw) {
    return { std: minScore.std, pct: minScore.pct, grade: minScore.grade };
  }

  // 3. '샌드위치' 구간 찾기
  let upper = maxScore;
  let lower = maxScore;

  for (let i = 1; i < sortedCuts.length; i++) {
    if (sortedCuts[i].raw === rawScore) {
      // 컷 점수와 정확히 일치하는 경우
      const exactCut = sortedCuts[i];
      return { std: exactCut.std, pct: exactCut.pct, grade: exactCut.grade };
    }
    
    if (sortedCuts[i].raw < rawScore) {
      upper = sortedCuts[i - 1]; // 예: { raw: 94, std: 131, pct: 96 }
      lower = sortedCuts[i];     // 예: { raw: 88, std: 125, pct: 89 }
      break;
    }
  }

  // 4. 선형 보간법 (Linear Interpolation) 계산
  const rawRange = upper.raw - lower.raw;       // 94 - 88 = 6
  const rawOffset = rawScore - lower.raw;     // 90 - 88 = 2
  
  // 분모가 0이 되는 것 방지
  if (rawRange === 0) {
    return { std: lower.std, pct: lower.pct, grade: lower.grade };
  }
  
  const position = rawOffset / rawRange; // 2 / 6 = 0.333...

  const stdRange = upper.std - lower.std;       // 131 - 125 = 6
  const pctRange = upper.pct - lower.pct;       // 96 - 89 = 7

  const estimatedStd = lower.std + (stdRange * position);
  const estimatedPct = lower.pct + (pctRange * position);

  // 5. 최종 반올림 (정수) 및 등급 반환
  return {
    std: Math.round(estimatedStd),
    pct: Math.round(estimatedPct),
    grade: lower.grade // 등급은 아래쪽(lower) 컷을 따라감
  };
}

/**
 * [절대평가] 영어 원점수 -> 등급
 */
function getEnglishGrade(rawScore) {
  const score = Number(rawScore);
  if (score >= 90) return 1;
  if (score >= 80) return 2;
  if (score >= 70) return 3;
  if (score >= 60) return 4;
  if (score >= 50) return 5;
  if (score >= 40) return 6;
  if (score >= 30) return 7;
  if (score >= 20) return 8;
  return 9;
}

/**
 * [절대평가] 한국사 원점수 -> 등급
 */
function getHistoryGrade(rawScore) {
  const score = Number(rawScore);
  if (score >= 40) return 1;
  if (score >= 35) return 2;
  if (score >= 30) return 3;
  if (score >= 25) return 4;
  if (score >= 20) return 5;
  if (score >= 15) return 6;
  if (score >= 10) return 7;
  if (score >= 5) return 8;
  return 9;
}

// 3개 함수를 밖에서 쓸 수 있게 export
module.exports = {
  interpolateScore,
  getEnglishGrade,
  getHistoryGrade,
};
