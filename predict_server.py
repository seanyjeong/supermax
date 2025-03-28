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
                continue

            value_key = 'y' if 'y' in records[0] else 'record'
            values = [float(r[value_key]) for r in records]

            # ① 평균 계산
            mean = np.mean(values)
            slump_threshold = mean - 10

            # ② 가중치 설정
            weights = []
            for i, val in enumerate(values):
                if val < slump_threshold:
                    weights.append(0.5)  # 슬럼프 → 낮은 가중치
                else:
                    boost = 1.0 + (i / len(values))  # 선형 증가
                    weights.append(boost)

            # ③ 선형 회귀 + 가중치 적용
            X = np.arange(len(values)).reshape(-1, 1)
            y = np.array(values)
            sample_weight = np.array(weights)

            model = LinearRegression()
            model.fit(X, y, sample_weight=sample_weight)

            # ④ 미래 예측 (3일치)
            future_X = np.array([len(values) + i for i in range(1, 4)]).reshape(-1, 1)
            pred_y = model.predict(future_X)
            pred_y = np.clip(pred_y, 0, None)  # 음수 방지

            # ⑤ 날짜 변환
            last_ts = datetime.now()
            future_timestamps = [
                (last_ts + timedelta(days=i)).timestamp()
                for i in range(1, 4)
            ]

            result[event] = [
                {'x': int(ts), 'y': float(y)}
                for ts, y in zip(future_timestamps, pred_y)
            ]

        return jsonify(result)

    except Exception as e:
        print("🔥 예측 실패:", e)
        return jsonify({'error': str(e)}), 500


@app.route('/recommend-goal', methods=['POST'])
def recommend_goal():
    try:
        data = request.get_json()
        records = data.get('records', [])

        if len(records) < 2:
            return jsonify({'error': '기록이 최소 2개 이상 필요합니다.'}), 400

        value_key = 'record' if 'record' in records[0] else 'y'
        
        # 데이터 준비
        X = np.arange(len(records)).reshape(-1, 1)
        y = np.array([float(r[value_key]) for r in records])

        # 선형회귀 모델로 학습
        model = LinearRegression()
        model.fit(X, y)

        # 다음 기록 예측
        next_X = np.array([[len(records)]])
        predicted = model.predict(next_X)[0]

        # 최소 1% 이상 향상된 기록 추천
        recommended = max(predicted, max(y) * 1.01)

        # 신뢰도 계산 (R² 값)
        confidence = model.score(X, y)

        return jsonify({
            'recommended_goal': round(recommended, 4),
            'confidence': round(confidence, 2)
        })

    except Exception as e:
        print("🔥 목표 추천 실패:", e)
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(port=5050)
