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

// 규칙별 계산 함수 정의
const calculationStrategies = {
  '국수영탐택3': calculateRule1,
  '국수영탐택2': calculateRule2,
  '국수영탐532': calculateRule3,
  '상위3개평균': calculateRule4
};

// 규칙 1: 국수영탐택3
function calculateRule1(school, scores, 탐구점수, logMessages) {
  scores.push({ name: '탐구', value: 탐구점수 });
  scores.sort((a, b) => b.value - a.value);
  const selectedScores = scores.slice(0, 3);
  let totalScore = 0;

  selectedScores.forEach(score => {
    totalScore += score.value;
    logMessages.push(`${score.name} 점수: ${score.value}`);
  });

  // 총점 환산 (300점 만점 기준)
  totalScore = (totalScore / 300) * school.총점만점;
  logMessages.push(`최종 환산 점수: (총점 / 300) * ${school.총점만점} = ${totalScore.toFixed(2)}`);

  return totalScore;
}

// 규칙 2: 국수영탐택2
function calculateRule2(school, scores, 탐구점수, logMessages) {
  // 국, 수, 영, 탐의 4과목 중 상위 2개 선택
  scores.push({ name: '탐구', value: 탐구점수 });
  scores.sort((a, b) => b.value - a.value);
  const selectedScores = scores.slice(0, 2);
  let totalScore = 0;

  selectedScores.forEach(score => {
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
      default:
        반영비율 = 0;
    }
    totalScore += score.value * 반영비율;
    logMessages.push(`${score.name} 점수: ${score.value} * 비율(${반영비율}) = ${(score.value * 반영비율).toFixed(2)}`);
  });

  // 총점 환산
  totalScore = (totalScore / 100) * school.총점만점;
  logMessages.push(`최종 환산 점수: (총점 / 100) * ${school.총점만점} = ${totalScore.toFixed(2)}`);

  return totalScore;
}

// 규칙 3: 국수영탐532
function calculateRule3(school, scores, 탐구점수, logMessages) {
  scores.push({ name: '탐구', value: 탐구점수 });
  scores.sort((a, b) => b.value - a.value);
  const selectedScores = scores.slice(0, 3);
  let totalScore = 0;

  // 50%, 30%, 20% 비율 적용
  if (selectedScores.length >= 3) {
    totalScore += selectedScores[0].value * 0.5;
    logMessages.push(`${selectedScores[0].name} 점수: ${selectedScores[0].value} * 0.5 = ${(selectedScores[0].value * 0.5).toFixed(2)}`);
    totalScore += selectedScores[1].value * 0.3;
    logMessages.push(`${selectedScores[1].name} 점수: ${selectedScores[1].value} * 0.3 = ${(selectedScores[1].value * 0.3).toFixed(2)}`);
    totalScore += selectedScores[2].value * 0.2;
    logMessages.push(`${selectedScores[2].name} 점수: ${selectedScores[2].value} * 0.2 = ${(selectedScores[2].value * 0.2).toFixed(2)}`);
  }

  // 총점 환산
  totalScore = (totalScore / 100) * school.총점만점;
  logMessages.push(`최종 환산 점수: (총점 / 100) * ${school.총점만점} = ${totalScore.toFixed(2)}`);

  return totalScore;
}

// 규칙 4: 상위3개평균
function calculateRule4(school, scores, 탐구점수, logMessages) {
  scores.push({ name: '탐구', value: 탐구점수 });
  scores.sort((a, b) => b.value - a.value);
  const selectedScores = scores.slice(0, 3);
  const sum = selectedScores.reduce((acc, score) => acc + score.value, 0);
  const average = sum / 3;
  const totalScore = (average / 100) * school.총점만점;

  // 로그 추가
  logMessages.push(`선택된 과목 점수: ${selectedScores.map(s => `${s.name}: ${s.value}`).join(', ')}`);
  logMessages.push(`평균 점수: ${average.toFixed(2)}`);
  logMessages.push(`최종 환산 점수: (${average.toFixed(2)} / 100) * ${school.총점만점} = ${totalScore.toFixed(2)}`);

  return totalScore;
}

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

          let logMessages = []; // 로그 저장 배열

          // 국어, 수학, 영어 점수들을 배열에 저장
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
          const calculateStrategy = calculationStrategies[school.선택과목규칙];

          if (!calculateStrategy) {
            return res.status(400).json({ error: '지원되지 않는 선택과목규칙입니다.' });
          }

          let totalScore;
          try {
            totalScore = calculateStrategy(school, scores, 탐구점수, logMessages);
          } catch (error) {
            console.error('계산 오류:', error);
            return res.status(500).json({ error: '점수 계산 중 오류가 발생했습니다.' });
          }

          // 한국사 점수 처리 (총점합산일 경우 마지막에 더함)
          const koreanHistoryGradeScore = koreanHistoryResults[0][`등급${student.한국사등급}`];
          if (school.한국사반영방법 === '총점합산') {
            totalScore += koreanHistoryGradeScore;
            logMessages.push(`한국사 점수: ${koreanHistoryGradeScore}`);
          }

          // 총점 소수점 2자리로 고정
          totalScore = parseFloat(totalScore.toFixed(2));

          // 최종 점수 계산 (총점 + 한국사 점수)
          const finalScore = koreanHistoryResults[0].한국사반영방법 === '총점합산'
            ? parseFloat((totalScore + koreanHistoryGradeScore).toFixed(2))
            : parseFloat(totalScore.toFixed(2));

          // 결과 반환 (점수와 로그 함께)
          res.json({ totalScore: finalScore, logs: logMessages });
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
