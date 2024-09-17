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

app.post('/api/calculate', (req, res) => {
  const { name, school, major } = req.body;

  // 학생 정보를 조회하는 쿼리
  const studentQuery = `SELECT * FROM 학생정보 WHERE 이름 = ?`;
  // 선택된 학교와 전공의 규칙을 조회하는 쿼리
  const schoolQuery = `
    SELECT 국어반영비율, 수학반영비율, 영어반영비율, 탐구반영비율, 계산방법, 탐구반영과목수, 한국사반영방법, 선택과목규칙
    FROM 학교
    WHERE 학교명 = ? AND 전공 = ?
  `;

  // 학생 정보 조회
  connection.query(studentQuery, [name], (err, studentResults) => {
    if (err) {
      console.error('학생 정보 조회 오류:', err);
      return res.status(500).json({ message: '학생 정보 조회 오류' });
    }

    if (studentResults.length === 0) {
      console.log('해당 학생을 찾을 수 없습니다.');
      return res.status(404).json({ message: '학생 정보를 찾을 수 없습니다.' });
    }

    const student = studentResults[0];

    // 선택된 학교의 규칙 조회
    connection.query(schoolQuery, [school, major], (err, schoolResults) => {
      if (err) {
        console.error('학교 정보 조회 오류:', err);
        return res.status(500).json({ message: '학교 정보 조회 오류' });
      }

      if (schoolResults.length === 0) {
        console.log('해당 학교/전공 정보를 찾을 수 없습니다.');
        return res.status(404).json({ message: '학교 정보를 찾을 수 없습니다.' });
      }

      const schoolInfo = schoolResults[0];
      let totalScore = 0;

      // 규칙에 따른 점수 계산 시작
      if (schoolInfo.계산방법 === '백/백') {
        if (schoolInfo.선택과목규칙 === '국수영탐택3') {
          // 상위 3개 과목을 같은 비율로 계산
          const top3SubjectsScore = calculateTop3SubjectsWithPercentile(student, schoolInfo.국어반영비율, schoolInfo.수학반영비율, schoolInfo.영어반영비율);
          totalScore = top3SubjectsScore;
        } else if (schoolInfo.선택과목규칙 === '국수영택2') {
          // 국어, 수학, 영어 중 상위 2개 과목을 선택하고, 탐구는 비율로 계산
          const top2SubjectsScore = calculateTop2SubjectsWithPercentile(student, schoolInfo.국어반영비율, schoolInfo.수학반영비율, schoolInfo.영어반영비율);
          totalScore = top2SubjectsScore;
        }
        // 탐구 과목 계산
        const scienceScore = calculateScienceScore(student.탐구1백분위, student.탐구2백분위, schoolInfo.탐구반영과목수, schoolInfo.탐구반영비율);
        totalScore += scienceScore;
      }

      // 한국사 반영 방법 확인
      if (schoolInfo.한국사반영방법 === '총점합산') {
        getKoreanHistoryScore(student.한국사등급).then((koreanHistoryScore) => {
          totalScore += koreanHistoryScore;
          res.json({ name: student.이름, totalScore });
        }).catch((historyError) => {
          console.error('한국사 점수 조회 오류:', historyError);
          res.status(500).json({ message: '한국사 점수 조회 오류' });
        });
      } else {
        res.json({ name: student.이름, totalScore });
      }
    });
  });
});

// 국수영탐 상위 3개 과목을 백분위로 계산
function calculateTop3SubjectsWithPercentile(student, koreanRatio, mathRatio, englishRatio) {
  const subjects = [
    student.국어백분위 * (koreanRatio / 100),
    student.수학백분위 * (mathRatio / 100),
    student.영어백분위 * (englishRatio / 100),
    student.탐구1백분위,
    student.탐구2백분위
  ];
  subjects.sort((a, b) => b - a);  // 내림차순으로 정렬하여 상위 3개 선택
  const top3 = subjects.slice(0, 3);
  return top3.reduce((acc, score) => acc + score, 0);
}

// 국수영 중 상위 2개 과목을 백분위로 계산
function calculateTop2SubjectsWithPercentile(student, koreanRatio, mathRatio, englishRatio) {
  const subjects = [
    student.국어백분위 * (koreanRatio / 100),
    student.수학백분위 * (mathRatio / 100),
    student.영어백분위 * (englishRatio / 100)
  ];
  subjects.sort((a, b) => b - a);  // 내림차순으로 정렬하여 상위 2개 선택
  const top2 = subjects.slice(0, 2);
  return top2.reduce((acc, score) => acc + score, 0);
}

// 탐구 과목 계산
function calculateScienceScore(science1, science2, subjectCount, scienceRatio) {
  if (subjectCount === 2) {
    return ((science1 + science2) / 2) * (scienceRatio / 100);
  } else if (subjectCount === 1) {
    return Math.max(science1, science2) * (scienceRatio / 100);
  }
  return 0;
}






// 서버 실행 (포트 4000 사용)
const PORT = 4000;
app.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
