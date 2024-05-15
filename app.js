const https = require('https');
const fs = require('fs');
const mysql = require('mysql');
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const cors = require('cors');

// SSL/TLS 설정을 불러옵니다.
const sslOptions = {
  key: fs.readFileSync('/etc/letsencrypt/live/supermax.kr/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/supermax.kr/fullchain.pem')
};

// 데이터베이스 연결을 설정합니다.
var db_config = {
  host: 'my8003.gabiadb.com',
  user: 'maxilsan',
  password: 'q141171616!',
  database: 'supermax',
  charset: 'utf8mb4'
};

var connection;

function handleDisconnect() {
  connection = mysql.createConnection(db_config); // Recreate the connection, since the old one cannot be reused.

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

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 대학정보기본 테이블과 반영비율 테이블을 조인하는 쿼리를 작성합니다.
app.get('/data', function(req, res) {
  const query = `
  SELECT * FROM 25정시
  `;

  connection.query(query, (err, rows, fields) => {
    if (err) {
      res.status(500).json({ message: 'Database query failed', error: err });
      return;
    }

    res.json(rows);
  });
});

// HTTPS 서버를 생성합니다.
const server = https.createServer(sslOptions, app);

server.listen(3000, '0.0.0.0', () => {
  console.log('Server running at https://0.0.0.0:3000/');
});
