// collegeCalculator.js

function 과목구분(과목명) {
  const 사탐 = [
    '생활과윤리', '윤리와사상', '한국지리', '세계지리',
    '동아시아사', '세계사', '정치와법', '경제', '사회문화'
  ];
  const 과탐 = [
    '생명과학1', '생명과학2', '화학1', '화학2',
    '물리1', '물리2', '지구과학1', '지구과학2'
  ];
  const 국어 = ['화법과작문', '언어와매체'];
  const 수학 = ['확률과통계', '미적분', '기하'];

  if (사탐.includes(과목명)) return '사탐';
  if (과탐.includes(과목명)) return '과탐';
  if (국어.includes(과목명)) return '국어';   // ✨ 추가
  if (수학.includes(과목명)) return '수학';   // ✨ 추가
  return null; // 구분 못하면 null
}


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
  if (반영지표 === '백자표') return subjectData.변환점수 ?? 0; // ✨ 추가
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
  if (영어표준점수만점 === '200') {
    return rawScore / 200;
  }
  if (영어표준점수만점 === '기본') {
    return rawScore; // ✨ 기본이면 변환 없이 rawScore 그대로
  }
  return rawScore / 100; // 나머지는 기존처럼 100으로 나눔
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
function normalizeScore(rawScore, 반영지표, 표준점수반영기준, 과목명, 표준점수최고점데이터, 백자표변환표) {
  if (!rawScore) return 0;

  if (반영지표 === '백') return rawScore / 100;
  if (반영지표 === '등') return rawScore / 100;
  if (반영지표 === '표') {
    if (표준점수반영기준 === '최고점') {
      let 최고점 = 표준점수최고점데이터?.[과목명] ?? 200;

      // ✨ 추가: 만약 탐구과목이고 백자표 적용 대상이면
      if (백자표변환표) {
        최고점 = 백자표변환표[100] ?? 최고점;
      }

      return rawScore / 최고점;
    }
    else if (표준점수반영기준 === '200') {
      const 구분 = 과목구분(과목명);
      const is탐구 = 구분 === '사탐' || 구분 === '과탐';
      const 기준점수 = is탐구 ? 100 : 200;
      return rawScore / 기준점수;
    }
    else if (표준점수반영기준 === '기본') {
      return rawScore;
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
// ✨ default 방식 수능합산 계산
function calculateDefaultTotalScore(과목점수셋, 반영과목리스트, 반영비율, 총점기준) {
  let total = 0;
  for (let i = 0; i < 반영과목리스트.length; i++) {
    const subject = 반영과목리스트[i];
    const ratio = 반영비율[i] ?? 0;
    const score = 과목점수셋[subject] ?? 0;
    total += score * (ratio / 100);
  }
  return total * (총점기준 / 100);  // ✨ 수정: 총점기준 반영
}




// ✨ rank 방식 수능합산 계산
function calculateRankTotalScore(과목점수셋, 반영과목리스트, 반영비율, 반영과목수,총점기준) {
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

  return total * (총점기준 / 100);  // ✨ 수정: 총점기준 반영
}

function calculateMixTotalScore(과목점수셋, 그룹정보,총점기준) {
  let total = 0;
  const usedSubjects = new Set();

  for (const 그룹 of 그룹정보) {
    const { 과목리스트, 선택개수, 반영비율 } = 그룹;
    if (!과목리스트 || 과목리스트.length === 0) continue;

    const availableScores = 과목리스트
      .filter(subject => !usedSubjects.has(subject))
      .map(subject => ({
        subject,
        score: 과목점수셋[subject] !== undefined ? 과목점수셋[subject] : -1
      }))
      .filter(({ score }) => score >= 0);

    if (availableScores.length === 0) continue;

    availableScores.sort((a, b) => b.score - a.score);

    const selected = availableScores.slice(0, 선택개수);

    console.log('📋 [Mix] 그룹 대상:', availableScores);
    console.log('🏆 [Mix] 그룹 선택:', selected);

    const averageScore = selected.reduce((sum, val) => sum + val.score, 0) / (선택개수 || 1);

    selected.forEach(({ subject }) => usedSubjects.add(subject));

    total += averageScore * (반영비율 / 100);
  }

  console.log('🔥 [Mix] 누적 Total:', total * (총점기준 / 100));
  return total * (총점기준 / 100);  // ✨ 수정: 총점기준 반영
}

function calculateCollegeScore(studentScore, collegeRule, 과목점수셋, 반영과목리스트, 반영비율, 반영규칙, 반영과목수, 그룹정보, 총점기준) {
  let 수능환산 = 0;

  if (반영규칙 === 'default') {
    수능환산 = calculateDefaultTotalScore(과목점수셋, 반영과목리스트, 반영비율,총점기준);
  } else if (반영규칙 === 'rank') {
    수능환산 = calculateRankTotalScore(과목점수셋, 반영과목리스트, 반영비율, 반영과목수,총점기준);
  } else if (반영규칙 === 'mix') {
    수능환산 = calculateMixTotalScore(과목점수셋, 그룹정보,총점기준);
  } else {
    수능환산 = 0;
  }

  const 내신점수 = studentScore.내신 || 0;
  const 실기점수 = studentScore.실기 || 0;
  const 기타환산 = 0;

  const 최종합산점수 =
    (수능환산 * (collegeRule.수능비율 / 100)) +
    (내신점수 * (collegeRule.내신비율 / 100)) +
    (실기점수 * (collegeRule.실기비율 / 100)) +
    (기타환산 * (collegeRule.기타비율 / 100));

  return 최종합산점수;
}
  
  
  
  
  
  // ✨ 모듈 export
  module.exports = {
    calculateCollegeScore,
    calculateSuneungScore,
    applyKoreanHistoryScore,
    getSubjectScore,
    calculateEnglishScore,
    calculateKoreanHistoryScore,
    processScienceScore,
    normalizeScore,
    normalizeEnglishScore,
    calculateDefaultTotalScore,
    calculateRankTotalScore,
    calculateMixTotalScore ,
    과목구분       // ✨ [추가] mix 방식 수능 계산
    
  };
  
  
