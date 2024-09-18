const express = require('express');
const mysql = require('mysql');
const cors = require('cors');  // CORS 미들웨어 추가

// 데이터베이스 연결 설정
const db_config = {
  host: '211.37.174.218',
  user: 'maxilsan',
  password: 'q141171616!',
  database: 'max',
  charset: 'utf8mb4'
};

// MySQL 데이터베이스 연결
const connection = mysql.createConnection(db_config);

connection.connect((err) => {
  if (err) {
    console.error('MySQL 연결 오류:', err);
    return;
  }
  console.log('MySQL에 연결되었습니다.');
});

// Express 앱 생성
const app = express();
app.use(express.json());  // JSON 파싱

// CORS 설정
app.use(cors({
  origin: ['https://supermax.co.kr', 'https://seanyjeong.github.io', 'https://chejump.com', 'https://score.ilsanmax.com']
}));

// 점수 계산 API
app.post('/api/calculate-score', (req, res) => {
  const { studentName, schoolName, major } = req.body;

  if (!studentName || !schoolName || !major) {
    return res.status(400).json({ error: '필수 파라미터가 누락되었습니다.' });
  }

  // 학생 정보 가져오기
  connection.query('SELECT * FROM 학생정보 WHERE 이름 = ?', [studentName], (err, studentResults) => {
    if (err) {
      console.error('학생 정보 조회 오류:', err);
      return res.status(500).json({ error: '학생 정보를 불러오는 중 오류가 발생했습니다.' });
    }
    if (!studentResults.length) {
      return res.status(404).json({ error: '해당 학생을 찾을 수 없습니다.' });
    }
    const student = studentResults[0];

    // 학교 정보 가져오기
    connection.query('SELECT * FROM 학교 WHERE 학교명 = ? AND 전공 = ?', [schoolName, major], (err, schoolResults) => {
      if (err) {
        console.error('학교 정보 조회 오류:', err);
        return res.status(500).json({ error: '학교 정보를 불러오는 중 오류가 발생했습니다.' });
      }
      if (!schoolResults.length) {
        return res.status(404).json({ error: '해당 학교 또는 전공을 찾을 수 없습니다.' });
      }
      const school = schoolResults[0];

      // 영어와 한국사 점수 가져오기
      connection.query('SELECT * FROM 영어 WHERE 학교명 = ? AND 전공 = ?', [schoolName, major], (err, englishResults) => {
        if (err) {
          console.error('영어 점수 조회 오류:', err);
          return res.status(500).json({ error: '영어 점수를 불러오는 중 오류가 발생했습니다.' });
        }

        connection.query('SELECT * FROM 한국사 WHERE 학교명 = ? AND 전공 = ?', [schoolName, major], (err, koreanHistoryResults) => {
          if (err) {
            console.error('한국사 점수 조회 오류:', err);
            return res.status(500).json({ error: '한국사 점수를 불러오는 중 오류가 발생했습니다.' });
          }

          let totalScore = 0;
          let logMessages = []; // 로그 저장 배열

          // 국어, 수학 점수 계산 (계산방법에 따라 백분위 사용)
          const 국어점수 = student.국어백분위 * school.국어반영비율;
          const 수학점수 = student.수학백분위 * school.수학반영비율;
          totalScore += 국어점수;
          totalScore += 수학점수;
          logMessages.push(`국어 점수: ${student.국어백분위} * ${school.국어반영비율} = ${국어점수}`);
          logMessages.push(`수학 점수: ${student.수학백분위} * ${school.수학반영비율} = ${수학점수}`);

          // 탐구 과목 처리 (탐구반영과목수에 따른 처리)
          let 탐구점수;
          if (school.탐구반영과목수 === 1) {
            탐구점수 = Math.max(student.탐구1백분위, student.탐구2백분위);
            logMessages.push(`탐구 과목 (1개 반영): 최고 점수 = ${탐구점수}`);
          } else if (school.탐구반영과목수 === 2) {
            탐구점수 = (student.탐구1백분위 + student.탐구2백분위) / 2;
            logMessages.push(`탐구 과목 (2개 반영): 평균 점수 = ${탐구점수}`);
          }
          totalScore += 탐구점수 * school.탐구반영비율;
          logMessages.push(`탐구 점수: ${탐구점수} * ${school.탐구반영비율} = ${탐구점수 * school.탐구반영비율}`);

          // 영어 점수 처리
          const englishGradeScore = englishResults[0][`등급${student.영어등급}`];
          totalScore += englishGradeScore * school.영어반영비율;
          logMessages.push(`영어 점수: ${englishGradeScore} * ${school.영어반영비율} = ${englishGradeScore * school.영어반영비율}`);

          // 한국사 점수 처리
          const koreanHistoryGradeScore = koreanHistoryResults[0][`등급${student.한국사등급}`];
          if (school.한국사반영방법 === '총점합산') {
            totalScore += koreanHistoryGradeScore;
            logMessages.push(`한국사 점수: ${koreanHistoryGradeScore}`);
          }

          // 총점 환산 (300점 만점 기준)
          totalScore = (totalScore / 100) * school.총점만점;
          logMessages.push(`최종 환산 점수: (총점 / 100) * ${school.총점만점} = ${totalScore}`);

          // 결과 반환 (점수와 로그 함께)
          res.json({ totalScore: totalScore.toFixed(2), logs: logMessages });
        });
      });
    });
  });
});

// 포트 설정
const PORT = 4000;

// 서버 시작
app.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
