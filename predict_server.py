from datetime import datetime, timedelta
from dateutil.parser import parse
from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
from sklearn.linear_model import LinearRegression

app = Flask(__name__)
CORS(app)

@app.route('/predict', methods=['POST'])
def predict():
    try:
        data = request.get_json()
        grouped = data.get("grouped", {})
        result = {}

        for event, records in grouped.items():
            if len(records) < 2:
                continue

            # 날짜 → timestamp, 기록값 → float으로 변환
            timestamps = [parse(r['created_at']).timestamp() for r in records]
            base_time = timestamps[0]
            X = np.array([ts - base_time for ts in timestamps]).reshape(-1, 1)
            y = np.array([float(r['record']) for r in records])

            # 모델 학습
            model = LinearRegression()
            model.fit(X, y)

            # 미래 날짜 생성 (3일 예측)
            last_ts = timestamps[-1]
            future_ts = [last_ts + 86400 * i for i in range(1, 4)]  # 하루 간격 (초 단위)
            future_X = np.array([ts - base_time for ts in future_ts]).reshape(-1, 1)
            pred_y = model.predict(future_X)

            # 결과 저장
            result[event] = [
                { 'x': int(ts), 'y': float(val) }
                for ts, val in zip(future_ts, pred_y)
            ]

        return jsonify(result)

    except Exception as e:
        print("🔥 예측 실패:", e)
        return jsonify({ 'error': str(e) }), 500

if __name__ == '__main__':
    app.run(port=5050)
