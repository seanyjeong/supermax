const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 7000;
const TWELVE_API_KEY = '6827da1940aa4607a10a039a262a998e';

app.use(cors());
app.use(express.json());

// ✅ 미국 ETF 여부 판별용
function isUS(ticker) {
  return /^[A-Z]+$/.test(ticker);
}

// ✅ 가격 API (국내: 다음, 미국: TwelveData)
app.get('/etfapi/price', async (req, res) => {
  const ticker = req.query.ticker;
  try {
    if (isUS(ticker)) {
      // 🔹 미국 ETF → Twelve Data API
      const { data } = await axios.get(`https://api.twelvedata.com/price?symbol=${ticker}&apikey=${TWELVE_API_KEY}`);
      const price = parseFloat(data.price);
      res.json({
        ticker,
        price,
        price_krw: Math.round(price * 1370), // 원화 환산 고정환율
        currency: 'USD',
        source: 'twelvedata'
      });
    } else {
      // 🔹 국내 ETF → 다음 금융 크롤링
      const codeMap = {
        'KODEX 반도체': 'A091160',
        'TIGER 2차전지': 'A305720',
        'KODEX 인버스': 'A114800',
        'TIGER 미국S&P500': 'A143850'
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
    console.error(`❌ [${ticker}] 가격 가져오기 실패:`, err.message);
    res.status(500).json({
      ticker,
      price: null,
      price_krw: null,
      currency: null,
      source: 'error'
    });
  }
});

// ✅ 기본 시그널 (AI 서버 연동용)
app.get('/etfapi/signal', async (req, res) => {
  try {
    const { data } = await axios.get('http://localhost:8000/signal');
    res.json(data);
  } catch (err) {
    console.error('❌ AI 시그널 실패:', err.message);
    res.status(500).json({ error: 'AI 서버 연결 실패' });
  }
});

// ✅ 뉴스
app.get('/etfapi/news', async (req, res) => {
  try {
    const { data } = await axios.get('http://localhost:8000/news');
    res.json(data);
  } catch (err) {
    console.error('❌ AI 뉴스 실패:', err.message);
    res.status(500).json({ error: 'AI 서버 연결 실패' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Node.js ETF API 서버 실행 중 → http://localhost:${PORT}`);
});
