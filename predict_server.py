from flask import Flask, request, jsonify
import numpy as np
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

@app.route('/predict', methods=['POST'])
def predict():
    data = request.get_json()
    grouped = data.get('grouped', {})
    result = {}

    for event, records in grouped.items():
        if len(records) < 2:
            result[event] = []
            continue

        x = np.array([r['x'] for r in records])
        y = np.array([r['y'] for r in records])

        A = np.vstack([x, np.ones(len(x))]).T
        m, c = np.linalg.lstsq(A, y, rcond=None)[0]

        last_x = x[-1]
        future_x = [last_x + 86400 * 7 * i for i in range(1, 4)]

        predictions = []
        for fx in future_x:
            predicted_y = float(m * fx + c)
            predictions.append({
                'x': fx * 1000,
                'y': round(predicted_y, 2)
            })

        result[event] = predictions

    return jsonify(result)

if __name__ == '__main__':
    app.run(port=5000)
