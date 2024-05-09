const http = require('http');
const mysql = require('mysql');

// 데이터베이스 연결을 설정합니다.
const connection = mysql.createConnection({
  host: 'my8003.gabiadb.com',
  user: 'maxilsan',
  password: 'q141171616!',
  database: 'supermax',
  port: 3306
});

// HTTP 서버를 생성합니다.
const server = http.createServer((req, res) => {
  // CORS 헤더를 설정합니다.
  res.setHeader('Access-Control-Allow-Origin', '*');
    // Content-Type 헤더를 설정합니다.
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  // 데이터베이스에 쿼리를 실행합니다.
  connection.query('SELECT * FROM 25정시', (error, results) => {
    if (error) {
      console.error('An error occurred while executing the query: ' + error.stack);
      res.end();
      return;
    }

    // 결과를 응답으로 보냅니다.
    res.end(JSON.stringify(results));
  });
});

server.listen(3000, '127.0.0.1', () => {
  console.log('Server running at http://127.0.0.1:3000/');
});
