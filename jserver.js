const express = require('express');
const axios = require('axios');
const cors = require('cors');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 7000;

// CORS 설정
app.use(cors({
  origin: '*',
  methods: ['GET'],
  allowedHeaders: ['Content-Type'],
}));
app.use(express.json());

// 🔑 Twelve Data API Key
const TWELVE_API_KEY = '6827da1940aa4607a10a039a262a998e';

// ✅ 해외 ETF 가격 가져오기
async function getGlobalPrice(ticker) {
  try {
    const url = `https://api.twelvedata.com/price?symbol=${ticker}&apikey=${TWELVE_API_KEY}`;
    const res = await axios.get(url);
    const usd = parseFloat(res.data.price);
    const krw = Math.round(usd * 1370); // 환율 고정 or 실시간 적용 가능
    return { price: usd, price_krw: krw, currency: 'USD', source: 'twelvedata' };
  } catch (err) {
    return { price: null, price_krw: null, currency: null, source: 'twelvedata' };
  }
}

// ✅ 국내 ETF 가격 가져오기 (Daum)
async function getKoreanPrice(ticker) {
  try {
    const searchUrl = `https://finance.daum.net/search?q=${encodeURIComponent(ticker)}`;
    const searchHtml = await axios.get(searchUrl, {
      headers: { referer: 'https://finance.daum.net' }
    });
    const $ = cheerio.load(searchHtml.data);
    const symbol = $('a[href*="/quotes/"]').attr('href')?.split('/').pop();

    if (!symbol) throw new Error('심볼 찾기 실패');

    const dataRes = await axios.get(`https://finance.daum.net/api/quotes/${symbol}`, {
      headers: { referer: 'https://finance.daum.net' }
    });
    const price = dataRes.data.tradePrice;
    return { price, price_krw: price, currency: 'KRW', source: 'daum' };
  } catch (err) {
    return { price: null, price_krw: null, currency: 'KRW', source: 'daum' };
  }
}

// ✅ 가격 API
app.get('/etfapi/price', async (req, res) => {
  const ticker = req.query.ticker;
  if (!ticker) return res.status(400).json({ error: 'ticker 파라미터 필요' });

  if (ticker.includes('KODEX') || ticker.includes('TIGER')) {
    const price = await getKoreanPrice(ticker);
    return res.json({ ticker, ...price });
  } else {
    const price = await getGlobalPrice(ticker);
    return res.json({ ticker, ...price });
  }
});

// ✅ 시그널 + 가격 병합
app.get('/etfapi/signal', async (req, res) => {
  try {
    const signalRes = await axios.get('http://127.0.0.1:8000/signal');
    const signalData = signalRes.data;

    const merged = await Promise.all(
      signalData.map(async (s) => {
        const priceRes = await axios.get(`http://127.0.0.1:7000/etfapi/price?ticker=${encodeURIComponent(s.ticker)}`);
        const priceData = priceRes.data;
        return {
          ...s,
          current_price: priceData.price,
          current_price_krw: priceData.price_krw,
          currency: priceData.currency,
        };
      })
    );

    res.json(merged);
  } catch (err) {
    console.error('❌ [signal 전체] 처리 오류:', err.message);
    res.status(500).json({ error: '시그널 병합 실패' });
  }
});

// ✅ 상태 확인용
app.get('/', (req, res) => {
  res.send('✅ ETF API 서버 정상 작동 중');
});

// ✅ 서버 실행
app.listen(PORT, () => {
  console.log(`🚀 Node.js ETF API 서버 실행 중 → http://localhost:${PORT}`);
});
