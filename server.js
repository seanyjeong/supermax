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
// 규칙별 계산 함수 정의
const calculationStrategies = {
  '국수영탐택3': calculateRule1,
  '국수영탐택2': calculateRule2,
  '국수영탐532': calculateRule3,
  '상위3개평균': calculateRule4,
  '국수영택2': calculateRule5,
  '강원대': calculateKangwon,
  '국수택1': calculateRule6,  // 새로운 규칙 추가
  '관동대': calculateKwandong,  // 새로운 규칙 추가
};
// 규칙 8: 관동대 - 국어, 수학, 탐구 중 상위 2개 + 영어 점수는 비율 없이 그대로 합산
function calculateKwandong(school, scores, 탐구점수, logMessages) {
  let totalScore = 0;

  // 국어, 수학, 탐구 점수들 중 상위 2개 선택
  const 국어점수 = scores.find(score => score.name === '국어');
  const 수학점수 = scores.find(score => score.name === '수학');
  const 탐구점수Obj = { name: '탐구', value: 탐구점수 }; // 탐구는 따로 전달된 값으로 추가

  // 국어, 수학, 탐구의 점수를 배열에 넣고, 높은 점수순으로 정렬
  const 국수탐점수들 = [국어점수, 수학점수, 탐구점수Obj].filter(Boolean); // 유효한 점수만 필터링
  국수탐점수들.sort((a, b) => b.value - a.value); // 높은 점수순으로 정렬

  // 상위 2개 선택
  const selectedScores = 국수탐점수들.slice(0, 2);

  // 선택된 과목들에 대해 반영 비율 적용
  selectedScores.forEach(score => {
    let 반영비율;
    switch (score.name) {
      case '국어':
        반영비율 = school.국어반영비율;
        break;
      case '수학':
        반영비율 = school.수학반영비율;
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

  // 중간 총점 계산 (국어, 수학, 탐구 기준으로)
  totalScore = (totalScore / 100) * school.총점만점;
  logMessages.push(`중간 총점 (국어, 수학, 탐구): (총점 / 100) * ${school.총점만점} = ${totalScore.toFixed(2)}`);

  // 영어 점수는 마지막에 비율 없이 그대로 더함
  const 영어점수 = scores.find(score => score.name === '영어');
  if (영어점수) {
    totalScore += 영어점수.value; // 비율 없이 그대로 합산
    logMessages.push(`영어 점수: ${영어점수.value} (비율 없이 그대로 합산)`);
  } else {
    return logMessages.push('영어 점수가 누락되었습니다.');
  }

  // 최종 총점 반환
  totalScore = parseFloat(totalScore.toFixed(2)); // 소수점 2자리로 고정
  logMessages.push(`최종 환산 점수: ${totalScore}`);

  return totalScore;
}


// 규칙 6: 국수택1 - 국어, 수학 중 상위 1개 + 다른 한 과목
// 규칙 6: 국수택1 - 국어, 수학 중 상위 1개 + 영어 + 탐구 (탐구과목수가 0이면 탐구 제외)
function calculateRule6(school, scores, 탐구점수, logMessages) {
  let totalScore = 0;

  // 국어와 수학 중 상위 점수 선택
  const 국어점수 = scores.find(score => score.name === '국어');
  const 수학점수 = scores.find(score => score.name === '수학');
  
  if (!국어점수 || !수학점수) {
    return logMessages.push('국어 또는 수학 점수가 누락되었습니다.');
  }
  
  const 선택과목 = 국어점수.value > 수학점수.value ? 국어점수 : 수학점수;
  
  // 선택된 과목의 반영 비율 적용
  const 선택과목비율 = 선택과목.name === '국어' ? school.국어반영비율 : school.수학반영비율;
  totalScore += 선택과목.value * 선택과목비율;
  logMessages.push(`${선택과목.name} 점수: ${선택과목.value} * 비율(${선택과목비율}) = ${(선택과목.value * 선택과목비율).toFixed(2)}`);

  // 영어 점수 반영
  const 영어점수 = scores.find(score => score.name === '영어');
  if (영어점수) {
    const 영어비율 = school.영어반영비율;
    totalScore += 영어점수.value * 영어비율;
    logMessages.push(`영어 점수: ${영어점수.value} * 비율(${영어비율}) = ${(영어점수.value * 영어비율).toFixed(2)}`);
  } else {
    return logMessages.push('영어 점수가 누락되었습니다.');
  }

  // 탐구 과목 반영 여부 확인 (탐구반영과목수가 0이면 탐구 점수를 반영하지 않음)
  if (school.탐구반영과목수 > 0) {
    const 탐구비율 = school.탐구반영비율;
    totalScore += 탐구점수 * 탐구비율;
    logMessages.push(`탐구 점수: ${탐구점수} * 비율(${탐구비율}) = ${(탐구점수 * 탐구비율).toFixed(2)}`);
  } else {
    logMessages.push('탐구 과목은 반영되지 않았습니다.');
  }

  // 총점 환산
  totalScore = (totalScore / 100) * school.총점만점;
  logMessages.push(`최종 환산 점수: (총점 / 100) * ${school.총점만점} = ${totalScore.toFixed(2)}`);

  return totalScore;
}


// 규칙: 강원대 - 국어 필수 + 수학/영어 중 하나 선택, 탐구는 반영하지 않음
function calculateKangwon(school, scores, 탐구점수, logMessages) {
  let totalScore = 0;

  // 국어는 필수로 반영
  const 국어점수 = scores.find(score => score.name === '국어');
  if (국어점수) {
    const 국어비율 = school.국어반영비율;
    totalScore += 국어점수.value * 국어비율;
    logMessages.push(`국어 점수: ${국어점수.value} * 비율(${국어비율}) = ${(국어점수.value * 국어비율).toFixed(2)}`);
  } else {
    return logMessages.push('국어 점수가 누락되었습니다.');
  }

  // 수학과 영어 중 상위 점수 선택
  const 수학점수 = scores.find(score => score.name === '수학');
  const 영어점수 = scores.find(score => score.name === '영어');

  let 선택과목;
  if (수학점수 && 영어점수) {
    선택과목 = 수학점수.value > 영어점수.value ? 수학점수 : 영어점수;
  } else if (수학점수) {
    선택과목 = 수학점수;
  } else if (영어점수) {
    선택과목 = 영어점수;
  } else {
    return logMessages.push('수학 또는 영어 점수가 누락되었습니다.');
  }

  const 선택과목비율 = 선택과목.name === '수학' ? school.수학반영비율 : school.영어반영비율;
  totalScore += 선택과목.value * 선택과목비율;
  logMessages.push(`${선택과목.name} 점수: ${선택과목.value} * 비율(${선택과목비율}) = ${(선택과목.value * 선택과목비율).toFixed(2)}`);

  // 탐구 과목 처리 (탐구반영과목수가 0이 아닐 경우 탐구를 반영)
  if (school.탐구반영과목수 > 0) {
    const 탐구비율 = school.탐구반영비율;
    totalScore += 탐구점수 * 탐구비율;
    logMessages.push(`탐구 점수: ${탐구점수} * 비율(${탐구비율}) = ${(탐구점수 * 탐구비율).toFixed(2)}`);
  } else {
    logMessages.push('탐구 과목은 반영되지 않았습니다.');
  }

  // 총점 환산
  totalScore = totalScore;  // 필요시 환산 추가

  return totalScore;
}


// 기본 계산: 선택과목 규칙이 없을 때 적용
function calculateByRatio(school, scores, 탐구점수, logMessages) {
  // 탐구반영과목수가 0일 경우 탐구 제외
  if (school.탐구반영과목수 > 0) {
    scores.push({ name: '탐구', value: 탐구점수 });
  }

  let totalScore = 0;

  // 각 과목에 대해 비율대로 점수 계산
  scores.forEach(score => {
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
    
    // 반영비율에 따라 점수 계산
    const 계산된점수 = score.value * 반영비율;
    totalScore += 계산된점수;
    logMessages.push(`${score.name} 점수: ${score.value} * 비율(${반영비율}) = ${계산된점수.toFixed(2)}`);
  });

  // 최종 총점 환산 (예: 100점 기준 총점 만점)
  totalScore = (totalScore / 100) * school.총점만점;
  logMessages.push(`최종 환산 점수: (총점 / 100) * ${school.총점만점} = ${totalScore.toFixed(2)}`);

  return totalScore;
}

// 규칙 5: 국수영택2 - 국어, 수학, 영어 중 상위 2개 + 탐구는 필수 반영
function calculateRule5(school, scores, 탐구점수, logMessages) {
  // 탐구 점수는 필수 반영
  scores.push({ name: '탐구', value: 탐구점수 });
  
  // 국어, 수학, 영어 중 상위 2개 과목 선택
  const coreScores = scores.filter(score => ['국어', '수학', '영어'].includes(score.name));
  coreScores.sort((a, b) => b.value - a.value);
  const selectedCoreScores = coreScores.slice(0, 2);

  let totalScore = 0;

  // 선택된 국, 수, 영 2개 점수에 각 과목의 반영 비율 적용
  selectedCoreScores.forEach(score => {
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
      default:
        반영비율 = 0;
    }
    totalScore += score.value * 반영비율;
    logMessages.push(`${score.name} 점수: ${score.value} * 비율(${반영비율}) = ${(score.value * 반영비율).toFixed(2)}`);
  });

  // 탐구 점수도 비율 적용
  const 탐구비율 = school.탐구반영비율;
  totalScore += 탐구점수 * 탐구비율;
  logMessages.push(`탐구 점수: ${탐구점수} * 비율(${탐구비율}) = ${(탐구점수 * 탐구비율).toFixed(2)}`);

  // 총점 환산
  totalScore = (totalScore / 100) * school.총점만점;
  logMessages.push(`최종 환산 점수: (총점 / 100) * ${school.총점만점} = ${totalScore.toFixed(2)}`);

  return totalScore;
}

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
          } else if (school.탐구반영과목수 === 0) {
            탐구점수 = 0; // 탐구를 반영하지 않음
          }


          // 선택과목규칙에 따른 처리
          const calculateStrategy = calculationStrategies[school.선택과목규칙] || calculateByRatio;

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
// 모든 학교에 대한 환산 점수를 계산하는 API 추가
app.post('/api/calculate-all-scores', (req, res) => {
  const { studentName } = req.body;

  if (!studentName) {
    return res.status(400).json({ error: '학생 이름이 필요합니다.' });
  }

  // 1. 학생 정보 가져오기
  connection.query('SELECT * FROM 학생정보 WHERE 이름 = ?', [studentName], (err, studentResults) => {
    if (err) {
      console.error('학생 정보 조회 오류:', err);
      return res.status(500).json({ error: '학생 정보를 불러오는 중 오류가 발생했습니다.' });
    }
    if (!studentResults.length) {
      return res.status(404).json({ error: '해당 학생을 찾을 수 없습니다.' });
    }
    const student = studentResults[0];  // 학생 정보

    // 2. 모든 학교 정보 가져오기
    connection.query('SELECT * FROM 학교', (err, schoolResults) => {
      if (err) {
        console.error('학교 정보 조회 오류:', err);
        return res.status(500).json({ error: '학교 정보를 불러오는 중 오류가 발생했습니다.' });
      }

      let totalScores = [];  // 각 학교별 점수 저장

      // 3. 각 학교에 대해 점수를 계산
      schoolResults.forEach(school => {
        let scores = [];
        let logMessages = []; // 로그 초기화

        // 4. 이미 불러온 학생 데이터를 사용하여 점수를 계산
        if (school.계산방법 === '백/백') {
          scores.push({ name: '국어', value: student.국어백분위 });
          scores.push({ name: '수학', value: student.수학백분위 });
        } else if (school.계산방법 === '백/표') {
          scores.push({ name: '국어', value: student.국어표준점수 });
          scores.push({ name: '수학', value: student.수학표준점수 });
        }

        // 영어 점수 처리 (이미 가져온 데이터 사용)
        connection.query('SELECT * FROM 영어 WHERE 학교명 = ? AND 전공 = ?', [school.학교명, school.전공], (err, englishResults) => {
          if (err || !englishResults.length) {
            logMessages.push('영어 점수를 불러오는 중 오류가 발생했습니다.');
            return;
          }

          const englishGradeScore = englishResults[0][`등급${student.영어등급}`];
          scores.push({ name: '영어', value: englishGradeScore });

          // 5. 탐구 점수 처리
          let 탐구점수 = 0;
          if (school.탐구반영과목수 === 1) {
            탐구점수 = Math.max(student.탐구1백분위, student.탐구2백분위);
          } else if (school.탐구반영과목수 === 2) {
            탐구점수 = (student.탐구1백분위 + student.탐구2백분위) / 2;
          }

          // 6. 규칙에 따라 점수 계산
          const calculateStrategy = calculationStrategies[school.선택과목규칙] || calculateByRatio;
          let totalScore = calculateStrategy(school, scores, 탐구점수, logMessages);

          // 7. 한국사 점수 처리
          connection.query('SELECT * FROM 한국사 WHERE 학교명 = ? AND 전공 = ?', [school.학교명, school.전공], (err, koreanHistoryResults) => {
            if (!err && koreanHistoryResults.length) {
              const koreanHistoryGradeScore = koreanHistoryResults[0][`등급${student.한국사등급}`];
              if (school.한국사반영방법 === '총점합산') {
                totalScore += koreanHistoryGradeScore;
                logMessages.push(`한국사 점수: ${koreanHistoryGradeScore}`);
              }
            }

            // 8. 최종 점수 저장
            totalScores.push({
              학교명: school.학교명,
              전공: school.전공,
              totalScore: totalScore.toFixed(2),
              logs: logMessages
            });

            // 9. 결과 반환
            if (totalScores.length === schoolResults.length) {
              res.json(totalScores);  // 모든 학교에 대한 점수 계산이 완료되면 반환
            }
          });
        });
      });
    });
  });
});
// 학생 개별 정보 API (학생 성적표 정보 불러오기)
app.post('/api/student-info', (req, res) => {
  const { name } = req.body;  // 요청 본문에서 이름을 받음

  connection.query('SELECT * FROM 학생정보 WHERE 이름 = ?', [name], (err, results) => {
    if (err) {
      console.error('학생 정보 조회 오류:', err);
      return res.status(500).json({ error: '학생 정보를 불러오는 중 오류가 발생했습니다.' });
    }

    if (!results.length) {
      return res.status(404).json({ error: '해당 학생을 찾을 수 없습니다.' });
    }

    const student = results[0];
    res.json(student);
  });
});

// 모든 학생에 대한 모든 학교의 점수를 계산하는 API
// 모든 학생에 대한 모든 학교의 점수를 계산하는 API
app.get('/api/calculate-scores-for-all-students', (req, res) => {
  // 1. 모든 학생 정보 가져오기
  connection.query('SELECT * FROM 학생정보', (err, studentResults) => {
    if (err) {
      console.error('학생 정보 조회 오류:', err);
      return res.status(500).json({ error: '학생 정보를 불러오는 중 오류가 발생했습니다.' });
    }

    if (!studentResults.length) {
      return res.status(404).json({ error: '학생 정보가 없습니다.' });
    }

    // 2. 모든 학교 정보 가져오기
    connection.query('SELECT * FROM 학교', (err, schoolResults) => {
      if (err) {
        console.error('학교 정보 조회 오류:', err);
        return res.status(500).json({ error: '학교 정보를 불러오는 중 오류가 발생했습니다.' });
      }

      if (!schoolResults.length) {
        return res.status(404).json({ error: '학교 정보가 없습니다.' });
      }

      let allScores = [];  // 전체 결과 저장

      // 3. 학생 별로 점수를 계산하는 비동기 작업을 Promise로 처리
      const studentPromises = studentResults.map(student => {
        return new Promise((resolve, reject) => {
          let studentScores = { studentName: student.이름, scores: [] };

          // 4. 학교 별로 점수를 계산하는 Promise 배열
          const schoolPromises = schoolResults.map(school => {
            return new Promise((resolve, reject) => {
              let scores = [];
              let logMessages = [];

              // 5. 학생 성적 정보로 점수 계산 (백/백 또는 백/표)
              if (school.계산방법 === '백/백') {
                scores.push({ name: '국어', value: student.국어백분위 });
                scores.push({ name: '수학', value: student.수학백분위 });
              } else if (school.계산방법 === '백/표') {
                scores.push({ name: '국어', value: student.국어표준점수 });
                scores.push({ name: '수학', value: student.수학표준점수 });
              }

              // 6. 영어 점수 가져오기
              connection.query('SELECT * FROM 영어 WHERE 학교명 = ? AND 전공 = ?', [school.학교명, school.전공], (err, englishResults) => {
                if (err || !englishResults.length) {
                  logMessages.push('영어 점수를 불러오는 중 오류가 발생했습니다.');
                  return resolve({
                    학교명: school.학교명,
                    전공: school.전공,
                    totalScore: 0,
                    logs: logMessages
                  });
                }

                const englishGradeScore = englishResults[0][`등급${student.영어등급}`];
                scores.push({ name: '영어', value: englishGradeScore });

                // 7. 탐구 점수 처리
                let 탐구점수 = 0;
                if (school.탐구반영과목수 === 1) {
                  탐구점수 = Math.max(student.탐구1백분위, student.탐구2백분위);
                } else if (school.탐구반영과목수 === 2) {
                  탐구점수 = (student.탐구1백분위 + student.탐구2백분위) / 2;
                }

                // 8. 한국사 점수 가져오기
                connection.query('SELECT * FROM 한국사 WHERE 학교명 = ? AND 전공 = ?', [school.학교명, school.전공], (err, koreanHistoryResults) => {
                  if (err || !koreanHistoryResults.length) {
                    logMessages.push('한국사 점수를 불러오는 중 오류가 발생했습니다.');
                    return resolve({
                      학교명: school.학교명,
                      전공: school.전공,
                      totalScore: 0,
                      logs: logMessages
                    });
                  }

                  const koreanHistoryGradeScore = koreanHistoryResults[0][`등급${student.한국사등급}`];
                  scores.push({ name: '한국사', value: koreanHistoryGradeScore });

                  // 9. 선택과목규칙에 따른 점수 계산
                  const calculateStrategy = calculationStrategies[school.선택과목규칙] || calculateByRatio;
                  let totalScore = calculateStrategy(school, scores, 탐구점수, logMessages);

                  // 10. 총점합산 방식일 경우 한국사 점수 추가
                  if (school.한국사반영방법 === '총점합산') {
                    totalScore += koreanHistoryGradeScore;
                    logMessages.push(`한국사 점수: ${koreanHistoryGradeScore} (총점 합산)`);
                  }

                  // 11. 각 학교별로 점수를 저장
                  resolve({
                    학교명: school.학교명,
                    전공: school.전공,
                    totalScore: totalScore.toFixed(2),
                    logs: logMessages
                  });
                });
              });
            });
          });

          // 12. 학교 별 점수 계산이 완료되면 결과 저장
          Promise.all(schoolPromises)
            .then(schoolScores => {
              studentScores.scores = schoolScores;
              resolve(studentScores);  // 학생의 모든 점수 계산 완료
            })
            .catch(error => reject(error));
        });
      });

      // 13. 모든 학생에 대한 점수 계산이 완료되면 결과 반환
      Promise.all(studentPromises)
        .then(results => {
          res.json(results);  // 모든 학생에 대한 점수 계산이 완료되면 반환
        })
        .catch(error => {
          console.error('점수 계산 중 오류:', error);
          res.status(500).json({ error: '점수 계산 중 오류가 발생했습니다.' });
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
