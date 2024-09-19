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
// 학교 목록 API
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

      // 영어 점수 가져오기
      connection.query('SELECT * FROM 영어 WHERE 학교명 = ? AND 전공 = ?', [schoolName, major], (err, englishResults) => {
        if (err) {
          console.error('영어 점수 조회 오류:', err);
          return res.status(500).json({ error: '영어 점수를 불러오는 중 오류가 발생했습니다.' });
        }

        // 한국사 점수 가져오기
        connection.query('SELECT * FROM 한국사 WHERE 학교명 = ? AND 전공 = ?', [schoolName, major], (err, koreanHistoryResults) => {
          if (err) {
            console.error('한국사 점수 조회 오류:', err);
            return res.status(500).json({ error: '한국사 점수를 불러오는 중 오류가 발생했습니다.' });
          }

          let totalScore = 0;
          let logMessages = []; // 로그 저장 배열

          // 국어, 수학, 영어, 탐구 점수들을 배열에 저장
          let scores = [];

          // 국어 점수 처리
          if (school.계산방법 === '백/백') {
            scores.push({ name: '국어', value: student.국어백분위 });
          } else if (school.계산방법 === '백/표') {
            scores.push({ name: '국어', value: student.국어표준점수 });
          }

          // 수학 점수 처리
          if (school.계산방법 === '백/백') {
            scores.push({ name: '수학', value: student.수학백분위 });
          } else if (school.계산방법 === '백/표') {
            scores.push({ name: '수학', value: student.수학표준점수 });
          }

          // 영어 점수 처리
          const englishGradeScore = englishResults[0][`등급${student.영어등급}`];
          scores.push({ name: '영어', value: englishGradeScore });

          // 탐구 과목 처리
          let 탐구점수;
          if (school.탐구반영과목수 === 1) {
            if (school.계산방법 === '백/백') {
              탐구점수 = Math.max(student.탐구1백분위, student.탐구2백분위);
            } else if (school.계산방법 === '백/표') {
              탐구점수 = Math.max(student.탐구1표준점수, student.탐구2표준점수);
            }
          } else if (school.탐구반영과목수 === 2) {
            if (school.계산방법 === '백/백') {
              탐구점수 = (student.탐구1백분위 + student.탐구2백분위) / 2;
            } else if (school.계산방법 === '백/표') {
              탐구점수 = (student.탐구1표준점수 + student.탐구2표준점수) / 2;
            }
          }
          scores.push({ name: '탐구', value: 탐구점수 });

          // 선택과목 규칙 처리
          switch (school.선택과목규칙) {
            case '국수영탐택3':
              // 상위 3개 과목을 선택해서 합산
              scores.sort((a, b) => b.value - a.value);
              let selectedScores3 = scores.slice(0, 3);
              selectedScores3.forEach(score => {
                totalScore += score.value;
                logMessages.push(`${score.name} 점수: ${score.value}`);
              });
              break;

            case '국수영탐532':
              // 상위 3개의 점수에 각각 50%, 30%, 20% 비율 적용
              scores.sort((a, b) => b.value - a.value);
              let selectedScores532 = scores.slice(0, 3);
              if (selectedScores532.length === 3) {
                totalScore += selectedScores532[0].value * 0.5;
                logMessages.push(`${selectedScores532[0].name} 점수: ${selectedScores532[0].value} * 0.5 = ${selectedScores532[0].value * 0.5}`);
                totalScore += selectedScores532[1].value * 0.3;
                logMessages.push(`${selectedScores532[1].name} 점수: ${selectedScores532[1].value} * 0.3 = ${selectedScores532[1].value * 0.3}`);
                totalScore += selectedScores532[2].value * 0.2;
                logMessages.push(`${selectedScores532[2].name} 점수: ${selectedScores532[2].value} * 0.2 = ${selectedScores532[2].value * 0.2}`);
              }
              break;

            case '국수택1':
              // 국어, 수학 중 상위 1개 선택, 나머지(영어, 탐구)는 그대로 비율대로
              let 국수점수 = Math.max(
                school.계산방법 === '백/백' ? student.국어백분위 : student.국어표준점수,
                school.계산방법 === '백/백' ? student.수학백분위 : student.수학표준점수
              ) * (school.국어반영비율 > school.수학반영비율 ? school.국어반영비율 : school.수학반영비율);
              totalScore += 국수점수;
              logMessages.push(`국어/수학 중 선택된 점수: ${국수점수}`);

              // 영어 점수 추가
              totalScore += englishGradeScore * school.영어반영비율;
              logMessages.push(`영어 점수: ${englishGradeScore} * 비율(${school.영어반영비율}) = ${englishGradeScore * school.영어반영비율}`);

              // 탐구 점수 추가
              totalScore += 탐구점수 * school.탐구반영비율;
              logMessages.push(`탐구 점수: ${탐구점수} * 비율(${school.탐구반영비율}) = ${탐구점수 * school.탐구반영비율}`);
              break;

            case '국수영탐택2':
              // 국어, 수학, 영어, 탐구 중 상위 2개를 비율대로 계산
              scores.sort((a, b) => b.value - a.value);
              let selectedScores2 = scores.slice(0, 2);
              selectedScores2.forEach(score => {
                let 반영비율;
                switch (score.name) {
                  case '국어':
                    반영비율 = school.국어반영비율;
                    break;
                  case '수학':
                    반영비율 = school.수학반영비율;
                    break;
                  case '영어':
                    반영비율 = school.영어반영비율;
                    break;
                  case '탐구':
                    반영비율 = school.탐구반영비율;
                    break;
                }
                totalScore += score.value * 반영비율;
                logMessages.push(`${score.name} 점수: ${score.value} * 비율(${반영비율}) = ${score.value * 반영비율}`);
              });

              // 남은 과목은 반영비율대로 계산
              let remainingScores2 = scores.slice(2);
              remainingScores2.forEach(score => {
                let 반영비율;
                switch (score.name) {
                  case '국어':
                    반영비율 = school.국어반영비율;
                    break;
                  case '수학':
                    반영비율 = school.수학반영비율;
                    break;
                  case '영어':
                    반영비율 = school.영어반영비율;
                    break;
                  case '탐구':
                    반영비율 = school.탐구반영비율;
                    break;
                }
                totalScore += score.value * 반영비율;
                logMessages.push(`${score.name} 점수: ${score.value} * 비율(${반영비율}) = ${score.value * 반영비율}`);
              });
              break;

            case '상위3개평균':
              // 국어, 수학, 영어, 탐구 중 상위 3개의 평균을 구함
              scores.sort((a, b) => b.value - a.value);
              let selectedScoresAvg = scores.slice(0, 3);
              let sum = selectedScoresAvg.reduce((acc, score) => acc + score.value, 0);
              let average = sum / 3;
              totalScore = average;
              logMessages.push(`선택된 3개 점수의 합: ${sum}, 평균: ${average}`);
              break;

            default:
              // 선택과목규칙이 null이 아닌 다른 규칙들이 이미 처리되었으므로 여기서는 추가 처리 없음
              break;
          }

          // 총점 환산
          if (['국수영탐택3', '국수영탐532', '국수택1', '국수영탐택2'].includes(school.선택과목규칙) || school.선택과목규칙 === '상위3개평균') {
            // 선택과목규칙이 있을 경우 환산 (300점 또는 400점 등 학교에 따라 다름)
            totalScore = (totalScore / 100) * school.총점만점;
            logMessages.push(`최종 환산 점수: (총점 / 100) * ${school.총점만점} = ${totalScore}`);
          } else if (!school.선택과목규칙) {
            // 선택과목규칙이 null인 경우 이미 환산된 점수
            totalScore = (totalScore / 100) * school.총점만점;
            logMessages.push(`최종 환산 점수: (총점 / 100) * ${school.총점만점} = ${totalScore}`);
          }

          // 한국사 점수 처리 (총점합산일 경우 마지막에 더함)
          const koreanHistoryGradeScore = koreanHistoryResults[0][`등급${student.한국사등급}`];
          if (school.한국사반영방법 === '총점합산') {
            totalScore += koreanHistoryGradeScore;
            logMessages.push(`한국사 점수: ${koreanHistoryGradeScore}`);
          }

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
