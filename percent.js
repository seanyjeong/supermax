   
   
   
   module.exports = function(input, rows) {
   
    const 과탐목록 = ["물리1", "물리2", "화학1", "화학2", "생명과학1", "생명과학2", "지구과학1", "지구과학2"];

    const results = rows.map(row => {
      const 영어등급점수 = row[`영어${input.englishGrade}등급점수`] || 0;
      const 한국사등급점수 = row[`한국사${input.khistoryGrade}등급점수`] || 0;

      let 수능최종반영점수 = 0;
      let 선택점수 = 0;

      let 수학점수 = input.math;
      let 탐구1점수 = input.subject1;
      let 탐구2점수 = input.subject2;

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
if (typeof row.탐구가산과목조건 === 'string' && row.탐구가산과목조건.includes('과탐')) {
  const parts = row.탐구가산과목조건.split(':');
  const 가산 = parseFloat(parts[1]) || 0;
  if (과탐목록.includes(input.subject1Name)) 탐구1점수 *= (1 + 가산 / 100);
  if (과탐목록.includes(input.subject2Name)) 탐구2점수 *= (1 + 가산 / 100);
}


      let 탐구 = 0;
      if (row.탐구과목수 === 2) {
        탐구 = (탐구1점수 + 탐구2점수) / 2;
      } else if (row.탐구과목수 === 1) {
        탐구 = Math.max(탐구1점수, 탐구2점수);
      }
//조건없음
      if (!row.수능선택조건 || row.수능선택조건.trim() === '') {
        const 국어점수 = input.korean * (row.국어비율 / 100);
        const 수학점수_가산 = 수학점수 * (row.수학비율 / 100);
        const 영어점수 = 영어등급점수 * (row.영어비율 / 100);
        const 탐구점수 = 탐구 * (row.탐구비율 / 100);

        선택점수 = 국어점수 + 수학점수_가산 + 영어점수 + 탐구점수;
        수능최종반영점수 = 선택점수 * (row.수능반영비율 / 100);
      } 
      //수영택1
      else if (row.수능선택조건 === '수영택1') {
        const 선택 = 수학점수 >= 영어등급점수
          ? 수학점수 * (row.수학비율 / 100)
          : 영어등급점수 * (row.영어비율 / 100);
        const 국어점수 = input.korean * (row.국어비율 / 100);
        const 탐구점수 = 탐구 * (row.탐구비율 / 100);
        선택점수 = 선택;
        수능최종반영점수 = (국어점수 + 선택 + 탐구점수) * (row.수능반영비율 / 100);
      } 
      //국수영탐택2
      else if (row.수능선택조건 === '국수영탐택2') {
        const candidates = [input.korean, 수학점수, 영어등급점수, 탐구];
        candidates.sort((a, b) => b - a);
        선택점수 = (candidates[0] + candidates[1]) / 2;
        수능최종반영점수 = 선택점수 * (row.수능반영비율 / 100);
      }
        //국수4020
else if (row.수능선택조건 === '국수4020') {
  const 국어 = input.korean;
  const 수학 = 수학점수; // ✅ 가산점 반영된 값 사용

  let 국어점수 = 0;
  let 수학점수_최종 = 0;

  if (국어 >= 수학) {
    국어점수 = 국어 * 0.4;
    수학점수_최종 = 수학 * 0.2;
  } else {
    국어점수 = 국어 * 0.2;
    수학점수_최종 = 수학 * 0.4;
  }

  const 영어점수 = 영어등급점수 * (row.영어비율 / 100);
  const 탐구점수 = 탐구 * (row.탐구비율 / 100); // ✅ 위에서 가중치 적용된 값

  선택점수 = 국어점수 + 수학점수_최종;
  수능최종반영점수 = (국어점수 + 수학점수_최종 + 영어점수 + 탐구점수) * (row.수능반영비율 / 100);
}

     // 국수영352520
      else if (row.수능선택조건 === '국수영352520') {
  const 점수들 = [
    { 과목: '국어', 점수: input.korean },
    { 과목: '수학', 점수: 수학점수 },
    { 과목: '영어', 점수: 영어등급점수 }
  ];

  점수들.sort((a, b) => b.점수 - a.점수);

  const 반영비율 = [0.35, 0.25, 0.2];
  let 합산 = 0;

  점수들.forEach((entry, i) => {
    합산 += entry.점수 * 반영비율[i];
  });

  // 탐구점수는 이미 위에서 계산된 값 그대로 사용
  const 탐구점수 = 탐구 * (row.탐구비율 / 100);

  선택점수 = 합산 + 탐구점수;
  수능최종반영점수 = 선택점수 * (row.수능반영비율 / 100);
}
      //다중선택6040중복X                       
else if (row.수능선택조건 === '다중선택6040중복X') {
  const 과목점수 = {
    국어: input.korean,
    수학: 수학점수,
    영어: 영어등급점수,
    탐구: 탐구  // 이미 위에서 계산된 값 사용
  };

  // ✅ 1차: 국/수/영 중 가장 높은 점수
  const firstCandidates = ['국어', '수학', '영어'];
  const first = firstCandidates.map(name => ({ name, 점수: 과목점수[name] }))
    .sort((a, b) => b.점수 - a.점수)[0];

  // ✅ 2차: 나머지 과목 중 가장 높은 점수 (중복 제외)
  const secondCandidates = Object.entries(과목점수)
    .filter(([name]) => name !== first.name)
    .map(([name, 점수]) => ({ name, 점수 }));

  const second = secondCandidates.sort((a, b) => b.점수 - a.점수)[0];

  선택점수 = (first.점수 * 0.6) + (second.점수 * 0.4);
  수능최종반영점수 = 선택점수 * (row.수능반영비율 / 100);

}
// ✅ 국수영탐택3: 국/수/영/탐 중 상위 3개 평균
else if (row.수능선택조건 === '국수영탐택3') {
  const candidates = [input.korean, 수학점수, 영어등급점수, 탐구];
  candidates.sort((a, b) => b - a);
  선택점수 = (candidates[0] + candidates[1] + candidates[2]) / 3;
  수능최종반영점수 = 선택점수 * (row.수능반영비율 / 100);
}
// ✅ 국수택1: 국어 / 수학 중 상위 1과목만 반영, 나머지 과목은 비율대로
else if (row.수능선택조건 === '국수택1') {
  const 국어비율 = row.국어비율 ?? 0;
  const 수학비율 = row.수학비율 ?? 0;
  const 영어비율 = row.영어비율 ?? 0;
  const 탐구비율 = row.탐구비율 ?? 0;

  // 국/수 중 더 높은 점수 선택 → 해당 과목은 원 점수 사용
  let 국어점수 = 0;
  let 수학점수_가산 = 0;
  if (input.korean >= 수학점수) {
    국어점수 = input.korean;
    수학점수_가산 = 수학점수 * (수학비율 / 100);
  } else {
    수학점수_가산 = 수학점수;
    국어점수 = input.korean * (국어비율 / 100);
  }

  // 영어, 탐구는 비율 적용
  const 영어점수 = 영어등급점수 * (영어비율 / 100);
  const 탐구점수 = 탐구 * (탐구비율 / 100);

  선택점수 = 국어점수 + 수학점수_가산 + 영어점수 + 탐구점수;
  수능최종반영점수 = 선택점수 * (row.수능반영비율 / 100);
}
// ✅ 국수탐택2: 국/수/탐 중 상위 2개 반영 + 영어는 무조건 비율대로
else if (row.수능선택조건 === '국수탐택2') {
  const 국수탐목록 = [
    { 이름: '국어', 점수: input.korean, 비율: row.국어비율 },
    { 이름: '수학', 점수: 수학점수, 비율: row.수학비율 },
    { 이름: '탐구', 점수: 탐구, 비율: row.탐구비율 }
  ];

  // 점수 높은 순으로 정렬
  국수탐목록.sort((a, b) => b.점수 - a.점수);

  // 상위 2개 과목 반영
  선택점수 =
    (국수탐목록[0].점수 * (국수탐목록[0].비율 || 0) / 100) +
    (국수탐목록[1].점수 * (국수탐목록[1].비율 || 0) / 100);

  // 영어는 비율대로 반영 (무조건 포함)
  const 영어점수 = 영어등급점수 * (row.영어비율 || 0) / 100;
  선택점수 += 영어점수;

  수능최종반영점수 = 선택점수 * (row.수능반영비율 / 100);
}
// ✅ 국수영택2: 국어, 수학, 영어 중 상위 2개 과목만 반영 (각 과목별 비율 적용), 탐구는 비율대로
else if (row.수능선택조건 === '국수영택2') {
  const 과목점수 = [
    { name: '국어', 점수: input.korean, 비율: row.국어비율 || 0 },
    { name: '수학', 점수: 수학점수, 비율: row.수학비율 || 0 },
    { name: '영어', 점수: 영어등급점수, 비율: row.영어비율 || 0 }
  ];

  // 상위 2개 선택
  과목점수.sort((a, b) => b.점수 - a.점수);
  const top2 = 과목점수.slice(0, 2);

  let 합산 = 0;
  top2.forEach(entry => {
    합산 += entry.점수 * (entry.비율 / 100);
  });

  const 탐구점수 = 탐구 * (row.탐구비율 / 100);
  선택점수 = 합산 + 탐구점수;
  수능최종반영점수 = 선택점수 * (row.수능반영비율 / 100);
}
// ✅ 국수영택1: 국어/수학/영어 중 잘 본 1개 반영, 나머지는 각 과목 비율 반영
else if (row.수능선택조건 === '국수영택1') {
  const 과목들 = [
    { 이름: '국어', 점수: input.korean, 비율: row.국어비율 || 0 },
    { 이름: '수학', 점수: 수학점수, 비율: row.수학비율 || 0 },
    { 이름: '영어', 점수: 영어등급점수, 비율: row.영어비율 || 0 }
  ];

  // 상위 1개 찾기
  const best = [...과목들].sort((a, b) => b.점수 - a.점수)[0];

  // 계산
  let 총합 = 0;
  과목들.forEach(과목 => {
    const 반영비율 = 과목.비율 / 100;
    const 점수 = (과목.이름 === best.이름 ? best.점수 : 과목.점수) * 반영비율;
    총합 += 점수;
  });

  const 탐구점수 = 탐구 * ((row.탐구비율 || 0) / 100);

  선택점수 = 총합 + 탐구점수;
  수능최종반영점수 = 선택점수 * (row.수능반영비율 / 100);
}
// ✅ 영탐택1: 영어/탐구 중 상위 1개 반영 + 국어, 수학은 비율대로
else if (row.수능선택조건 === '영탐택1') {
  const 선택 = 영어등급점수 >= 탐구
    ? 영어등급점수 * (row.영어비율 || 0) / 100
    : 탐구 * (row.탐구비율 || 0) / 100;

  const 국어점수 = input.korean * (row.국어비율 || 0) / 100;
  const 수학점수_가산 = 수학점수 * (row.수학비율 || 0) / 100;

  선택점수 = 선택;
  수능최종반영점수 = (선택 + 국어점수 + 수학점수_가산) * (row.수능반영비율 || 100) / 100;
}
// ✅ 수탐택1: 수학/탐구 중 상위 1개 반영 + 국어, 영어는 비율대로
else if (row.수능선택조건 === '수탐택1') {
  const 선택 = 수학점수 >= 탐구
    ? 수학점수 * (row.수학비율 || 0) / 100
    : 탐구 * (row.탐구비율 || 0) / 100;

  const 국어점수 = input.korean * (row.국어비율 || 0) / 100;
  const 영어점수 = 영어등급점수 * (row.영어비율 || 0) / 100;

  선택점수 = 선택;
  수능최종반영점수 = (선택 + 국어점수 + 영어점수) * (row.수능반영비율 || 100) / 100;
}
// ✅ 국탐택1: 국어/탐구 중 잘 본 거 1개 선택, 나머지(수학, 영어)는 비율대로
else if (row.수능선택조건 === '국탐택1') {
  const 선택 = input.korean >= 탐구
    ? input.korean * (row.국어비율 || 0) / 100
    : 탐구 * (row.탐구비율 || 0) / 100;

  const 수학점수_가산 = 수학점수 * (row.수학비율 || 0) / 100;
  const 영어점수 = 영어등급점수 * (row.영어비율 || 0) / 100;

  선택점수 = 선택;
  수능최종반영점수 = (선택 + 수학점수_가산 + 영어점수) * (row.수능반영비율 || 100) / 100;
}
// ✅ 다중선택8020: 국수영탐 중 상위 2과목 80%, 20% 반영 (중복 불가)
else if (row.수능선택조건 === '다중선택8020') {
  const 과목점수 = {
    국어: input.korean,
    수학: 수학점수,
    영어: 영어등급점수,
    탐구: 탐구,
  };

  const 정렬 = Object.entries(과목점수)
    .map(([name, score]) => ({ name, score }))
    .sort((a, b) => b.score - a.score);

  const top1 = 정렬[0];
  const top2 = 정렬.find(item => item.name !== top1.name);

  선택점수 = (top1.score * 0.8) + (top2.score * 0.2);
  수능최종반영점수 = 선택점수 * (row.수능반영비율 || 100) / 100;
}
// ✅ 국수영택2탐한1: 국수영 중 상위2개 + 탐구/한국사 중 상위1개 반영
else if (row.수능선택조건 === '국수영택2탐한1') {
  const 국수영 = [
    { 과목: '국어', 점수: input.korean, 비율: row.국어비율 || 0 },
    { 과목: '수학', 점수: 수학점수, 비율: row.수학비율 || 0 },
    { 과목: '영어', 점수: 영어등급점수, 비율: row.영어비율 || 0 }
  ].sort((a, b) => b.점수 - a.점수);

  const 선택2개점수 =
    (국수영[0].점수 * (국수영[0].비율 / 100)) +
    (국수영[1].점수 * (국수영[1].비율 / 100));

  const 탐구점수 = 탐구 * ((row.탐구비율 || 0) / 100);

  let 한국사비율 = 0;
  if (!isNaN(Number(row.한국사반영방식))) {
    한국사비율 = Number(row.한국사반영방식);
  }
  const 한국사점수 = (row[`한국사${input.khistoryGrade}등급점수`] || 0) * (한국사비율 / 100);

  const 탐구or한사 = Math.max(탐구점수, 한국사점수);

  선택점수 = 선택2개점수 + 탐구or한사;
  수능최종반영점수 = 선택점수 * (row.수능반영비율 || 100) / 100;
}
// ✅ 다중선택503020: 국수영탐 중 상위 3과목 50/30/20 반영 (중복 ❌)
else if (row.수능선택조건 === '다중선택503020') {
  const all = [
    { name: '국어', 점수: input.korean },
    { name: '수학', 점수: 수학점수 },
    { name: '영어', 점수: 영어등급점수 },
    { name: '탐구', 점수: 탐구 }
  ];

  // 점수 높은 순 정렬 후 중복 없이 상위 3개 선택
  const first = all.sort((a, b) => b.점수 - a.점수)[0];
  const second = all.filter(a => a.name !== first.name).sort((a, b) => b.점수 - a.점수)[0];
  const third = all.filter(a => a.name !== first.name && a.name !== second.name).sort((a, b) => b.점수 - a.점수)[0];

  선택점수 = (first.점수 * 0.5) + (second.점수 * 0.3) + (third.점수 * 0.2);
  수능최종반영점수 = 선택점수 * (row.수능반영비율 || 100) / 100;
}
// ✅ 다중선택6040: 국수영탐 중 상위 2과목 60%, 40% 반영 (중복 ❌)
else if (row.수능선택조건 === '다중선택6040') {
  const 과목점수 = {
    국어: input.korean,
    수학: 수학점수,
    영어: 영어등급점수,
    탐구: 탐구
  };

  const 정렬 = Object.entries(과목점수)
    .map(([name, score]) => ({ name, score }))
    .sort((a, b) => b.score - a.score);

  const first = 정렬[0];
  const second = 정렬.find(e => e.name !== first.name); // 중복 방지

  선택점수 = (first.score * 0.6) + (second.score * 0.4);
  수능최종반영점수 = 선택점수 * (row.수능반영비율 / 100);
}
// ✅ 다중선택6040한포 : 국수영탐한국사 중 상위 2개 선택 (60%, 40%)
else if (row.수능선택조건 === '다중선택6040한포') {
  const 후보 = [
    { name: '국어', 점수: input.korean },
    { name: '수학', 점수: 수학점수 },
    { name: '영어', 점수: 영어등급점수 },
    { name: '탐구', 점수: 탐구 },
    { name: '한국사', 점수: 한국사등급점수 }
  ];

  후보.sort((a, b) => b.점수 - a.점수);
  const first = 후보[0];
  const second = 후보.find(c => c.name !== first.name); // 중복 제외

  선택점수 = (first.점수 * 0.6) + (second.점수 * 0.4);
  수능최종반영점수 = 선택점수 * (row.수능반영비율 / 100);
}
// ✅ 다중선택404020 : 국수영탐 중 상위 3개 과목 → 40%, 40%, 20%
else if (row.수능선택조건 === '다중선택404020') {
  const 후보 = [
    { name: '국어', 점수: input.korean },
    { name: '수학', 점수: 수학점수 },
    { name: '영어', 점수: 영어등급점수 },
    { name: '탐구', 점수: 탐구 }
  ];

  후보.sort((a, b) => b.점수 - a.점수);
  const first = 후보[0];
  const second = 후보.find(c => c.name !== first.name);
  const third = 후보.find(c => c.name !== first.name && c.name !== second.name);

  선택점수 = (first.점수 * 0.4) + (second.점수 * 0.4) + (third.점수 * 0.2);
  수능최종반영점수 = 선택점수 * (row.수능반영비율 / 100);
}
// ✅ 국수탐1탐2택2 : 국어, 수학, 탐1, 탐2 중 상위 2개 비율 반영 (중복 허용, 영어 제외)
else if (row.수능선택조건 === '국수탐1탐2택2') {
  const 후보 = [
    { name: '국어', 점수: input.korean, 비율: (row.국어비율 ?? 0) },
    { name: '수학', 점수: 수학점수, 비율: (row.수학비율 ?? 0) },
    { name: '탐1', 점수: 탐구1점수, 비율: (row.탐구비율 ?? 0) },
    { name: '탐2', 점수: 탐구2점수, 비율: (row.탐구비율 ?? 0) }
  ];

  후보.sort((a, b) => b.점수 - a.점수);
  const top2 = 후보.slice(0, 2);

  선택점수 = top2.reduce((acc, cur) => acc + (cur.점수 * (cur.비율 / 100)), 0);
  수능최종반영점수 = 선택점수 * (row.수능반영비율 / 100);
}
// ✅ 다중선택7030중복X : 국수영 중 1개(70%) + 나머지 + 탐구 중 1개(30%) (중복 불가)
else if (row.수능선택조건 === '다중선택7030중복X') {
  const 국수영후보 = [
    { name: '국어', 점수: input.korean },
    { name: '수학', 점수: 수학점수 },
    { name: '영어', 점수: 영어등급점수 }
  ];

  const 탐구점수 = 탐구; // 위에서 계산 완료됨

  // 1차 선택: 국수영 중 최고
  국수영후보.sort((a, b) => b.점수 - a.점수);
  const first = 국수영후보[0];

  // 2차 선택: 탐구 포함, 첫 번째 과목 제외하고 최고
  const second후보 = [
    ...국수영후보.filter(c => c.name !== first.name),
    { name: '탐구', 점수: 탐구점수 }
  ];
  second후보.sort((a, b) => b.점수 - a.점수);
  const second = second후보[0];

  선택점수 = (first.점수 * 0.7) + (second.점수 * 0.3);
  수능최종반영점수 = 선택점수 * (row.수능반영비율 / 100);
}








      else {
        return null;
      }

      if (row.한국사반영방식 === '가산점') {
        수능최종반영점수 += 한국사등급점수;
      }

      return {
        대학명: row.대학명,
        학과명: row.학과명,
        최종합산점수: Math.round(수능최종반영점수 * 10) / 10,
        수능최종반영점수: Math.round(수능최종반영점수 * 10) / 10,
        선택점수: Math.round(선택점수 * 10) / 10,
        국어: input.korean,
        수학: input.math,
        영어: input.english,
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
