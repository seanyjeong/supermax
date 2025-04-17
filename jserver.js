const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 7000;

app.use(cors());
app.use(express.json());

// ✅ /etfapi/signal → Python 서버에서 시그널 받아오기
app.get('/etfapi/signal', async (req, res) => {
  try {
    const response = await axios.get('http://localhost:8000/signal');
    res.json(response.data);
  } catch (err) {
    console.error('❌ [signal] AI 서버 연결 실패:', err.message);
    res.status(500).json({ error: 'AI 서버 연결 실패' });
  }
});

// ✅ /etfapi/news → Python 서버에서 뉴스 받아오기
app.get('/etfapi/news', async (req, res) => {
  try {
    const response = await axios.get('http://localhost:8000/news');
    res.json(response.data);
  } catch (err) {
    console.error('❌ [news] AI 서버 연결 실패:', err.message);
    res.status(500).json({ error: 'AI 서버 연결 실패' });
  }
});

// ✅ 기본 경로
app.get('/', (req, res) => {
  res.send('✅ ETF API 서버 정상 작동 중');
});

app.listen(PORT, () => {
  console.log(`🚀 Node.js ETF API 서버 실행됨 → http://localhost:${PORT}`);
});
