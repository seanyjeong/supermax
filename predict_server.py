from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
from datetime import datetime, timedelta
from sklearn.linear_model import LinearRegression

app = Flask(__name__)
CORS(app)  # 모든 도메인 허용

@app.route('/predict', methods=['POST'])
def predict():
    try:
        data = request.get_json()
        grouped = data.get("grouped", {})

        result = {}

        for event, records in grouped.items():
            if len(records) < 2:
                continue  # 최소 2개 이상 있어야 예측 가능

            # 날짜 → timestamp, 기록값 → float으로 변환
            X = np.array([datetime.strptime(r['created_at'], '%Y-%m-%d %H:%M:%S').timestamp() for r in records]).reshape(-1, 1)
            y = np.array([float(r['record']) for r in records])

            # 모델 학습
            model = LinearRegression()
            model.fit(X, y)

            # 마지막 날짜 기준으로 앞으로 3개 예측 (하루 간격)
            last_date = datetime.fromtimestamp(X[-1][0])
            future_dates = [(last_date + timedelta(days=i)).timestamp() for i in range(1, 4)]
            future_X = np.array(future_dates).reshape(-1, 1)
            pred_y = model.predict(future_X)

            # 결과 저장 (기본 타입으로 변환)
            result[event] = [
                { 'x': int(ts), 'y': float(val) }
                for ts, val in zip(future_dates, pred_y)
            ]

        return jsonify(result)

    except Exception as e:
        print("🔥 예측 실패:", e)
        return jsonify({ 'error': str(e) }), 500

if __name__ == '__main__':
    app.run(port=5050)
