const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 7000;
const TWELVE_API_KEY = '6827da1940aa4607a10a039a262a998e';

app.use(cors());
app.use(express.json());

// ✅ 전역 캐시 (1분 유지)
const globalPriceCache = {};
const lastFetchedTime = {};

// ✅ 해외 ETF 실시간 가격 (캐싱 포함)
async function getGlobalPrice(ticker) {
  const now = Date.now();
  if (globalPriceCache[ticker] && now - lastFetchedTime[ticker] < 60000) {
    return globalPriceCache[ticker];
  }

  try {
    const url = `https://api.twelvedata.com/price?symbol=${ticker}&apikey=${TWELVE_API_KEY}`;
    const res = await axios.get(url);
    const usd = parseFloat(res.data.price);
    const krw = Math.round(usd * 1370); // 환율 임의 고정 or 환율 API로 대체 가능

    const result = { price: usd, price_krw: krw, currency: 'USD', source: 'twelvedata' };
    globalPriceCache[ticker] = result;
    lastFetchedTime[ticker] = now;
    return result;
  } catch (e) {
    return { price: null, price_krw: null, currency: null, source: 'twelvedata' };
  }
}

// ✅ 국내 ETF 실시간 가격 (Daum)
async function getKoreanPrice(name) {
  const map = {
    'KODEX 반도체': 'A091160',
    'TIGER 2차전지': 'A305540',
    'KODEX 인버스': 'A114800',
    'TIGER 미국S&P500': 'A143850',
  };

  const code = map[name];
  if (!code) return { price: null, price_krw: null, currency: 'KRW', source: 'daum' };

  try {
    const res = await axios.get(`https://finance.daum.net/api/quotes/${code}`, {
      headers: { referer: 'https://finance.daum.net' },
    });

    const price = res.data.tradePrice;
    return {
      ticker: name,
      price,
      price_krw: price,
      currency: 'KRW',
      source: 'daum',
    };
  } catch (e) {
    return { price: null, price_krw: null, currency: 'KRW', source: 'daum' };
  }
}

// ✅ 가격 API (통합)
app.get('/etfapi/price', async (req, res) => {
  const { ticker } = req.query;

  if (!ticker) return res.status(400).json({ error: 'ticker is required' });

  const isKorean = ticker.includes('KODEX') || ticker.includes('TIGER');
  const result = isKorean ? await getKoreanPrice(ticker) : await getGlobalPrice(ticker);

  result.ticker = ticker;
  res.json(result);
});

// ✅ 시그널 프록시
app.get('/etfapi/signal', async (req, res) => {
  try {
    const signalRes = await axios.get('http://127.0.0.1:8000/signal');
    res.json(signalRes.data);
  } catch (err) {
    console.error('❌ [signal 전체] 처리 오류:', err.message);
    res.status(500).json({ error: '시그널 병합 실패' });
  }
});

// ✅ 뉴스 프록시
app.get('/etfapi/news', async (req, res) => {
  try {
    const newsRes = await axios.get('http://127.0.0.1:8000/news');
    res.json(newsRes.data);
  } catch (err) {
    console.error('❌ [news] AI 서버 연결 실패:', err.message);
    res.status(500).json({ error: 'AI 서버 연결 실패' });
  }
});

// ✅ 기본 경로
app.get('/', (req, res) => {
  res.send('✅ ETF API 서버 정상 작동 중');
});

app.listen(PORT, () => {
  console.log(`🚀 Node.js ETF API 서버 실행 중 → http://localhost:${PORT}`);
});
