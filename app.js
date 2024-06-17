const http = require('http');
const fs = require('fs');
const mysql = require('mysql');
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const os = require('os');

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

// HTTP 서버를 생성합니다.
const server = http.createServer(app);

// 로그인 엔드포인트
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const query = 'SELECT * FROM users WHERE username = ? AND password = ?';

  connection.query(query, [username, password], (err, results) => {
    if (err) {
      res.status(500).json({ message: 'Database query failed', error: err });
      return;
    }

    if (results.length > 0) {
      const user = results[0];
      const token = jwt.sign({ username: user.username, legion: user.legion }, jwtSecret, { expiresIn: '1h' });
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

// 네트워크 트래픽 정보를 가져오는 함수
function getNetworkTraffic() {
  const interfaces = os.networkInterfaces();
  const trafficData = [];

  for (const iface in interfaces) {
    for (const address of interfaces[iface]) {
      if (address.family === 'IPv4' || address.family === 'IPv6') {
        trafficData.push({
          interface: iface,
          address: address.address,
          family: address.family,
          internal: address.internal
        });
      }
    }
  }

  return trafficData;
}

// 지점 목록과 트래픽 데이터를 가져오는 엔드포인트
app.get('/branch-list-data', authenticateToken, (req, res) => {
  const username = req.user.username;
  const userQuery = 'SELECT legion FROM users WHERE username = ?';

  connection.query(userQuery, [username], (err, results) => {
    if (err) {
      console.error('Error fetching user legion:', err);
      res.status(500).json({ message: 'Database query failed', error: err });
      return;
    }

    if (results.length > 0) {
      const userLegion = results[0].legion;
      const branchesQuery = 'SELECT * FROM users WHERE legion = ?';

      connection.query(branchesQuery, [userLegion], (err, branches) => {
        if (err) {
          console.error('Error fetching branches:', err);
          res.status(500).json({ message: 'Database query failed', error: err });
          return;
        }

        const trafficData = getNetworkTraffic();

        res.status(200).json({ branches, trafficData });
      });
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  });
});

// 서버 시작
server.listen(3000, '0.0.0.0', () => {
  console.log('Server running at http://0.0.0.0:3000/');
});
