const http = require('http');
const mysql = require('mysql');

// 데이터베이스 연결을 설정합니다.
const connection = mysql.createConnection({
  host: 'my8003.gabiadb.com',
  user: 'maxilsan',
  password: 'q141171616!',
  database: 'supermax',
  charset: 'utf8mb4'
});

// HTTP 서버를 생성합니다.
const server = http.createServer((req, res) => {
  // CORS 헤더를 설정합니다.
  res.setHeader('Access-Control-Allow-Origin', '45.115.154.148');

  // 대학정보기본 테이블과 반영비율 테이블을 조인하는 쿼리를 작성합니다.
  const query = `
  SELECT * FROM 25정시
  `;

  connection.query(query, (err, rows, fields) => {
    if (err) {
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ message: 'Database query failed', error: err }));
      return;
    }

    // 응답 헤더에 'Content-Type'을 'application/json'로 설정합니다.
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(rows));
  });
});

server.listen(3000, '0.0.0.0', () => {
  console.log('Server running at http://0.0.0.0:3000/');
});
