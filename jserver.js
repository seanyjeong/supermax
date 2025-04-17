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

// ✅ /etfapi/price?ticker=XXXX → 실시간 가격 (미국 ETF만 우선 지원)
app.get('/etfapi/price', async (req, res) => {
  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'ticker 쿼리 누락' });

  try {
    const [priceRes, fxRes] = await Promise.all([
      axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&range=1d`),
      axios.get('https://api.exchangerate.host/latest?base=USD&symbols=KRW')
    ]);

    const priceData = priceRes.data.chart.result?.[0];
    const lastClose = priceData?.meta?.regularMarketPrice;
    const krwRate = fxRes.data.rates.KRW;

    if (!lastClose || !krwRate) throw new Error('데이터 누락');

    res.json({
      ticker,
      price: lastClose,
      currency: 'USD',
      price_krw: Math.round(lastClose * krwRate),
      krw_rate: krwRate
    });
  } catch (err) {
    console.error(`❌ [price] ${ticker} 시세 조회 실패:`, err.message);
    res.status(500).json({ error: '시세 조회 실패', detail: err.message });
  }
});

// ✅ 기본 경로
app.get('/', (req, res) => {
  res.send('✅ ETF API 서버 정상 작동 중');
});

app.listen(PORT, () => {
  console.log(`🚀 Node.js ETF API 서버 실행됨 → http://localhost:${PORT}`);
});
