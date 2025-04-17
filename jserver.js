const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 7000;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

const TOSS_CODES = {
  SQQQ: 'US20211109010',
  TQQQ: 'US19681202001',
  SOXL: 'US19960228004',
  ARKQ: 'US19960228003',
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

// ✅ /etfapi/price → 토스 API에서 ETF 시세 가져오기
app.get('/etfapi/price', async (req, res) => {
  const { ticker } = req.query;
  const code = TOSS_CODES[ticker];

  if (!code) {
    return res.status(400).json({ error: '지원되지 않는 ticker입니다' });
  }

  try {
    const url = `https://wts-info-api.tossinvest.com/api/v3/stock-prices?meta=true&productCodes=${code}`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });

    const priceInfo = response.data?.prices?.[code];
    if (!priceInfo) throw new Error('가격 정보 없음');

    const price = priceInfo.lastPrice;
    const currency = priceInfo.currency;
    const price_krw = currency === 'USD' ? priceInfo.krwPrice : price;

    return res.json({
      ticker,
      price,
      price_krw,
      currency,
      source: 'toss'
    });
  } catch (e) {
    console.warn(`❌ 토스 가격 API 실패 [${ticker}]:`, e.message);
    return res.status(200).json({
      ticker,
      price: null,
      price_krw: null,
      currency: null,
      source: 'toss'
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
