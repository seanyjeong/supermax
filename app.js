const https = require('https');
const fs = require('fs');
const mysql = require('mysql');

// SSL/TLS 설정을 불러옵니다.
const sslOptions = {
  key: fs.readFileSync('/etc/letsencrypt/live/supermax.kr/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/supermax.kr/fullchain.pem')
};

// 데이터베이스 연결을 설정합니다.
var db_config = {
  host: '211.37.174.218',
  user: 'maxilsan',
  password: 'q141171616!', // 비밀번호는 보안을 위해 숨겨주세요.
  database: 'supermax',
  charset: 'utf8mb4'
};

var connection;

function handleDisconnect() {
  connection = mysql.createConnection(db_config);

  connection.connect(function(err) {              
    if(err) {                                    
      console.log('error when connecting to db:', err);
      setTimeout(handleDisconnect, 2000); 
    }                                     
  });                                     

  connection.on('error', function(err) {
    console.log('db error', err);
    if(err.code === 'PROTOCOL_CONNECTION_LOST') { 
      handleDisconnect();                        
    } else {                                      
      throw err;                                  
    }
  });
}

handleDisconnect();

// HTTPS 서버를 생성합니다.
const server = https.createServer(sslOptions, (req, res) => {
  // CORS 헤더를 설정합니다.
  res.setHeader('Access-Control-Allow-Origin', '*');

  // 요청 URL에 따라 분기 처리합니다.
  if (req.url === '/25jeongsi') {
    // '25정시' 테이블 데이터를 가져오는 쿼리를 실행합니다.
    const query = 'SELECT * FROM 25정시';
    connection.query(query, (err, rows, fields) => {
      if (err) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ message: 'Database query failed', error: err }));
        return;
      }
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify(rows));
    });
  } else if (req.url === '/25susi') {
    // '25수시' 테이블 데이터를 가져오는 쿼리를 실행합니다.
    const query = 'SELECT * FROM 25수시';
    connection.query(query, (err, rows, fields) => {
      if (err) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ message: 'Database query failed', error: err }));
        return;
      }
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify(rows));
    });
  } else {
    // 다른 엔드포인트에 대한 처리...
    res.writeHead(404, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({ message: 'Endpoint not found' }));
  }
});

server.listen(3000, '0.0.0.0', () => {
  console.log('Server running at https://0.0.0.0:3000/');
});
