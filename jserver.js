const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 7000;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// ✅ ETF 티커 → 다음 URL 매핑
const DAEUM_URLS = {
  SQQQ: 'https://finance.daum.net/quotes/US20211109010',
  TQQQ: 'https://finance.daum.net/quotes/US19681202001',
  SOXL: 'https://finance.daum.net/quotes/US19960228004',
  ARKQ: 'https://finance.daum.net/quotes/US19960228003',
};

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

// ✅ /etfapi/price → 다음 금융에서 크롤링해서 실시간 ETF 시세 가져오기
app.get('/etfapi/price', async (req, res) => {
  const { ticker } = req.query;
  const url = DAEUM_URLS[ticker];

  if (!url) {
    return res.status(400).json({ error: '지원되지 않는 ticker입니다' });
  }

  try {
    const html = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const $ = cheerio.load(html.data);
    const text = $('div[data-id="quote"] .current').first().text().replace(/,/g, '');
    const price_krw = parseFloat(text);

    if (!price_krw) throw new Error('가격 파싱 실패');

    return res.json({
      ticker,
      price: null,
      price_krw,
      currency: 'KRW',
      source: 'daum'
    });
  } catch (e) {
    console.warn(`❌ 다음 금융 크롤링 실패 [${ticker}]:`, e.message);
    return res.status(200).json({
      ticker,
      price: null,
      price_krw: null,
      currency: null,
      source: 'daum'
    });
  }
});

// ✅ 기본 경로
app.get('/', (req, res) => {
  res.send('✅ ETF API 서버 정상 작동 중');
});

app.listen(PORT, () => {
  console.log(`🚀 Node.js ETF API 서버 실행됨 → http://localhost:${PORT}`);
});
