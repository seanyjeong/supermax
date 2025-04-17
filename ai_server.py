from flask import Flask, jsonify
from flask_cors import CORS
import datetime
import random

app = Flask(__name__)
CORS(app)

# ✅ 국내 + 해외 ETF 리스트 (샘플, AI 확장 가능)
ETF_POOL = [
    # 해외 ETF
    {"ticker": "SQQQ", "name": "ProShares UltraPro Short QQQ", "region": "해외", "sector": "기술주", "theme": "하락장 숏전략"},
    {"ticker": "TQQQ", "name": "ProShares UltraPro QQQ", "region": "해외", "sector": "기술주", "theme": "상승장 레버리지"},
    {"ticker": "SOXL", "name": "Direxion Semiconductor Bull 3X", "region": "해외", "sector": "반도체", "theme": "반도체 레버리지 상승"},
    {"ticker": "ARKQ", "name": "ARK Autonomous Tech & Robotics", "region": "해외", "sector": "로보틱스", "theme": "자율주행 혁신"},

    # 국내 ETF
    {"ticker": "KODEX 반도체", "name": "KODEX 반도체", "region": "국내", "sector": "반도체", "theme": "삼성전자 반등 기대감"},
    {"ticker": "TIGER 2차전지", "name": "TIGER 2차전지", "region": "국내", "sector": "2차전지", "theme": "전기차 수요 확대"},
    {"ticker": "KODEX 인버스", "name": "KODEX 인버스", "region": "국내", "sector": "지수 하락", "theme": "단기 하락 방어"},
    {"ticker": "TIGER 미국S&P500", "name": "TIGER 미국S&P500", "region": "국내", "sector": "미국지수", "theme": "S&P500 추종"},
]

# ✅ 시그널 생성 함수
def generate_signals():
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    results = []

    for etf in ETF_POOL:
        prob = random.randint(65, 95)
        signal = "BUY" if prob >= 70 else "HOLD"
        buy_price = round(random.uniform(10, 100), 2)
        stop_loss = round(buy_price * 0.97, 2)
        take_profit = round(buy_price * 1.05, 2)

        results.append({
            "datetime": now,
            "ticker": etf["ticker"],
            "name": etf["name"],
            "region": etf["region"],
            "sector": etf["sector"],
            "theme": etf["theme"],
            "probability": prob,
            "signal": signal,
            "buy_price": buy_price,
            "stop_loss": stop_loss,
            "take_profit": take_profit,
            "reason": f"{etf['theme']} 관련 모멘텀 분석 기반 추천"
        })

    return results

# ✅ 뉴스 요약 함수
def generate_news():
    return [
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
    ]

@app.route('/signal')
def get_signals():
    return jsonify(generate_signals())

@app.route('/news')
def get_news():
    return jsonify(generate_news())

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000)
