const https = require('https');
const fs = require('fs');
const connection = require('./db'); // db.js 파일을 불러옵니다.

// SSL/TLS 설정을 불러옵니다.
const sslOptions = {
  key: fs.readFileSync('/etc/letsencrypt/live/supermax.kr/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/supermax.kr/fullchain.pem')
};

// HTTPS 서버를 생성합니다.
const server = https.createServer(sslOptions, (req, res) => {
  // CORS 헤더를 설정합니다.
  res.setHeader('Access-Control-Allow-Origin', '*');

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
  console.log('Server running at https://0.0.0.0:3000/');
});
