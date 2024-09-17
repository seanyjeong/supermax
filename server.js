// server.js

const express = require('express');
const mysql = require('mysql');

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

// 간단한 라우터 설정 (예: 데이터베이스에서 데이터를 가져오는 예시)
app.get('/', (req, res) => {
  connection.query('SELECT * FROM some_table LIMIT 10', (err, results) => {
    if (err) {
      return res.status(500).send('데이터베이스 쿼리 오류');
    }
    res.json(results);
  });
});

// 3000번 포트가 사용 중이므로 다른 포트로 설정 (예: 4000)
const PORT = 4000;

app.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
