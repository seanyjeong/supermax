// jungsi.js
// 간단한 테스트용 Node.js 서버 (Express)
// ENV: PORT(기본 9090), BASE_PATH(기본 /jungsi)

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const PORT = process.env.PORT || 9090;
const BASE_PATH = process.env.BASE_PATH || '/jungsi';

const app = express();

// 미들웨어
app.use(morgan('dev'));
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// 헬스체크
app.get(`${BASE_PATH}/health`, (req, res) => {
  res.json({ ok: true, service: 'jungsi', status: 'healthy', time: new Date().toISOString() });
});

// 서버 시간
app.get(`${BASE_PATH}/time`, (req, res) => {
  res.json({ now: new Date().toISOString(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
});

// 요청자 IP 확인
app.get(`${BASE_PATH}/ip`, (req, res) => {
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    req.ip;
  res.json({ ip });
});

// 에코(POST 테스트)
app.post(`${BASE_PATH}/echo`, (req, res) => {
  res.json({
    message: 'echo from jungsi',
    received: req.body || null,
    headers: req.headers,
  });
});

// 404 처리
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Not Found' });
});

// 시작
app.listen(PORT, () => {
  console.log(`[jungsi] listening on port ${PORT} (base: ${BASE_PATH})`);
});
