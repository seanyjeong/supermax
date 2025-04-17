const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = 7000;

// ✅ GitHub Pages에서 호출 가능하게 CORS 열기
app.use(cors({
  origin: '*' // 필요 시 GitHub Pages 주소로 제한 가능
}));

app.use(express.json());

// ✅ Python 시그널 서버 프록시
app.get('/etfapi/signal', async (req, res) => {
  try {
    const response = await axios.get('http://localhost:8000/signal');
    res.json(response.data);
  } catch (err) {
    console.error('❌ 시그널 요청 실패:', err.message);
    res.status(500).json({ error: 'Python 서버에 연결 실패' });
  }
});

// ✅ 뉴스 요약 프록시
app.get('/etfapi/news', async (req, res) => {
  try {
    const response = await axios.get('http://localhost:8000/news');
    res.json(response.data);
  } catch (err) {
    console.error('❌ 뉴스 요청 실패:', err.message);
    res.status(500).json({ error: 'Python 서버에 연결 실패' });
  }
});

// ✅ 문자 발송용 API (연결되면 여기에 붙이기)
app.post('/etfapi/send-sms', (req, res) => {
  const { to, message } = req.body;
  console.log(`📩 문자 전송 요청 → ${to}: ${message}`);
  // 문자 API 연동 로직 여기에 작성 예정
  res.json({ success: true });
});

// ✅ 서버 시작
app.listen(PORT, () => {
  console.log(`✅ Node 서버 실행 중: http://localhost:${PORT}`);
});
