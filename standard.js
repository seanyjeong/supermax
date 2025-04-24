module.exports = function(input, rows, 최고점Map) {
  console.log('📌 최고점Map:', 최고점Map); // 최고점 테이블 확인
  console.log('📥 입력값:', input); // 사용자가 입력한 점수, 과목명 확인

  const 과탐목록 = ["물리1", "물리2", "화학1", "화학2", "생명과학1", "생명과학2", "지구과학1", "지구과학2"];

function getConvertedScore(stdScore, subjectName, 기준) {
  if (subjectName === '영어') {
    if (기준 === '최고점') {
      const 최고점 = 최고점Map['영어1등급점수'];
      return 최고점 ? stdScore / 최고점 : 0;
    } else if (기준 === '200') {
      return stdScore / 200;
    }
  }

  const 최고점 = 최고점Map[subjectName.trim()]; // ✅ 여기!
  if (기준 === '최고점') return 최고점 ? stdScore / 최고점 : 0;
  if (기준 === '200') return stdScore / 200;

  return 0;
}

  console.log('🧾 과목명:', {
    국어과목: input.koreanSubject,
    수학과목: input.mathSubject,
    탐구1과목: input.subject1Name,
    탐구2과목: input.subject2Name
  });
  

  const results = rows.map(row => {
    const 영어등급점수 = row[`영어${input.englishGrade}등급점수`] || 0;
    const 한국사등급점수 = row[`한국사${input.khistoryGrade}등급점수`] || 0;

    let 수학점수 = input.math_std;
    let 탐구1점수 = input.subject1_std;
    let 탐구2점수 = input.subject2_std;

    // 수학 가산점
    if (row.수학가산과목조건) {
      row.수학가산과목조건.split(',').forEach(조건 => {
        const [과목, 퍼센트] = 조건.split(':');
        if (input.mathSubject === 과목.trim()) {
          수학점수 *= 1 + (parseFloat(퍼센트 || 0) / 100);
        }
      });
    }

    // 탐구 가산점
    if (typeof row.탐구가산과목조건 === 'string' && row.탐구가산과목조건.includes('과탐')) {
      const 가산 = parseFloat(row.탐구가산과목조건.split(':')[1]) || 0;
      if (과탐목록.includes(input.subject1Name)) 탐구1점수 *= (1 + 가산 / 100);
      if (과탐목록.includes(input.subject2Name)) 탐구2점수 *= (1 + 가산 / 100);
    }

    // 탐구 계산
    let 탐구 = row.탐구과목수 === 2 ? (탐구1점수 + 탐구2점수) / 2 : Math.max(탐구1점수, 탐구2점수);

    // 기준
    const 기준 = row.표준점수만점;

    const 국어환산 = getConvertedScore(input.korean_std, input.koreanSubject, 기준);
    const 수학환산 = getConvertedScore(수학점수, input.mathSubject, 기준);
    const 탐구환산 = getConvertedScore(탐구, '탐구', 기준);

    const 국어점수 = 국어환산 * (row.국어비율 / 100);
    const 수학점수_가산 = 수학환산 * (row.수학비율 / 100);

    let 영어점수 = 0;
    if (row.영어비율 === '감점') {
      영어점수 = 영어등급점수;
    } else if (typeof row.영어비율 === 'number' || !isNaN(parseFloat(row.영어비율))) {
      영어점수 = 영어등급점수 * (parseFloat(row.영어비율) / 100);
    }

    const 탐구점수 = 탐구환산 * (row.탐구비율 / 100);

    let 선택점수 = 0;
    let 수능최종반영점수 = 0;

    if (!row.수능선택조건 || row.수능선택조건.trim() === '') {
      선택점수 = 국어점수 + 수학점수_가산 + 영어점수;
      수능최종반영점수 = (선택점수 + 탐구점수) * (row.수능반영비율 / 100);
    } else if (row.수능선택조건 === '국수영택2') {
      const candidates = [
        { 과목: '국어', 점수: 국어점수 },
        { 과목: '수학', 점수: 수학점수_가산 },
        { 과목: '영어', 점수: 영어점수 }
      ];
    
      candidates.sort((a, b) => b.점수 - a.점수);
      const top2 = candidates.slice(0, 2);
    
      console.log('🎯 선택과목 Top2:', top2);
    
      선택점수 = top2.reduce((acc, cur) => acc + cur.점수, 0);
      수능최종반영점수 = (선택점수 + 탐구점수) * (row.수능반영비율 / 100);
    }
    if (row.한국사반영방식 === '가산점') 수능최종반영점수 += 한국사등급점수;
    if (row.영어비율 === '감점') 수능최종반영점수 += 영어등급점수;

    // ✅ 개별 디버깅 출력
    console.log(`🎯 [${row.대학명}] 총점계산 → 국어:${국어점수}, 수학:${수학점수_가산}, 영어:${영어점수}, 탐구:${탐구점수}, 최종:${수능최종반영점수}`);
    console.log('📌 대학:', row.대학명, row.학과명);
    console.log('📊 입력 과목:', {
      국어과목: input.koreanSubject,
      수학과목: input.mathSubject,
      탐구1과목: input.subject1Name,
      탐구2과목: input.subject2Name
    });
    console.log('📊 입력 점수:', {
      국어: input.korean_std,
      수학: input.math_std,
      탐구1: input.subject1_std,
      탐구2: input.subject2_std,
      영어등급: input.englishGrade,
      영어등급점수: 영어등급점수
    });
    console.log('📐 변환 점수:', {
      국어환산: 국어환산,
      수학환산: 수학환산,
      탐구환산: 탐구환산,
      영어: 영어점수
    });
    console.log('⚙️ 반영비율:', {
      국어비율: row.국어비율,
      수학비율: row.수학비율,
      영어비율: row.영어비율,
      탐구비율: row.탐구비율,
      수능반영비율: row.수능반영비율
    });
    console.log('🧠 수능선택조건:', row.수능선택조건 || '기본');
    console.log('🧮 과목별 점수:', {
      국어점수,
      수학점수_가산,
      영어점수,
      탐구점수
    });
    console.log('✅ 선택점수:', 선택점수, '/ 최종 수능합산점수:', 수능최종반영점수);
    console.log('----------------------------------------------');
    
    return {
      대학명: row.대학명,
      학과명: row.학과명,
      최종합산점수: Math.round(수능최종반영점수 * 10) / 10,
      수능최종반영점수: Math.round(수능최종반영점수 * 10) / 10,
      선택점수: Math.round(선택점수 * 10) / 10,
      계산기준: '표준점수',
      반영지표: row.반영지표 || '표/표',
      수능선택조건: row.수능선택조건 || '',
      국어: input.korean_std,
      수학: input.math_std,
      영어: Math.round(영어점수 * 10) / 10,
      탐구: Math.round(탐구 * 10) / 10,
      국어비율: row.국어비율 || 0,
      수학비율: row.수학비율 || 0,
      영어비율: row.영어비율 || 0,
      탐구비율: row.탐구비율 || 0,
      영어등급: input.englishGrade,
      한국사등급: input.khistoryGrade,
      탐구과목수: row.탐구과목수 || 0,
      한국사반영방식: row.한국사반영방식 || ''
    };
  }).filter(Boolean);

  results.sort((a, b) => b.최종합산점수 - a.최종합산점수);
  return results;
};
