async function calcPracticalScore({ 실기ID, scores, db }) {
  // 1. 실기ID → 대학ID
  const [[collegeRow]] = await db.promise().query(
    "SELECT 대학ID FROM 대학정보 WHERE 실기ID=? LIMIT 1", [실기ID]);
  const 대학ID = collegeRow?.대학ID;
  if (!대학ID) throw new Error('대학ID를 찾을 수 없음');

  // 2. 대학ID로 환산 정보 조회
  const [[config]] = await db.promise().query(
    "SELECT 실기반영총점, 기준총점 FROM `26수시실기총점반영` WHERE 대학ID=? LIMIT 1", [대학ID]);
  const 실기반영총점 = config?.실기반영총점 || 100;
  const 기준총점 = config?.기준총점 || (scores.length * 100);

  // 특수식 예시 (실기ID 56, 58)
  if (실기ID == 56 || 실기ID == 58) {
    const top3 = scores
      .filter(x => typeof x === 'number')
      .sort((a, b) => b - a)
      .slice(0, 3)
      .reduce((a, b) => a + b, 0);
    return (top3 / 300) * 실기반영총점;
  }

  // 일반식 (전체합 환산)
  const total = scores.reduce((a, b) => a + (Number(b) || 0), 0);
  return (total / 기준총점) * 실기반영총점;
}

module.exports = calcPracticalScore;





