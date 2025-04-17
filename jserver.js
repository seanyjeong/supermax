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

// ✅ 시그널 가져오기 + 가격 병합
app.get('/etfapi/signal', async (req, res) => {
  try {
    const signalRes = await axios.get('http://localhost:8000/signal');
    const signals = signalRes.data;

    const results = await Promise.all(
      signals.map(async (item) => {
        try {
          if (item.region === '국내') {
            return { ...item, current_price: null, current_price_krw: null };
          }

          const priceRes = await axios.get(`https://supermax.kr/etfapi/price?ticker=${encodeURIComponent(item.ticker)}`);
          const { price, price_krw, currency } = priceRes.data;

          return {
            ...item,
            current_price: price,
            current_price_krw: price_krw,
            currency
          };
        } catch (err) {
          console.warn(`❌ 가격 실패: ${item.ticker}`, err.message);
          return { ...item, current_price: null, current_price_krw: null };
        }
      })
    );

    res.json(results);
  } catch (err) {
    console.error('❌ [signal 전체] 처리 오류:', err.message);
    res.status(500).json({ error: '시그널 병합 실패' });
  }
});

// ✅ 가격 API (이미 작동 중이면 유지)
app.get('/etfapi/price', async (req, res) => {
  const ticker = req.query.ticker;
  if (!ticker) return res.status(400).json({ error: 'ticker 쿼리 필요' });

  try {
    const isDomestic = /KODEX|TIGER/.test(ticker);
    if (isDomestic) {
      const codeMap = {
        "KODEX 반도체": "A091160",
        "TIGER 2차전지": "A305720",
        "KODEX 인버스": "A114800",
        "TIGER 미국S&P500": "A143850"
      };
      const daumCode = codeMap[ticker];
      if (!daumCode) throw new Error('해당 국내 ETF 코드 없음');

      const resDaum = await axios.get(`https://finance.daum.net/api/quotes/${daumCode}`, {
        headers: { referer: 'https://finance.daum.net' }
      });
      const tradePrice = resDaum.data.tradePrice;
      return res.json({ ticker, price: tradePrice, price_krw: tradePrice, currency: "KRW", source: "daum" });
    } else {
      const API_KEY = "6827da1940aa4607a10a039a262a998e";
      const url = `https://api.twelvedata.com/price?symbol=${ticker}&apikey=${API_KEY}`;
      const response = await axios.get(url);
      const price = parseFloat(response.data.price);
      const rate = 1370; // 환율 고정값

      return res.json({
        ticker,
        price,
        price_krw: Math.round(price * rate),
        currency: "USD",
        source: "twelvedata"
      });
    }
  } catch (e) {
    console.error(`❌ 가격 오류: ${ticker} | ${e.message}`);
    return res.json({
      ticker,
      price: null,
      price_krw: null,
      currency: null,
      source: 'error'
    });
  }
});

app.get('/', (req, res) => {
  res.send('✅ ETF API 서버 정상 작동 중');
});

app.listen(PORT, () => {
  console.log(`🚀 Node.js ETF API 서버 실행 중 → http://localhost:${PORT}`);
});
