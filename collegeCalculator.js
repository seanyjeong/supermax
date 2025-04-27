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
