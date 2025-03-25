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
                continue  # 최소 2개 필요

            # ✅ record 값 찾기 (record 또는 y 중 있는 키 사용)
            sample = records[0]
            value_key = 'y' if 'y' in sample else 'record'

            X = np.array([i for i in range(len(records))]).reshape(-1, 1)
            y = np.array([float(r[value_key]) for r in records])

            model = LinearRegression()
            model.fit(X, y)

            future_X = np.array([len(records) + i for i in range(1, 4)]).reshape(-1, 1)
            pred_y = model.predict(future_X)
            pred_y = np.clip(pred_y, 0, None)

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
