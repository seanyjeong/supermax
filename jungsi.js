// jungsi.js
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const mysql = require('mysql2/promise'); // ✅ promise 기반 mysql2

const PORT = process.env.PORT || 9090;
const BASE_PATH = process.env.BASE_PATH || '/jungsi';

const app = express();
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '5mb' }));

// ✅ MySQL 연결 설정
const pool = mysql.createPool({
  host: '211.37.174.218',
  user: 'maxilsan',
  password: 'q141171616!',
  database: 'jungsi',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// ✅ DB 연결 테스트 엔드포인트
app.get(`${BASE_PATH}/dbtest`, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT NOW() AS now');
    res.json({ ok: true, time: rows[0].now });
  } catch (err) {
    console.error('DB 연결 오류:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 기본 테스트 라우트
app.get(`${BASE_PATH}/health`, (req, res) => {
  res.json({ ok: true, service: 'jungsi', time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`[jungsi] listening on port ${PORT} (base: ${BASE_PATH})`);
});
