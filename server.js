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

  // 학생 정보와 학교 정보를 함께 조회
  const query = `
    SELECT 학생정보.*, 학교.국어반영비율, 학교.수학반영비율, 학교.영어반영비율, 학교.탐구반영비율, 학교.계산방법, 학교.탐구반영과목수, 학교.한국사반영방법, 학교.선택과목규칙
    FROM 학생정보
    JOIN 학교 ON 학생정보.학교 = 학교.학교명 AND 학교.전공 = ?
    WHERE 학생정보.이름 = ? AND 학생정보.학교 = ?
  `;
    console.log('쿼리 실행: ', query); // 쿼리 로그 추가
  console.log('쿼리 파라미터: ', [major, name, school]); // 쿼리 파라미터 로그 추가

  connection.query(query, [major, name, school], async (err, results) => {
    if (err) {
      console.error('데이터 조회 오류:', err);
      return res.status(500).json({ message: '데이터베이스 조회 오류' });
    }

    if (results.length === 0) {
      console.log('해당 학생 또는 학교 정보를 찾을 수 없습니다.');
      return res.status(404).json({ message: '학생 정보를 찾을 수 없습니다.' });
    }

    const student = results[0];
    let totalScore = 0;

    // 1. 계산 방법에 따른 처리 (백/백)
    try {
      if (student.계산방법 === '백/백') {
        if (student.선택과목규칙 === '국수영탐택3') {
          // 국수영탐 상위 3개 과목을 백분위로 계산
          const top3SubjectsScore = calculateTop3SubjectsWithPercentile(student, student.국어반영비율, student.수학반영비율, student.영어반영비율);
          totalScore = top3SubjectsScore;
        } else if (student.선택과목규칙 === '국수영택2') {
          // 국수영 중 상위 2개 과목을 백분위로 계산
          const top2SubjectsScore = calculateTop2SubjectsWithPercentile(student, student.국어반영비율, student.수학반영비율, student.영어반영비율);
          totalScore = top2SubjectsScore;
        }
        // 탐구 점수 추가
        const scienceScore = calculateScienceScore(student.탐구1백분위, student.탐구2백분위, student.탐구반영과목수, student.탐구반영비율);
        totalScore += scienceScore;
      }

      // 2. 한국사 반영 방법 확인
      if (student.한국사반영방법 === '총점합산') {
        try {
          const koreanHistoryScore = await getKoreanHistoryScore(student.한국사등급);
          totalScore += koreanHistoryScore;
        } catch (historyError) {
          console.error('한국사 점수 조회 오류:', historyError);
          return res.status(500).json({ message: '한국사 점수 조회 오류' });
        }
      }

      console.log('최종 계산된 점수:', totalScore);
      res.json({ name: student.이름, totalScore });
    } catch (error) {
      console.error('점수 계산 중 오류 발생:', error);
      res.status(500).json({ message: '점수 계산 중 오류가 발생했습니다.' });
    }
  });
});





// 서버 실행 (포트 4000 사용)
const PORT = 4000;
app.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
