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

// 계산 API
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
          // 선택과목규칙에 따라 점수 수집 방식을 변경하기 위해 초기화
          let scores = [];

          // 백/백일 경우 백분위를 가져옴
          if (school.계산방법 === '백/백') {
            scores.push({ name: '국어', value: student.국어백분위 });
            scores.push({ name: '수학', value: student.수학백분위 });
          } else if (school.계산방법 === '백/표') {
            scores.push({ name: '국어', value: student.국어표준점수 });
            scores.push({ name: '수학', value: student.수학표준점수 });
          }

          // 영어 점수 처리
          const englishGradeScore = englishResults[0][`등급${student.영어등급}`];
          scores.push({ name: '영어', value: englishGradeScore });

          // 탐구 과목 처리 (탐구반영과목수에 따른 처리)
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

          // 선택과목규칙에 따른 처리
          switch (school.선택과목규칙) {
            case '국수영탐택3':
              // 국어, 수학, 영어, 탐구 중 상위 3개 과목을 선택하여 합산
              scores.push({ name: '탐구', value: 탐구점수 });
              scores.sort((a, b) => b.value - a.value);
              let selectedScores3 = scores.slice(0, 3);
              selectedScores3.forEach(score => {
                totalScore += score.value;
                logMessages.push(`${score.name} 점수: ${score.value}`);
              });

              // 총점 환산 (300점 만점 기준)
              totalScore = (totalScore / 300) * school.총점만점;
              logMessages.push(`최종 환산 점수: (총점 / 300) * ${school.총점만점} = ${totalScore}`);
              break;

            case '국수영탐택2':
              // 국어, 수학, 영어 중 상위 2개를 비율대로 계산
              scores.sort((a, b) => b.value - a.value);
              let selectedScores2 = scores.slice(0, 2);
              selectedScores2.forEach(score => {
                let 반영비율;
                if (score.name === '국어') 반영비율 = school.국어반영비율;
                if (score.name === '수학') 반영비율 = school.수학반영비율;
                if (score.name === '영어') 반영비율 = school.영어반영비율;
                totalScore += score.value * 반영비율;
                logMessages.push(`${score.name} 점수: ${score.value} * 비율(${반영비율}) = ${score.value * 반영비율}`);
              });

              // 탐구 과목 비율 계산
              totalScore += 탐구점수 * school.탐구반영비율;
              logMessages.push(`탐구 점수: ${탐구점수} * 비율(${school.탐구반영비율}) = ${탐구점수 * school.탐구반영비율}`);

              // 총점 환산
              totalScore = (totalScore / 100) * school.총점만점;
              logMessages.push(`최종 환산 점수: (총점 / 100) * ${school.총점만점} = ${totalScore}`);
              break;

            case '국수영탐532':
              // 국어, 수학, 영어, 탐구 중 상위 3개의 점수에 각각 50%, 30%, 20% 비율 적용
              scores.push({ name: '탐구', value: 탐구점수 });
              scores.sort((a, b) => b.value - a.value);
              let selectedScores532 = scores.slice(0, 3);

              // 50%, 30%, 20% 비율 적용
              if (selectedScores532.length >= 3) {
                totalScore += selectedScores532[0].value * 0.5;
                logMessages.push(`${selectedScores532[0].name} 점수: ${selectedScores532[0].value} * 0.5 = ${selectedScores532[0].value * 0.5}`);
                totalScore += selectedScores532[1].value * 0.3;
                logMessages.push(`${selectedScores532[1].name} 점수: ${selectedScores532[1].value} * 0.3 = ${selectedScores532[1].value * 0.3}`);
                totalScore += selectedScores532[2].value * 0.2;
                logMessages.push(`${selectedScores532[2].name} 점수: ${selectedScores532[2].value} * 0.2 = ${selectedScores532[2].value * 0.2}`);
              }

              // 총점 환산
              totalScore = (totalScore / 100) * school.총점만점;
              logMessages.push(`최종 환산 점수: (총점 / 100) * ${school.총점만점} = ${totalScore}`);
              break;

            case '상위3개평균':
              // 국어, 수학, 영어, 탐구 점수를 포함하여 상위 3개의 평균을 계산
              scores.push({ name: '탐구', value: 탐구점수 });
              scores.sort((a, b) => b.value - a.value);
              let selectedScoresAvg = scores.slice(0, 3);
              let sum = selectedScoresAvg.reduce((acc, score) => acc + score.value, 0);
              let average = sum / 3;
              totalScore = (average / 100) * school.총점만점; // 총점만점 기준으로 환산

              // 로그 추가
              logMessages.push(`선택된 과목 점수: ${selectedScoresAvg.map(s => `${s.name}: ${s.value}`).join(', ')}`);
              logMessages.push(`평균 점수: ${average.toFixed(2)}`);
              logMessages.push(`최종 환산 점수: (${average.toFixed(2)} / 100) * ${school.총점만점} = ${totalScore}`);
              break;

            default:
              // 선택과목규칙이 null인 경우 반영비율 그대로 계산
              scores.forEach(score => {
                let 반영비율;
                if (score.name === '국어') 반영비율 = school.국어반영비율;
                if (score.name === '수학') 반영비율 = school.수학반영비율;
                if (score.name === '영어') 반영비율 = school.영어반영비율;
                totalScore += score.value * 반영비율;
                logMessages.push(`${score.name} 점수: ${score.value} * 비율(${반영비율}) = ${score.value * 반영비율}`);
              });

              // 탐구 과목 비율 계산
              totalScore += 탐구점수 * school.탐구반영비율;
              logMessages.push(`탐구 점수: ${탐구점수} * 비율(${school.탐구반영비율}) = ${탐구점수 * school.탐구반영비율}`);

              // 총점 환산
              totalScore = (totalScore / 100) * school.총점만점;
              logMessages.push(`최종 환산 점수: (총점 / 100) * ${school.총점만점} = ${totalScore}`);
              break;
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
