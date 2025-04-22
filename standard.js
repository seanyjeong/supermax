module.exports = function(input, rows, 최고점Map) {
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
  
      if (기준 === '최고점') {
        const 최고점 = 최고점Map[subjectName];
        return 최고점 ? stdScore / 최고점 : 0;
      } else if (기준 === '200') {
        return stdScore / 200;
      } else {
        return 0;
      }
    }
  
    const results = rows.map(row => {
      const 영어등급점수 = row[`영어${input.englishGrade}등급점수`] || 0;
      const 한국사등급점수 = row[`한국사${input.khistoryGrade}등급점수`] || 0;
  
      let 수학점수 = input.math_std;
      let 탐구1점수 = input.subject1_std;
      let 탐구2점수 = input.subject2_std;
  
      // 수학 가산점 적용
      if (row.수학가산과목조건) {
        const 조건들 = row.수학가산과목조건.split(',');
        조건들.forEach(조건 => {
          const [과목, 퍼센트] = 조건.split(':');
          if (input.mathSubject === 과목.trim()) {
            수학점수 *= (1 + parseFloat(퍼센트 || 0) / 100);
          }
        });
      }
  
      // 탐구 가산점 적용
      if (row.탐구가산과목조건?.includes('과탐')) {
        const 가산 = parseFloat(row.탐구가산과목조건.split(':')[1] || 0);
        if (과탐목록.includes(input.subject1Name)) 탐구1점수 *= (1 + 가산 / 100);
        if (과탐목록.includes(input.subject2Name)) 탐구2점수 *= (1 + 가산 / 100);
      }
  
      // 탐구 계산
      let 탐구 = 0;
      if (row.탐구과목수 === 2) {
        탐구 = (탐구1점수 + 탐구2점수) / 2;
      } else if (row.탐구과목수 === 1) {
        탐구 = Math.max(탐구1점수, 탐구2점수);
      }
  
      // 공통 환산 처리
      const 기준 = row.표준점수만점;
  
      const 국어환산 = getConvertedScore(input.korean_std, input.koreanSubject, 기준);
      const 수학환산 = getConvertedScore(수학점수, input.mathSubject, 기준);
      const 영어환산 = getConvertedScore(input.english_std, '영어', 기준);
      const 탐구환산 = getConvertedScore(탐구, '탐구', 기준);
  
      const 국어점수 = 국어환산 * (row.국어비율 / 100);
      const 수학점수_가산 = 수학환산 * (row.수학비율 / 100);
  
      let 영어점수 = 0;
      if (row.영어비율 !== '감점') {
        영어점수 = 영어환산 * (parseFloat(row.영어비율) / 100);
      }
  
      const 탐구점수 = 탐구환산 * (row.탐구비율 / 100);
  
      let 선택점수 = 0;
      let 수능최종반영점수 = 0;
  
      // ✅ 기본 분기: 수능선택조건 없으면 비율 그대로 반영$1
      if (!row.수능선택조건 || row.수능선택조건.trim() === '') {
        선택점수 = 국어점수 + 수학점수_가산 + 영어점수;
        수능최종반영점수 = (선택점수 + 탐구점수) * (row.수능반영비율 / 100);
      }
      
  
      // ✅ 국수영택2: 국어, 수학, 영어 중 상위 2개 과목만 반영 + 탐구는 비율대로
      else if (row.수능선택조건 === '국수영택2') {
        const candidates = [
          { 점수: 국어점수, 비율: row.국어비율 || 0 },
          { 점수: 수학점수_가산, 비율: row.수학비율 || 0 },
          { 점수: 영어점수, 비율: row.영어비율 !== '감점' ? parseFloat(row.영어비율) : 0 }
        ];
  
        candidates.sort((a, b) => b.점수 - a.점수);
        const top2 = candidates.slice(0, 2);
  
        선택점수 = top2.reduce((acc, cur) => acc + cur.점수, 0);
        수능최종반영점수 = (선택점수 + 탐구점수) * (row.수능반영비율 / 100);
      }
  
      if (row.한국사반영방식 === '가산점') {
        수능최종반영점수 += 한국사등급점수;
      }
  
      if (row.영어비율 === '감점') {
        수능최종반영점수 += 영어등급점수;
      }
  
      return {
        대학명: row.대학명,
        학과명: row.학과명,
        최종합산점수: Math.round(수능최종반영점수 * 10) / 10,
        수능최종반영점수: Math.round(수능최종반영점수 * 10) / 10,
        선택점수: Math.round(선택점수 * 10) / 10,
        국어: input.korean_std,
        수학: input.math_std,
        영어: input.english_std,
        영어등급: input.englishGrade,
        탐구: 탐구,
        한국사등급: input.khistoryGrade,
        수능반영비율: row.수능반영비율,
        수능선택조건: row.수능선택조건,
        국어비율: row.국어비율,
        수학비율: row.수학비율,
        영어비율: row.영어비율,
        탐구비율: row.탐구비율,
        탐구과목수: row.탐구과목수,
        한국사반영방식: row.한국사반영방식
      };
    }).filter(Boolean);
  
    results.sort((a, b) => b.최종합산점수 - a.최종합산점수);
    return results;
  };
  