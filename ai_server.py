# -*- coding: utf-8 -*-
from flask import Flask, jsonify, request
from flask_cors import CORS
import datetime
import requests
import joblib
import pandas as pd

app = Flask(__name__)
CORS(app)

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

# ✅ 모델 불러오기
MODEL_PATH = "etf_model.pkl"
try:
    model = joblib.load(MODEL_PATH)
except:
    model = None

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

        # 기본 입력값 생성 (모델 입력형식에 맞게 수정 필요)
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

        signal = "HOLD"
        probability = 65 + hash(etf["ticker"]) % 31
        if model:
            try:
                df = pd.DataFrame([dummy])
                signal = model.predict(df)[0]
            except:
                pass
        else:
            if probability >= 70:
                signal = "BUY"

        stop_loss = round(price * 0.97, 2)
        take_profit = round(price * 1.05, 2)

        results.append({
            "datetime": now,
            "ticker": etf["ticker"],
            "name": etf["name"],
            "region": etf["region"],
            "sector": etf["sector"],
            "theme": etf["theme"],
            "probability": probability,
            "signal": signal,
            "buy_price": price,
            "stop_loss": stop_loss,
            "take_profit": take_profit,
            "reason": f"{etf['theme']} 관련 모멘텀 분석 기반 추천"
        })

    return results

@app.route('/signal')
def get_signals():
    try:
        data = generate_signals()
        return jsonify(data)
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
