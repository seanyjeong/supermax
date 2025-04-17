const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 7000;

app.use(cors());
app.use(express.json());

// ✅ /etfapi/signal
app.get('/etfapi/signal', async (req, res) => {
  try {
    const response = await axios.get('http://localhost:8000/signal');
    res.json(response.data);
  } catch (err) {
    console.error('❌ 시그널 오류:', err.message);
    res.status(500).json({ error: 'AI 서버 연결 실패' });
  }
});

// ✅ /etfapi/news
app.get('/etfapi/news', async (req, res) => {
  try {
    const response = await axios.get('http://localhost:8000/news');
    res.json(response.data);
  } catch (err) {
    console.error('❌ 뉴스 오류:', err.message);
    res.status(500).json({ error: 'AI 서버 연결 실패' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Node 서버 실행 중: http://localhost:${PORT}`);
});
