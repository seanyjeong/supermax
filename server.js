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

// 학생 정보를 입력받아 저장하는 POST 엔드포인트
app.post('/api/students', (req, res) => {
  const { student_name, korean, math, english, science1, science2 } = req.body;

  const query = 'INSERT INTO test (student_name, korean, math, english, science1, science2) VALUES (?, ?, ?, ?, ?, ?)';
  const values = [student_name, korean, math, english, science1, science2];

  connection.query(query, values, (err, result) => {
    if (err) {
      console.error('데이터 입력 오류:', err);
      return res.status(500).send('데이터베이스 쿼리 오류');
    }
    res.send('데이터가 성공적으로 저장되었습니다.');
  });
});

// 저장된 학생 정보를 조회하는 GET 엔드포인트
app.get('/api/students', (req, res) => {
  const query = 'SELECT * FROM test';
  connection.query(query, (err, results) => {
    if (err) {
      console.error('데이터 조회 오류:', err);
      return res.status(500).send('데이터베이스 쿼리 오류');
    }
    res.json(results);
  });
});

// 서버 실행 (포트 4000 사용)
const PORT = 4000;
app.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
