const http = require('http');
const fs = require('fs');
const mysql = require('mysql');
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const requestIp = require('request-ip');
const axios = require('axios');

const app = express();
const jwtSecret = 'your_jwt_secret'; // JWT 비밀키 설정

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

  connection.connect(function (err) {
    if (err) {
      console.log('error when connecting to db:', err);
      setTimeout(handleDisconnect, 2000);
    }
  });

  connection.on('error', function (err) {
    console.log('db error', err);
    if (err.code === 'PROTOCOL_CONNECTION_LOST') {
      handleDisconnect();
    } else {
      throw err;
    }
  });
}

handleDisconnect();

// 세션 설정
app.use(session({
  secret: 'your_secret_key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false, sameSite: 'None' } // 쿠키 설정 조정
}));

// CORS 설정
app.use(cors({
  origin: 'https://supermax.co.kr',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(requestIp.mw({ attributeName: 'clientIp' }));

// HTTP 서버를 생성합니다.
const server = http.createServer(app);

// 로그인 엔드포인트
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const query = 'SELECT * FROM users WHERE username = ? AND password = ?';

  connection.query(query, [username, password], async (err, results) => {
    if (err) {
      res.status(500).json({ message: 'Database query failed', error: err });
      return;
    }

    if (results.length > 0) {
      const user = results[0];
      const token = jwt.sign({ username: user.username, legion: user.legion }, jwtSecret, { expiresIn: '1h' });

      // IP 주소 및 로그인 지역 정보를 가져와서 세션에 저장
      const ip = req.clientIp;
      let location = 'Unknown';

      try {
        const response = await axios.get(`http://ip-api.com/json/${ip}`);
        const data = response.data;
        location = `${data.city}, ${data.regionName}, ${data.country}`;
      } catch (error) {
        console.error('Error fetching IP location:', error);
      }

      req.session.ip = ip;
      req.session.location = location;
      req.session.username = user.username;
      req.session.legion = user.legion;

      res.status(200).json({ message: 'Login successful', token, username: user.username, legion: user.legion });
    } else {
      res.status(401).json({ message: 'Invalid credentials' });
    }
  });
});

// JWT 인증 미들웨어
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) return res.status(401).json({ message: 'No token provided' });

  jwt.verify(token, jwtSecret, (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid token' });
    req.user = user;
    next();
  });
}

// '25정시' 데이터를 가져오는 엔드포인트
app.get('/25jeongsi', authenticateToken, (req, res) => {
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
app.get('/25susi', authenticateToken, (req, res) => {
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
    rows.forEach(row => {
      if (row.image_data) {
        row.image_data = row.image_data.toString('base64');
      }
    });
    res.status(200).json(rows);
  });
});

// 이미지 데이터를 Base64로 인코딩하여 클라이언트에 제공
app.get('/image/:id', authenticateToken, (req, res) => {
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

// 비밀번호 변경 엔드포인트
app.post('/change-password', authenticateToken, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const username = req.user.username;

  const query = 'SELECT * FROM users WHERE username = ? AND password = ?';

  connection.query(query, [username, currentPassword], (err, results) => {
    if (err) {
      res.status(500).json({ message: 'Database query failed', error: err });
      return;
    }

    if (results.length > 0) {
      const updateQuery = 'UPDATE users SET password = ? WHERE username = ?';
      connection.query(updateQuery, [newPassword, username], (err, results) => {
        if (err) {
          res.status(500).json({ message: 'Database query failed', error: err });
          return;
        }
        res.status(200).json({ message: 'Password has been changed' });
      });
    } else {
      res.status(401).json({ message: 'Current password is incorrect' });
    }
  });
});

// 관리자 페이지 엔드포인트
app.get('/admin', authenticateToken, (req, res) => {
  if (req.user.username === 'sean8320') {
    res.status(200).json({
      ip: req.session.ip,
      location: req.session.location,
      username: req.session.username,
      legion: req.session.legion
    });
  } else {
    res.status(403).json({ message: 'Access denied' });
  }
});

// 서버 시작
server.listen(3000, '0.0.0.0', () => {
  console.log('Server running at http://0.0.0.0:3000/');
});
