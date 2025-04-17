const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 7000;
const TWELVE_API_KEY = '6827da1940aa4607a10a039a262a998e';

app.use(cors());
app.use(express.json());

// ✅ 미국 ETF 여부 판별
function isUS(ticker) {
  return /^[A-Z]+$/.test(ticker);
}

// ✅ 가격 조회 API
app.get('/etfapi/price', async (req, res) => {
const raw = req.query.ticker;
const ticker = Buffer.from(raw, 'latin1').toString('utf8');


  try {
    if (isUS(ticker)) {
      // ✅ 미국 ETF → Twelve Data
      const { data } = await axios.get(`https://api.twelvedata.com/price?symbol=${ticker}&apikey=${TWELVE_API_KEY}`);
      const price = parseFloat(data.price);

      res.json({
        ticker,
        price,
        price_krw: Math.round(price * 1370),
        currency: 'USD',
        source: 'twelvedata'
      });
    } else {
      // ✅ 국내 ETF → Daum 크롤링
      const codeMap = {
        'KODEX 반도체': 'A091160',
        'TIGER 2차전지': 'A305720',
        'KODEX 인버스': 'A114800',
        'TIGER 미국S&P500': 'A143850',
        'KODEX 2차전지': 'A102960',
        'TIGER 코스닥150': 'A232080',
        'TIGER 차이나전기차': 'A371460'
      };

      const code = codeMap[ticker];
      if (!code) throw new Error('국내 티커 매핑 없음');

      const url = `https://finance.daum.net/quotes/${code}`;
      const response = await axios.get(url, {
        headers: { referer: 'https://finance.daum.net/' }
      });

      const $ = cheerio.load(response.data);
      const priceText = $('.stock .num').first().text().replace(/,/g, '');
      const price = parseFloat(priceText);

      res.json({
        ticker,
        price,
        price_krw: price,
        currency: 'KRW',
        source: 'daum'
      });
    }
  } catch (err) {
    console.error(`❌ [${ticker}] 가격 조회 실패:`, err.message);
    res.status(500).json({
      ticker,
      price: null,
      price_krw: null,
      currency: null,
      source: 'error'
    });
  }
});

// ✅ 시그널 → Python Flask 연동
app.get('/etfapi/signal', async (req, res) => {
  try {
    const { data } = await axios.get('http://localhost:8000/signal');
    res.json(data);
  } catch (err) {
    console.error('❌ AI 시그널 실패:', err.message);
    res.status(500).json({ error: 'AI 서버 연결 실패' });
  }
});

// ✅ 뉴스 → Python Flask 연동
app.get('/etfapi/news', async (req, res) => {
  try {
    const { data } = await axios.get('http://localhost:8000/news');
    res.json(data);
  } catch (err) {
    console.error('❌ AI 뉴스 실패:', err.message);
    res.status(500).json({ error: 'AI 서버 연결 실패' });
  }
});

// ✅ 루트 확인
app.get('/', (req, res) => {
  res.send('✅ ETF API 서버 작동 중');
});

app.listen(PORT, () => {
  console.log(`🚀 Node.js ETF API 서버 실행 중 → http://localhost:${PORT}`);
});
