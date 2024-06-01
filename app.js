const https = require('https');
const fs = require('fs');
const mysql = require('mysql');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const cors = require('cors');
const morgan = require('morgan');
const winston = require('winston');
const jwt = require('jsonwebtoken');

const app = express();

// 로그 설정
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

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
      logger.error('error when connecting to db:', err);
      setTimeout(handleDisconnect, 2000);
    }
  });

  connection.on('error', function(err) {
    logger.error('db error', err);
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
  secret: 'your_secret_key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: true }
}));

// CORS 설정
app.use(cors({
  origin: true, // 모든 도메인 허용
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// 명시적으로 CORS 헤더 추가
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS,POST,PUT');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
  } else {
    next();
  }
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// JWT 비밀키 설정
const jwtSecret = 'your_jwt_secret';

// HTTP 요청 로깅
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

// 로그인 엔드포인트
app.post('/login', (req, res) => {
  logger.info('Login attempt', { body: req.body });
  const { username, password } = req.body;
  const query = 'SELECT * FROM users WHERE username = ? AND password = ?';

  connection.query(query, [username, password], (err, results) => {
    if (err) {
      logger.error('Database query failed', { error: err });
      res.status(500).json({ message: 'Database query failed', error: err });
      return;
    }

    if (results.length > 0) {
      const token = jwt.sign({ username }, jwtSecret, { expiresIn: '1h' }); // JWT 토큰 발급
      logger.info('User logged in', { username });
      res.status(200).json({ message: 'Login successful', token }); // 토큰 반환
    } else {
      logger.warn('Invalid credentials', { username });
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
      logger.error('Database query failed', { error: err });
      res.status(500).json({ message: 'Database query failed', error: err });
      return;
    }
    logger.info('25정시 data retrieved', { rows: rows.length });
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
      logger.error('Database query failed', { error: err });
      res.status(500).json({ message: 'Database query failed', error: err });
      return;
    }
    rows.forEach(row => {
      if (row.image_data) {
        row.image_data = row.image_data.toString('base64');
      }
    });
    logger.info('25수시 data retrieved', { rows: rows.length });
    res.status(200).json(rows);
  });
});

// 이미지 데이터를 Base64로 인코딩하여 클라이언트에 제공
app.get('/image/:id', authenticateToken, (req, res) => {
  const imageId = req.params.id;
  const query = 'SELECT image_data FROM images WHERE id = ?';

  connection.query(query, [imageId], (err, rows) => {
    if (err) {
      logger.error('Database query failed', { error: err });
      res.status(500).json({ message: 'Database query failed', error: err });
      return;
    }
    if (rows.length > 0) {
      const imageData = rows[0].image_data.toString('base64');
      logger.info('Image data retrieved', { imageId });
      res.status(200).json({ image_data: imageData });
    } else {
      logger.warn('Image not found', { imageId });
      res.status(404).json({ message: 'Image not found' });
    }
  });
});

// 서버 시작
server.listen(3000, '0.0.0.0', () => {
  logger.info('Server running at https://0.0.0.0:3000/');
});
