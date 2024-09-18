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
app.post('/calculate-score', (req, res) => {
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

          // 국어, 수학, 탐구 점수 계산
          if (school.계산방법 === '백/백') {
            totalScore += student.국어백분위 * school.국어반영비율;
            totalScore += student.수학백분위 * school.수학반영비율;
          } else if (school.계산방법 === '백/표') {
            totalScore += student.국어백분위 * school.국어반영비율;
            totalScore += student.수학백분위 * school.수학반영비율;
          }

          // 탐구 과목 처리
          let 탐구점수;
          if (school.탐구반영과목수 === 1) {
            탐구점수 = Math.max(student.탐구1표준점수, student.탐구2표준점수);
          } else if (school.탐구반영과목수 === 2) {
            탐구점수 = (student.탐구1표준점수 + student.탐구2표준점수) / 2;
          }
          totalScore += 탐구점수 * school.탐구반영비율;

          // 영어 등급 점수 처리
          const englishGradeScore = englishResults[0][`등급${student.영어등급}`];
          totalScore += englishGradeScore * school.영어반영비율;

          // 한국사 점수 처리
          const koreanHistoryGradeScore = koreanHistoryResults[0][`등급${student.한국사등급}`];
          if (school.한국사반영방법 === '총점합산') {
            totalScore += koreanHistoryGradeScore;
          }

          // 총점 환산
          totalScore = (totalScore / 100) * school.총점만점;

          res.json({ totalScore });
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
