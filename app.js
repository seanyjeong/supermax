const https = require('https');
const fs = require('fs');
const mysql = require('mysql');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
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

// CORS 헤더를 설정합니다.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  secret: 'secretKey',
  resave: false,
  saveUninitialized: true,
}));

// 정적 파일을 서비스할 디렉토리 설정
app.use(express.static(path.join(__dirname, '.')));

// 로그인 페이지
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

// 로그인 처리
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  const query = 'SELECT * FROM users WHERE username = ? AND password = ?';
  connection.query(query, [username, password], (err, results) => {
    if (err) {
      console.error('Database query failed:', err);
      return res.status(500).send('Database query failed. Please try again later.');
    }

    if (results.length > 0) {
      req.session.loggedIn = true;
      req.session.username = username;  // 세션에 사용자 ID 저장
      res.status(200).send('Login successful');
    } else {
      res.status(401).send('Invalid username or password. Please try again.');
    }
  });
});

// 세션 정보 제공 엔드포인트 추가
app.get('/session', (req, res) => {
  if (req.session.loggedIn) {
    res.json({ loggedIn: true, username: req.session.username });
  } else {
    res.json({ loggedIn: false });
  }
});

// 로그아웃 처리
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ message: 'Failed to logout', error: err });
    }
    res.redirect('/login');
  });
});

// 메인 페이지
app.get('/', (req, res) => {
  if (req.session.loggedIn) {
    res.sendFile(path.join(__dirname, 'index.html'));
  } else {
    res.redirect('/login');
  }
});

// '25정시' 데이터를 가져오는 엔드포인트
app.get('/25jeongsi', (req, res) => {
  if (req.session.loggedIn) {
    const query = 'SELECT * FROM 25정시';
    connection.query(query, (err, rows) => {
      if (err) {
        res.status(500).json({ message: 'Database query failed', error: err });
        return;
      }
      res.status(200).json(rows);
    });
  } else {
    res.status(401).json({ message: 'Unauthorized' });
  }
});

// '25수시' 데이터를 가져오는 엔드포인트
app.get('/25susi', (req, res) => {
  if (req.session.loggedIn) {
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
  } else {
    res.status(401).json({ message: 'Unauthorized' });
  }
});

// 이미지 데이터를 Base64로 인코딩하여 클라이언트에 제공
app.get('/image/:id', (req, res) => {
  if (req.session.loggedIn) {
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
  } else {
    res.status(401).json({ message: 'Unauthorized' });
  }
});

// 서버 시작
server.listen(3000, '0.0.0.0', () => {
  console.log('Server running at https://0.0.0.0:3000/');
});
