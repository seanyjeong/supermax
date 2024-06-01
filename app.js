const https = require('https');
const fs = require('fs');
const mysql = require('mysql');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const cors = require('cors');
const morgan = require('morgan');
const winston = require('winston');

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
const allowedOrigins = ['https://supermax.co.kr'];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

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
      req.session.loggedIn = true;
      logger.info('User logged in', { username });
      res.status(200).json({ message: 'Login successful' });
    } else {
      logger.warn('Invalid credentials', { username });
      res.status(401).json({ message: 'Invalid credentials' });
    }
  });
});

// 로그인 여부를 확인하는 미들웨어
function isAuthenticated(req, res, next) {
  if (req.session.loggedIn) {
    return next();
  } else {
    logger.warn('Not authenticated');
    res.status(403).json({ message: 'Not authenticated' });
  }
}

// '25정시' 데이터를 가져오는 엔드포인트
app.get('/25jeongsi', isAuthenticated, (req, res) => {
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
app.get('/25susi', isAuthenticated, (req, res) => {
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
app.get('/image/:id', isAuthenticated, (req, res) => {
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
