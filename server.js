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

// 학생 목록 API
app.get('/api/students', (req, res) => {
  connection.query('SELECT 이름 FROM 학생정보', (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'DB 조회 오류' });
    }
    res.json(results);
  });
});
// 학교 목록 API
app.get('/api/schools', (req, res) => {
  connection.query('SELECT DISTINCT 학교명, 전공 FROM 학교', (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'DB 조회 오류' });
    }
    res.json(results);
  });
});

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

          // 국어, 수학, 탐구, 영어 점수들을 배열에 저장
          let scores = [
            { name: '국어', value: student.국어백분위 * school.국어반영비율 },
            { name: '수학', value: student.수학백분위 * school.수학반영비율 },
            { name: '영어', value: englishResults[0][`등급${student.영어등급}`] * school.영어반영비율 }
          ];

          // 탐구 과목 처리 (탐구반영과목수에 따른 처리)
          let 탐구점수;
          if (school.탐구반영과목수 === 1) {
            탐구점수 = Math.max(student.탐구1백분위, student.탐구2백분위);
          } else if (school.탐구반영과목수 === 2) {
            탐구점수 = (student.탐구1백분위 + student.탐구2백분위) / 2;
          }
          scores.push({ name: '탐구', value: 탐구점수 * school.탐구반영비율 });

          // 점수들을 value 기준으로 정렬하고 상위 3개만 선택
          scores.sort((a, b) => b.value - a.value);
          let selectedScores = scores.slice(0, 3);

          // 상위 3개 과목의 점수 합산
          selectedScores.forEach(score => {
            totalScore += score.value;
            logMessages.push(`${score.name} 점수: ${score.value}`);
          });

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
