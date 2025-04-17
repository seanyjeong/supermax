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

const TWELVE_API_KEY = '6827da1940aa4607a10a039a262a998e';

// 국내 ETF 코드 매핑
const codeMap = {
  'KODEX 반도체': 'A091160',
  'TIGER 2차전지': 'A305720',
  'KODEX 인버스': 'A114800',
  'TIGER 미국S&P500': 'A143850'
};

// ✅ 실시간 가격 조회 (국내/해외 모두)
app.get('/etfapi/price', async (req, res) => {
  const raw = req.query.ticker;
  const ticker = Buffer.from(raw, 'latin1').toString('utf8');

  // 국내 종목이면 다음 API
  if (codeMap[ticker]) {
    try {
      const code = codeMap[ticker];
      const { data } = await axios.get(`https://finance.daum.net/api/quotes/${code}`, {
        headers: {
          referer: 'https://finance.daum.net'
        }
      });
      const price = parseFloat(data.tradePrice);
      return res.json({
        ticker,
        price,
        price_krw: price,
        currency: 'KRW',
        source: 'daum'
      });
    } catch (err) {
      console.error('❌ 국내 ETF 가격 실패:', err.message);
      return res.json({
        ticker,
        price: null,
        price_krw: null,
        currency: 'KRW',
        source: 'daum'
      });
    }
  }

  // 해외 종목이면 TwelveData API
  try {
    const url = `https://api.twelvedata.com/price?symbol=${ticker}&apikey=${TWELVE_API_KEY}`;
    const { data } = await axios.get(url);

    const price = parseFloat(data.price);
    const krwRate = 1370; // 환율 하드코딩 or API 연동 가능
    return res.json({
      ticker,
      price,
      price_krw: Math.round(price * krwRate),
      currency: 'USD',
      source: 'twelvedata'
    });
  } catch (err) {
    console.error('❌ 해외 ETF 가격 실패:', err.message);
    return res.json({
      ticker,
      price: null,
      price_krw: null,
      currency: 'USD',
      source: 'twelvedata'
    });
  }
});

// ✅ 시그널 프록시
app.get('/etfapi/signal', async (req, res) => {
  try {
    const { data } = await axios.get('http://localhost:8000/signal');
    res.json(data);
  } catch (err) {
    console.error('❌ [signal] AI 서버 연결 실패:', err.message);
    res.status(500).json({ error: 'AI 서버 연결 실패' });
  }
});

// ✅ 뉴스 프록시
app.get('/etfapi/news', async (req, res) => {
  try {
    const { data } = await axios.get('http://localhost:8000/news');
    res.json(data);
  } catch (err) {
    console.error('❌ [news] AI 서버 연결 실패:', err.message);
    res.status(500).json({ error: 'AI 서버 연결 실패' });
  }
});

// ✅ 헬스체크
app.get('/', (req, res) => {
  res.send('✅ ETF API 서버 정상 작동 중');
});

app.listen(PORT, () => {
  console.log(`🚀 Node.js ETF API 서버 실행 중 → http://localhost:${PORT}`);
});
