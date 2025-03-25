from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
from datetime import datetime, timedelta
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
                continue  # 예측 최소 2개 필요

            # 순서를 인덱스로 사용 (하루에 여러 기록 있어도 괜찮게!)
            X = np.array([i for i in range(len(records))]).reshape(-1, 1)
            y = np.array([float(r['y']) for r in records])

            model = LinearRegression()
            model.fit(X, y)

            # 다음 3개 인덱스 예측
            future_X = np.array([len(records) + i for i in range(1, 4)]).reshape(-1, 1)
            pred_y = model.predict(future_X)

            # 예측값이 음수인 경우 0으로 보정
            pred_y = np.clip(pred_y, 0, None)

            # 오늘 날짜 기준으로 timestamp 생성
            last_ts = datetime.now()
            future_timestamps = [(last_ts + timedelta(days=i)).timestamp() for i in range(1, 4)]

            result[event] = [
                {'x': int(ts), 'y': float(y)} for ts, y in zip(future_timestamps, pred_y)
            ]

        return jsonify(result)

    except Exception as e:
        print("🔥 예측 실패:", e)
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(port=5050)
