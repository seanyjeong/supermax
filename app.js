const https = require('https');
const fs = require('fs');
const mysql = require('mysql');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const app = express();

// SSL/TLS 설정을 불러옵니다.
const sslOptions = {
  key: fs.readFileSync('/etc/letsencrypt/live/supermax.kr/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/supermax.kr/fullchain.pem')
};

// 데이터베이스 연결을 설정합니다.
const db_config = {
  host: '211.37.174.218',
  user: 'maxilsan',
  password: 'q141171616!',
  database: 'supermax',
  charset: 'utf8mb4'
};

let connection;

function handleDisconnect() {
  connection = mysql.createConnection(db_config);

  connection.connect(function(err) {
    if (err) {
      console.log('error when connecting to db:', err);
      setTimeout(handleDisconnect, 2000);
    }
  });

  connection.on('error', function(err) {
    console.log('db error', err);
    if (err.code === 'PROTOCOL_CONNECTION_LOST') {
      handleDisconnect();
    } else {
      throw err;
    }
  });
}

handleDisconnect();

// HTTPS 서버를 생성합니다.
const server = https.createServer(sslOptions, app);

// 세션 설정
app.use(session({
  secret: 'your-secret-key', // secret key를 적절히 변경하세요
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // HTTPS를 사용하는 경우 secure: true로 설정
}));

// Body parser 설정
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// CORS 헤더를 설정합니다.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
  res.setHeader('Access-Control-Allow-Credentials', true);
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// 로그인 API
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const query = 'SELECT * FROM users WHERE username = ? AND password = ?';
  connection.query(query, [username, password], (err, results) => {
    if (err) {
      return res.status(500).json({ message: 'Database query failed', error: err });
    }
    if (results.length > 0) {
      req.session.loggedIn = true;
      req.session.username = username;
      return res.redirect('/index.html');
    } else {
      return res.status(401).send('아이디 또는 비밀번호가 일치하지 않습니다');
    }
  });
});

// 인증 미들웨어
function authMiddleware(req, res, next) {
  if (req.session.loggedIn) {
    next();
  } else {
    res.redirect('/login.html');
  }
}

// 정적 파일 제공 (로그인 페이지와 리소스들)
app.use(express.static('public'));

// 보호된 라우트 설정
app.get('/25susi.html', authMiddleware, (req, res) => {
  res.sendFile(__dirname + '/public/25susi.html');
});

app.get('/25jungsi.html', authMiddleware, (req, res) => {
  res.sendFile(__dirname + '/public/25jungsi.html');
});

// '25정시' 데이터를 가져오는 엔드포인트
app.get('/25jeongsi', authMiddleware, (req, res) => {
  const query = 'SELECT * FROM 25정시';
  connection.query(query, (err, rows) => {
    if (err) {
      res.status(500).json({ message: 'Database query failed', error: err });
      return;
    }
    res.status(200).json(rows);
  });
});

// '25수시' 데이터를 가져오는 엔드포인트
app.get('/25susi', authMiddleware, (req, res) => {
  const query = `
    SELECT s.*, i.image_data
    FROM 25수시 s
    LEFT JOIN images i ON s.id = i.id
  `;
  connection.query(query, (err, rows) => {
    if (err) {
      res.status(500).json({ message: 'Database query failed', error: err });
      return;
    }
    // 각 행의 image_data를 Base64 인코딩 문자열로 변환
    rows.forEach(row => {
      if (row.image_data) {
        row.image_data = row.image_data.toString('base64');
      }
    });
    res.status(200).json(rows);
  });
});

// 이미지 데이터를 Base64로 인코딩하여 클라이언트에 제공
app.get('/image/:id', authMiddleware, (req, res) => {
  const imageId = req.params.id;
  const query = 'SELECT image_data FROM images WHERE id = ?';

  connection.query(query, [imageId], (err, rows) => {
    if (err) {
      res.status(500).json({ message: 'Database query failed', error: err });
      return;
    }
    if (rows.length > 0) {
      const imageData = rows[0].image_data.toString('base64');
      res.status(200).json({ image_data: imageData });
    } else {
      res.status(404).json({ message: 'Image not found' });
    }
  });
});

// 서버 시작
server.listen(3000, '0.0.0.0', () => {
  console.log('Server running at https://0.0.0.0:3000/');
});
