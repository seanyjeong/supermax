// collegeCalculator.js

// ✨ 영어 점수 변환
function calculateEnglishScore(englishGrade, englishScoreRule) {
  if (!englishScoreRule || englishGrade < 1 || englishGrade > 9) return 0;
  return englishScoreRule[englishGrade - 1] ?? 0;
}

// ✨ 한국사 점수 변환
function calculateKoreanHistoryScore(khistoryGrade, koreanHistoryScoreRule) {
  if (!koreanHistoryScoreRule || khistoryGrade < 1 || khistoryGrade > 9) return 0;
  return koreanHistoryScoreRule[khistoryGrade - 1] ?? 0;
}

// ✨ 과목별 점수 뽑기
function getSubjectScore(subjectData, 반영지표) {
  if (!subjectData) return 0;
  if (반영지표 === '표') return subjectData.표준점수 ?? 0;
  if (반영지표 === '백') return subjectData.백분위 ?? 0;
  if (반영지표 === '등') return subjectData.등급 ?? 0;
  if (반영지표 === '반영없음') return 0;
  return 0;
}

// ✨ 영어 점수 정규화
function normalizeEnglishScore(영어등급, englishScoreRule, 영어표준점수만점) {
  if (!englishScoreRule || 영어등급 < 1 || 영어등급 > 9) return 0;

  const rawScore = englishScoreRule[영어등급 - 1] ?? 0;
  if (영어표준점수만점 === '최고점') {
    const 최고점 = englishScoreRule[0] || 100;
    return rawScore / 최고점;
  }
  if (영어표준점수만점 === '200') return rawScore / 200;
  return rawScore / 100;
}

// ✨ 한국사 점수 처리
function applyKoreanHistoryScore(studentData, koreanHistoryRule, koreanHistoryScoreRule) {
  const 한국사등급 = studentData.한국사등급;
  const 한국사점수 = calculateKoreanHistoryScore(한국사등급, koreanHistoryScoreRule);

  const 한국사반영 = koreanHistoryRule.한국사반영;

  if (한국사반영 === '필수응시') return { 점수: 0, 처리방식: '필수응시' };
  if (한국사반영 === '가산점') {
    if (koreanHistoryRule.한국사가산처리 === '수능환산') {
      return { 점수: 한국사점수, 처리방식: '수능환산' };
    } else {
      return { 점수: 한국사점수, 처리방식: '직접더함' };
    }
  }
  if (!isNaN(parseInt(한국사반영))) {
    const 비율 = parseInt(한국사반영);
    return { 점수: 한국사점수 * (비율 / 100), 처리방식: `${비율}퍼센트` };
  }

  return { 점수: 0, 처리방식: 'unknown' };
}

// ✨ 탐구 점수 처리
function processScienceScore(t1, t2, 탐구과목반영수) {
  if (탐구과목반영수 === 0) return 0;
  if (탐구과목반영수 === 1) return Math.max(t1, t2);
  if (탐구과목반영수 === 2) return (t1 + t2) / 2;
  return 0;
}

// ✨ 과목 점수 정규화
function normalizeScore(rawScore, 반영지표, 표준점수반영기준, 과목명, 표준점수최고점데이터) {
  if (!rawScore) return 0;

  if (반영지표 === '백') return rawScore / 100;
  if (반영지표 === '등') return rawScore / 100;
  if (반영지표 === '표') {
    if (표준점수반영기준 === '최고점') {
      const 최고점 = 표준점수최고점데이터?.[과목명] ?? 200;
      return rawScore / 최고점;
    } else {
      const 탐구과목목록 = [
        '생활과윤리', '윤리와사상', '한국지리', '세계지리', '동아시아사', '세계사',
        '정치와법', '경제', '사회문화', '생명과학1', '생명과학2',
        '화학1', '화학2', '물리1', '물리2', '지구과학1', '지구과학2'
      ];
      const is탐구 = 탐구과목목록.includes(과목명);
      const 기준점수 = is탐구 ? 100 : 200;
      return rawScore / 기준점수;
    }
  }
  return 0;
}

