# -*- coding: utf-8 -*-
from flask import Flask, jsonify
from flask_cors import CORS
import datetime
import requests
import joblib
import pandas as pd

app = Flask(__name__)
CORS(app)

# ✅ 모델 로딩
signal_model = joblib.load('etf_model.pkl')
buy_model    = joblib.load('buy_model.pkl')
profit_model = joblib.load('profit_model.pkl')
loss_model   = joblib.load('loss_model.pkl')

# ✅ ETF 리스트
ETF_POOL = [
    {"ticker": "SQQQ", "name": "ProShares UltraPro Short QQQ", "region": "해외", "sector": "기술주", "theme": "하락장 숏전략"},
    {"ticker": "TQQQ", "name": "ProShares UltraPro QQQ", "region": "해외", "sector": "기술주", "theme": "상승장 레버리지"},
    {"ticker": "SOXL", "name": "Direxion Semiconductor Bull 3X", "region": "해외", "sector": "반도체", "theme": "반도체 레버리지 상승"},
    {"ticker": "ARKQ", "name": "ARK Autonomous Tech & Robotics", "region": "해외", "sector": "로보틱스", "theme": "자율주행 혁신"},
    {"ticker": "KODEX 반도체", "name": "KODEX 반도체", "region": "국내", "sector": "반도체", "theme": "삼성전자 반등 기대감"},
    {"ticker": "TIGER 2차전지", "name": "TIGER 2차전지", "region": "국내", "sector": "2차전지", "theme": "전기차 수요 확대"},
    {"ticker": "KODEX 인버스", "name": "KODEX 인버스", "region": "국내", "sector": "지수 하락", "theme": "단기 하락 방어"},
    {"ticker": "TIGER 미국S&P500", "name": "TIGER 미국S&P500", "region": "국내", "sector": "미국지수", "theme": "S&P500 추종"},
]

# ✅ 실시간 가격 API 키
TWELVE_API_KEY = "6827da1940aa4607a10a039a262a998e"
TWELVE_URL = "https://api.twelvedata.com/price"

# ✅ 실시간 가격 가져오기
def fetch_price(ticker, region):
    try:
        if region == "해외":
            r = requests.get(f"{TWELVE_URL}?symbol={ticker}&apikey={TWELVE_API_KEY}")
            data = r.json()
            return float(data.get("price", 0))
        else:
            code_map = {
                "KODEX 반도체": "A091160",
                "TIGER 2차전지": "A305540",
                "KODEX 인버스": "A114800",
                "TIGER 미국S&P500": "A360750"
            }
            code = code_map.get(ticker)
            if not code:
                return 0
            headers = {"referer": "https://finance.daum.net"}
            r = requests.get(f"https://finance.daum.net/api/quotes/{code}", headers=headers)
            return float(r.json().get("tradePrice", 0))
    except Exception as e:
        print(f"❌ 가격 조회 실패: {ticker} → {e}")
        return 0

# ✅ 시그널 생성
def generate_signals():
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    results = []

    for etf in ETF_POOL:
        price = fetch_price(etf["ticker"], etf["region"])
        if not price:
            continue

        # 📦 입력 feature 생성
        dummy = {
            "open": price * 0.98,
            "high": price * 1.01,
            "low": price * 0.97,
            "close": price,
            "volume": 5000000,
            "ma5": price * 0.99,
            "ma20": price * 1.01,
            "rsi": 50.0,
        }
        df = pd.DataFrame([dummy])

        # 🧠 예측
        try:
            signal = signal_model.predict(df)[0]
            probability = round(max(signal_model.predict_proba(df)[0]) * 100, 2)

            buy_price = round(buy_model.predict(df)[0], 2)
            take_profit = round(profit_model.predict(df)[0], 2)
            stop_loss = round(loss_model.predict(df)[0], 2)

        except Exception as e:
            print(f"🚨 예측 실패: {etf['ticker']} → {e}")
            continue

        # 📈 결과 추가
        results.append({
            "datetime": now,
            "ticker": etf["ticker"],
            "name": etf["name"],
            "region": etf["region"],
            "sector": etf["sector"],
            "theme": etf["theme"],
            "probability": probability,
            "signal": signal,
            "buy_price": buy_price,
            "stop_loss": stop_loss,
            "take_profit": take_profit,
            "reason": f"{etf['theme']} 관련 AI 시그널 추천"
        })

    return results

# ✅ API 엔드포인트
@app.route('/signal')
def get_signals():
    try:
        return jsonify(generate_signals())
    except Exception as e:
        return jsonify({"error": "시그널 병합 실패", "detail": str(e)}), 500

@app.route('/news')
def get_news():
    return jsonify([
        {
            "title": "CPI 발표로 금리 인하 기대감 확대",
            "summary": "인플레이션 둔화가 확인되며 미국 기술주 반등 가능성 제기",
            "related_ticker": ["TQQQ", "TIGER 미국S&P500"]
        },
        {
            "title": "삼성전자, 반도체 투자 확대 발표",
            "summary": "국내 반도체 섹터 수급 개선 기대감",
            "related_ticker": ["KODEX 반도체", "SOXL"]
        }
    ])

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000)
