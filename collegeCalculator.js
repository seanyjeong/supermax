
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

  const raw = englishScoreRule[영어등급 - 1];
  const rawScore = typeof raw === 'string' ? parseFloat(raw) : raw;

  console.log('📦 rawScore:', rawScore);
  console.log('🎯 영어표준점수만점:', 영어표준점수만점, typeof 영어표준점수만점);

  if (String(영어표준점수만점) === '200') {
    return rawScore / 200;
  }
  if (String(영어표준점수만점) === '최고점') {
    const 최고점 = englishScoreRule[0] || 100;
    return rawScore / 최고점;
  }
  if (String(영어표준점수만점) === '기본') {
    return rawScore;
  }

  return rawScore / 100;
}




// ✨ 한국사 점수 처리
function applyKoreanHistoryScore(studentData, koreanHistoryRule, koreanHistoryScoreRule) {
  const 한국사등급 = studentData.한국사등급;
  const 한국사점수 = calculateKoreanHistoryScore(한국사등급, koreanHistoryScoreRule);

  const 한국사반영 = koreanHistoryRule.한국사반영;

  if (한국사반영 === '필수응시') return { 점수: 0, 처리방식: '필수응시' };
  if (한국사반영 === '믹스') return { 점수: 한국사점수, 처리방식: '믹스' };
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

      console.log(`✅ 과목: ${subject}, 비율: ${ratio}, 점수: ${score}, 반영값: ${score * (ratio / 100)}`);
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
//mix 방식임//
function calculateMixTotalScore(과목점수셋, 그룹정보, 총점기준) {
  let total = 0;
  const usedSubjects = new Set();  // ✅ 이미 선택된 과목 저장

  for (const 그룹 of 그룹정보) {
    const { 과목리스트, 선택개수, 반영비율 } = 그룹;
    if (!과목리스트 || 과목리스트.length === 0) continue;

    const scores = 과목리스트
      .filter(subject => !usedSubjects.has(subject))  // ✅ 중복 제거
      .map(subject => ({
        subject,
        score: 과목점수셋[subject] !== undefined ? 과목점수셋[subject] : -1
      }))
      .filter(({ score }) => score >= 0);

    if (scores.length === 0) continue;

    let selected = [];

    const is정확히일치 = (
      scores.length === 선택개수 &&
      Array.isArray(반영비율) &&
      반영비율.length === 선택개수
    );

    if (is정확히일치) {
      selected = scores.map((item, idx) => ({
        ...item,
        ratio: 반영비율[idx] || 0
      }));
    } else {
      scores.sort((a, b) => b.score - a.score);
      selected = scores.slice(0, 선택개수);

      if (Array.isArray(반영비율)) {
        selected = selected.map((item, idx) => ({
          ...item,
          ratio: 반영비율[idx] || 0
        }));
      } else {
        const 평균점수 = selected.reduce((sum, s) => sum + s.score, 0) / 선택개수;
        total += 평균점수 * (반영비율 / 100);
        continue;
      }
    }

    selected.forEach(({ subject, score, ratio }) => {
      usedSubjects.add(subject); // ✅ 이 과목은 다음 그룹에서 제외됨
      total += score * (ratio / 100);
    });

    console.log('📋 [Mix] 그룹 대상:', scores);
    console.log('🏆 [Mix] 그룹 선택:', selected);
  }

  const 환산 = total * (총점기준 / 100);
  console.log('🔥 [Mix] 누적 Total:', 환산);
  return 환산;
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
  
  