// ✨ 수능 점수만 뽑기
function calculateSuneungScore(studentScore, collegeRule) {
  const 국수영반영지표 = collegeRule.국수영반영지표;
  const 탐구반영지표 = collegeRule.탐구반영지표;

  const 국어점수 = getSubjectScore(studentScore.국어, 국수영반영지표);
  const 수학점수 = getSubjectScore(studentScore.수학, 국수영반영지표);
  const 탐구1점수 = getSubjectScore(studentScore.탐구1, 탐구반영지표);
  const 탐구2점수 = getSubjectScore(studentScore.탐구2, 탐구반영지표);

  return {
    국어: 국어점수,
    수학: 수학점수,
    탐구1: 탐구1점수,
    탐구2: 탐구2점수
  };
}

// ✨ default 방식 수능합산 계산
function calculateDefaultTotalScore(과목점수셋, 반영과목리스트, 반영비율) {
  let total = 0;
  for (let i = 0; i < 반영과목리스트.length; i++) {
    const subject = 반영과목리스트[i];
    const ratio = 반영비율[i] ?? 0;
    const score = 과목점수셋[subject] ?? 0;
    total += score * (ratio / 100);
  }
  return total;
}

// ✨ rank 방식 수능합산 계산
function calculateRankTotalScore(과목점수셋, 반영과목리스트, 반영비율, 반영과목수) {
  const scores = [];

  for (const subject of 반영과목리스트) {
    const score = 과목점수셋[subject] ?? 0;
    scores.push({ subject, score });
  }

  scores.sort((a, b) => b.score - a.score);
  const selected = scores.slice(0, 반영과목수);

  let total = 0;
  for (let i = 0; i < selected.length; i++) {
    const score = selected[i].score;
    const ratio = 반영비율[i] ?? 0;
    total += score * (ratio / 100);
  }

  return total;
}

  // ✨ 최종 대학 환산 점수 계산 (default/rank 자동 분기)
// ✨ 수능 합산 점수 계산
function calculateFinalCollegeScore(studentScore, collegeRule, 점수셋, 반영과목리스트, 반영비율, 반영규칙, 반영과목수, koreanHistoryResult) {
  let 수능환산 = 0;

  if (반영규칙 === 'default') {
    수능환산 = this.calculateDefaultTotalScore(점수셋, 반영과목리스트, 반영비율);
  } else if (반영규칙 === 'rank') {
    수능환산 = this.calculateRankTotalScore(점수셋, 반영과목리스트, 반영비율, 반영과목수);
  } else {
    수능환산 = 0;
  }

  const 내신점수 = studentScore.내신 || 0;
  const 실기점수 = studentScore.실기 || 0;
  const 기타환산 = 0;  // 지금은 기타 없음

  let 최종합산점수 = 
    (수능환산 * (collegeRule.수능비율 / 100)) +
    (내신점수 * (collegeRule.내신비율 / 100)) +
    (실기점수 * (collegeRule.실기비율 / 100)) +
    (기타환산 * (collegeRule.기타비율 / 100));

  // 🔥 한국사 가산점 추가
  if (koreanHistoryResult && (koreanHistoryResult.처리방식 === '수능환산' || koreanHistoryResult.처리방식 === '직접더함')) {
    최종합산점수 += koreanHistoryResult.점수;
  }

  return 최종합산점수;
}


  


// ✨ 모듈 export
module.exports = {
  calculateCollegeScore,            // ✨ 수능 합산 점수 계산
  calculateSuneungScore,             // ✨ 과목별 점수 추출
  applyKoreanHistoryScore,           // ✨ 한국사 점수 적용
  getSubjectScore,                   // ✨ 과목 점수 추출
  calculateEnglishScore,             // ✨ 영어 점수 변환
  calculateKoreanHistoryScore,       // ✨ 한국사 점수 변환
  processScienceScore,               // ✨ 탐구 점수 계산
  normalizeScore,                    // ✨ 점수 정규화
  normalizeEnglishScore,             // ✨ 영어 점수 정규화
  calculateDefaultTotalScore,        // ✨ default 방식 수능 계산
  calculateRankTotalScore,           // ✨ rank 방식 수능 계산
  calculateFinalCollegeScore         // ✨ [추가] 한국사 포함 최종 계산
};


