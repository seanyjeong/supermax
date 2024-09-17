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

// CORS 설정: 특정 도메인만 허용
app.use(cors({
  origin: ['https://supermax.co.kr', 'https://seanyjeong.github.io', 'https://chejump.com', 'https://score.ilsanmax.com']
}));

// JSON 형식의 데이터를 처리할 수 있게 설정
app.use(express.json());

// 정적 파일 제공 (public 폴더 내의 파일을 제공)
app.use(express.static('public'));

// 학생 정보를 조회하고 점수를 계산하는 엔드포인트
app.post('/api/calculate', (req, res) => {
  const { name } = req.body;

  // 학생 이름으로 해당 학생의 점수를 조회하는 쿼리
  const query = 'SELECT * FROM 학생정보 WHERE 이름 = ?';
  connection.query(query, [name], (err, results) => {
    if (err) {
      console.error('데이터 조회 오류:', err);
      return res.status(500).send('데이터베이스 조회 오류');
    }

    if (results.length === 0) {
      return res.status(404).send('학생을 찾을 수 없습니다.');
    }

    // 학생 정보 가져오기
    const student = results[0];

    // 상위 3개 과목 점수 계산
    const top3SubjectsScore = calculateTop3Subjects(student);

    // 탐구 과목 계산
    const scienceScore = calculateScienceScore(student.탐구1표준점수, student.탐구2표준점수, student.탐구반영과목수);

    // 총점 계산
    let totalScore = top3SubjectsScore + scienceScore;

    // 한국사 점수 추가 (총점합산 방식)
    if (student.한국사반영방법 === '총점합산') {
      totalScore += getKoreanHistoryScore(student.한국사등급);
    }

    res.json({ name: student.이름, totalScore });
  });
});

// 상위 3개 과목 계산 로직
function calculateTop3Subjects(student) {
  const subjects = [student.국어표준점수, student.수학표준점수, student.영어표준점수, student.탐구1표준점수, student.탐구2표준점수];
  subjects.sort((a, b) => b - a);  // 내림차순 정렬
  const top3 = subjects.slice(0, 3);  // 상위 3개 선택
  return top3.reduce((acc, score) => acc + score, 0);
}

// 탐구 과목 점수 계산 로직
function calculateScienceScore(science1, science2, count) {
  if (count === 2) {
    return (science1 + science2) / 2;  // 두 과목 평균
  } else if (count === 1) {
    return Math.max(science1, science2);  // 높은 값 선택
  }
  return 0;  // 탐구 과목 반영 안할 경우
}

// 한국사 점수 계산
function getKoreanHistoryScore(grade) {
  const koreanHistoryScores = {
    1: 2.0,
    2: 1.5,
    3: 1.0,
    4: 0.5,
    5: 0.0,
    6: 0.0,
    7: 0.0,
    8: 0.0,
    9: 0.0
  };
  return koreanHistoryScores[grade];
}

// 서버 실행 (포트 4000 사용)
const PORT = 4000;
app.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
