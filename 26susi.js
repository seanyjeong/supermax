const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const app = express();
const port = 8080;

app.use(cors());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PATCH, PUT, DELETE'); 
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(cors(corsOptions));


// DB 연결
const db = mysql.createConnection({
  host: '211.37.174.218',
  user: 'maxilsan',
  password: 'q141171616!',
  database: '26susi',
  charset: 'utf8mb4'
});

// 기록 낮을수록 좋은 종목 자동 판별
const isReverseScoring = (eventName) => /(m|런|달리기)/i.test(eventName);

// 점수 계산 API
app.get('/26susi/score-check', (req, res) => {
  const { univ_id, event, gender, record } = req.query;
  const 대학ID = parseInt(univ_id);
  const 기록 = parseFloat(record);

  if (!univ_id || !event || !gender || isNaN(기록)) {
    return res.status(400).json({ error: '필수 파라미터 누락' });
  }

  const reverse = isReverseScoring(event);
  const order = reverse ? 'ASC' : 'DESC';
  const comp = reverse ? '>=' : '<=';

  const query = `
    SELECT 배점
    FROM \`26수시실기배점\`
    WHERE 대학ID = ?
      AND 종목명 = ?
      AND 성별 = ?
      AND 기록 ${comp} ?
    ORDER BY 기록 ${order}
    LIMIT 1
  `;

  db.query(query, [대학ID, event, gender, 기록], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });

    if (results.length > 0) {
      return res.json({ score: results[0].배점 });
    } else {
      // 기록 범위 밖 처리
      if (대학ID === 1 || 대학ID === 3) {
        return res.json({ score: 0 }); // 파울 or 0점
      } else if (대학ID === 2) {
        // 최하 점수 조회
        const altQuery = `
          SELECT 배점 FROM \`26수시실기배점\`
          WHERE 대학ID = ? AND 종목명 = ? AND 성별 = ?
          ORDER BY 기록 ${order === 'DESC' ? 'ASC' : 'DESC'}
          LIMIT 1
        `;
        db.query(altQuery, [대학ID, event, gender], (err2, rows) => {
          if (err2) return res.status(500).json({ error: err2.message });
          if (rows.length > 0) return res.json({ score: rows[0].배점 });
          return res.json({ score: 0 });
        });
      } else {
        return res.json({ score: 0 });
      }
    }
  });
});

// 서버 실행
app.listen(port, () => {
  console.log(`✅ 26susi 점수 서버 실행 중! http://localhost:${port}/26susi/score-check`);
});
