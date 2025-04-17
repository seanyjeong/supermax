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

// ✅ /etfapi/price → 실시간 ETF 가격 조회 (USD → KRW)
app.get('/etfapi/price', async (req, res) => {
  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'ticker 쿼리 누락' });

  try {
    const [priceRes, fxRes] = await Promise.all([
      axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&range=1d`),
      axios.get('https://api.exchangerate.host/latest?base=USD&symbols=KRW')
    ]);

    const priceData = priceRes.data?.chart?.result?.[0];
    const lastClose = priceData?.meta?.regularMarketPrice || priceData?.meta?.previousClose;
    const krwRate = fxRes.data?.rates?.KRW;

    if (!lastClose || !krwRate) {
      console.warn(`⚠️ [${ticker}] 가격 또는 환율 누락 → lastClose=${lastClose}, krwRate=${krwRate}`);
      return res.status(200).json({
        ticker,
        price: null,
        currency: 'USD',
        price_krw: null,
        krw_rate: krwRate || null
      });
    }

    res.json({
      ticker,
      price: lastClose,
      currency: 'USD',
      price_krw: Math.round(lastClose * krwRate),
      krw_rate: krwRate
    });
  } catch (err) {
    console.warn(`❌ [price] ${ticker} 시세 조회 실패:`, err.message);
    return res.status(200).json({
      ticker,
      price: null,
      currency: 'USD',
      price_krw: null,
      krw_rate: null
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
