// 📂 collegeCalculate.js

const express = require('express');
const router = express.Router();
const { db } = require('./college');
const calculator = require('./collegeCalculator');
const { calculateSpecialSchool } = require('./specialSchools'); //특수학교계산

router.post('/calculate', async (req, res) => {
  const { 대학학과ID, studentScore } = req.body;
  if (!대학학과ID || !studentScore) {
    return res.status(400).json({ message: '대학학과ID, studentScore는 필수입니다.' });
  }

  try {
    const specialSchoolIDs = [1,2,3,30,31,36,37,38,29,28,65,42];  //특수계산 학교들 id 다 써야함
    if (specialSchoolIDs.includes(대학학과ID)) {
      const finalScore = await calculateSpecialSchool(대학학과ID, studentScore);
      return res.json({ success: true, totalScore: finalScore });
    }
      // 1. 학교 비율 불러오기
  const [school] = await dbQuery('SELECT 수능비율, 내신비율, 실기비율, 기타비율,총점기준 FROM 학교 WHERE 대학학과ID = ?', [대학학과ID]);

      if (!school) return res.status(404).json({ message: '학교 정보 없음' });
      // ✨ [추가] 표준점수 최고점 불러오기
  // 최고점 데이터 가져오기
  const 최고점데이터 = await dbQuery('SELECT * FROM 표준점수최고점 LIMIT 1');

  const 표준점수최고점데이터 = {};
  if (최고점데이터.length > 0) {
    const row = 최고점데이터[0];
    for (const key in row) {
      if (key !== 'created_at') {  // created_at 컬럼은 제외
        표준점수최고점데이터[key.trim()] = row[key];
      }
    }
  }


      // 2. 반영비율 규칙 불러오기
      const [rule] = await dbQuery('SELECT * FROM 반영비율규칙 WHERE 대학학과ID = ?', [대학학과ID]);
      if (!rule) return res.status(404).json({ message: '반영비율 규칙 없음' });

      // 3. 탐구/한국사 규칙 불러오기
      const [khistoryRule] = await dbQuery('SELECT * FROM 탐구한국사 WHERE 대학학과ID = ?', [대학학과ID]);
      if (!khistoryRule) return res.status(404).json({ message: '탐구한국사 규칙 없음' });

      // 4. 한국사 등급별 점수
      const [khistoryScore] = await dbQuery('SELECT 등급, 점수 FROM 한국사등급별점수 WHERE 대학학과ID = ?', [대학학과ID]);
      const koreanHistoryScoreRule = khistoryScore ? JSON.parse(khistoryScore.점수) : [];

      // 5. 영어 등급별 점수
      const [englishScore] = await dbQuery('SELECT 등급, 점수 FROM 영어등급별점수 WHERE 대학학과ID = ?', [대학학과ID]);
      const englishScoreRule = englishScore ? JSON.parse(englishScore.점수) : [];
      // 5번 영어등급별 점수까지 다 불러온 후
  // ✨ 탐구 백자표 변환점수 미리 추가
  if (rule.탐구반영지표 === '백자표') {
    const 탐구1구분 = calculator.과목구분(studentScore.subject1Name);
    const 탐구2구분 = calculator.과목구분(studentScore.subject2Name);

    studentScore.탐구1.변환점수 = await get백자표변환점수(대학학과ID, 탐구1구분, studentScore.탐구1.백분위);
    studentScore.탐구2.변환점수 = await get백자표변환점수(대학학과ID, 탐구2구분, studentScore.탐구2.백분위);
    console.log(`🧪 탐구1 변환점수 (${studentScore.subject1Name} - ${탐구1구분}):`, studentScore.탐구1.변환점수);
    console.log(`🧪 탐구2 변환점수 (${studentScore.subject2Name} - ${탐구2구분}):`, studentScore.탐구2.변환점수);
  }


  // 6. 점수셋 만들기

  const koreanHistoryResult = calculator.applyKoreanHistoryScore(studentScore, khistoryRule, koreanHistoryScoreRule);

  const is기본 = rule.표준점수반영기준 === '기본';

  const normalize = (score) => is기본 ? score : score * 100;

  const 점수셋 = {
    국어: normalize(calculator.normalizeScore(
      calculator.getSubjectScore(studentScore.국어, rule.국수영반영지표),
      rule.국수영반영지표,
      rule.표준점수반영기준,
      studentScore.국어과목명,
      표준점수최고점데이터
    )),
    수학: normalize(calculator.normalizeScore(
      calculator.getSubjectScore(studentScore.수학, rule.국수영반영지표),
      rule.국수영반영지표,
      rule.표준점수반영기준,
      studentScore.수학과목명,
      표준점수최고점데이터
    )),
    영어: normalize(calculator.normalizeEnglishScore(
      studentScore.영어등급,
      englishScoreRule,
      rule.영어표준점수만점
    )),
    탐구: (() => {
      if (rule.탐구반영지표 === '백자표') {
        const 탐구1최고점 = studentScore.탐구1_백자표변환표?.[100] ?? 70;
        const 탐구2최고점 = studentScore.탐구2_백자표변환표?.[100] ?? 70;

        let t1 = 0;
        let t2 = 0;

        if (rule.표준점수반영기준 === '최고점') {
          t1 = (studentScore.탐구1.변환점수 || 0) / 탐구1최고점;
          t2 = (studentScore.탐구2.변환점수 || 0) / 탐구2최고점;
        } else if (rule.표준점수반영기준 === '200') {
          t1 = (studentScore.탐구1.변환점수 || 0) / 100;
          t2 = (studentScore.탐구2.변환점수 || 0) / 100;
        } else {
          t1 = (studentScore.탐구1.변환점수 || 0);
          t2 = (studentScore.탐구2.변환점수 || 0);
        }

        if (khistoryRule.탐구과목반영수 === 1) {
          // 1개 반영이면 큰 값만
          return Math.max(t1, t2) * 100;
        } else {
          // 2개 반영이면 평균
          return ((t1 + t2) / 2) * 100;
        }
      } else {
        return calculator.processScienceScore(
          calculator.getSubjectScore(studentScore.탐구1, rule.탐구반영지표),
          calculator.getSubjectScore(studentScore.탐구2, rule.탐구반영지표),
          khistoryRule.탐구과목반영수
        );
      }
    })(),

    한국사: koreanHistoryResult?.점수 || 0 
  };





      // 7. 계산
      const 반영과목리스트 = JSON.parse(rule.과목 || '[]');
      const 반영비율 = JSON.parse(rule.반영비율 || '[]');

      const 그룹정보 = [
        {
          과목리스트: JSON.parse(rule.그룹1_과목 || '[]'),
          선택개수: rule.그룹1_선택개수 || 0,
          반영비율: Array.isArray(rule.그룹1_반영비율) ? rule.그룹1_반영비율 : JSON.parse(rule.그룹1_반영비율 || '0')
        },
        {
          과목리스트: JSON.parse(rule.그룹2_과목 || '[]'),
          선택개수: rule.그룹2_선택개수 || 0,
          반영비율: Array.isArray(rule.그룹2_반영비율) ? rule.그룹2_반영비율 : JSON.parse(rule.그룹2_반영비율 || '0')
        },
        {
          과목리스트: JSON.parse(rule.그룹3_과목 || '[]'),
          선택개수: rule.그룹3_선택개수 || 0,
          반영비율: Array.isArray(rule.그룹3_반영비율) ? rule.그룹3_반영비율 : JSON.parse(rule.그룹3_반영비율 || '0')
        }
      ];


      // ✨ 수능 점수 계산
  const 수능환산점수 = calculator.calculateCollegeScore(
    studentScore,
    { ...school, 국수영반영지표: rule.국수영반영지표, 탐구반영지표: rule.탐구반영지표 },
    점수셋,
    반영과목리스트,
    반영비율,
    rule.반영규칙,
    rule.반영과목수,
    그룹정보,
    school.총점기준
  );


  // 수능비율 가져오기
  const 수능비율 = school.수능비율 || 0;

  // 최종 점수
  let finalScore = 0;

  // 한국사 처리 방식 분기
  if (koreanHistoryResult) {
    if (koreanHistoryResult.처리방식 === '수능환산') {
      finalScore = 수능환산점수 + (koreanHistoryResult.점수 * (school.수능비율 / 100));
    } else if (koreanHistoryResult.처리방식 === '직접더함') {
      finalScore = 수능환산점수 + koreanHistoryResult.점수;
    } else if (koreanHistoryResult.처리방식 === '믹스') {
      finalScore = 수능환산점수; // 믹스는 추가 더하기 없음
    } else {
      finalScore = 수능환산점수;
    }
  } else {
    finalScore = 수능환산점수;
  }



  // 최종 결과 반환
  res.json({ success: true, totalScore: finalScore });



          console.log('🏫 school:', school);
  console.log('📏 rule:', rule);
  console.log('🧮 점수셋:', 점수셋);
  console.log('📚 반영과목리스트:', 반영과목리스트);
  console.log('📊 반영비율:', 반영비율);
  console.log('🔥 최종합산점수:', finalScore);
      console.log('🔥 수능환산점수:', 수능환산점수);
  console.log('🔥 수능비율:', 수능비율);
  console.log('🏛 한국사 처리결과:', koreanHistoryResult);


    } catch (err) {
      console.error('❌ 계산 에러:', err);
      res.status(500).json({ message: '계산 실패' });
    }
  });

  // ✨ 탐구 백자표 변환점수 가져오는 함수
  async function get백자표변환점수(대학학과ID, 구분, 백분위) {
    const sql = `
      SELECT 변환점수 
      FROM 탐구백자표변환점수 
      WHERE 대학학과ID = ? AND 구분 = ? AND 백분위 = ?
    `;
    try {
      const [result] = await dbQuery(sql, [대학학과ID, 구분, 백분위]);
      return result ? parseFloat(result.변환점수) : 0;
    } catch (err) {
      console.error('❌ 백자표 변환점수 조회 실패:', err);
      return 0;
    }
  }

// ✨ DB query promise 버전
function dbQuery(sql, params) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
}


module.exports = router;
