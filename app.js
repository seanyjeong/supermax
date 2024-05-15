const https = require('https');
const fs = require('fs');
const mysql = require('mysql');
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

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

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 정적 파일 제공을 위한 라우트 설정
app.use('/static', express.static(path.join(__dirname, 'supermax')));

// 3.html 파일의 내용을 반환하는 라우트
app.get('/page3', function(req, res) {
  const filePath = path.join(__dirname, 'supermax', '3.html');
  res.sendFile(filePath);
});

// HTTPS 서버를 생성합니다.
const server = https.createServer(sslOptions, app);

server.listen(3000, '0.0.0.0', () => {
  console.log('Server running at https://supermax.kr:3000/');
});
