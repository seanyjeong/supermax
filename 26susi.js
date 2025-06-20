const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const app = express();
const port = 8080;

// CORS 설정
app.use(cors());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PATCH, PUT, DELETE'); 
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// DB 연결
const db = mysql.createConnection({
  host: '211.37.174.218',
  user: 'maxilsan',
  password: 'q141171616!',
  database: '26susi',
  charset: 'utf8mb4'
});

// 낮을수록 좋은 종목
const isReverseScoring = (eventName) => /(m|런|달리기)/i.test(eventName);

// 점수 계산 API
app.get('/26susi/score-check', (req, res) => {
  const { univ_id, event, gender, record } = req.query;
  console.log(`✅ 요청 들어옴: univ_id=${univ_id}, event=${event}, gender=${gender}, record=${record}`);

  const 대학ID = parseInt(univ_id);
  const 기록 = parseFloat(record);

  if (!univ_id || !event || !gender || isNaN(기록)) {
    console.warn("❌ 필수 파라미터 누락 또는 형식 오류");
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

  console.log(`[쿼리 실행] ${query}`);
  console.log(`[파라미터]`, [대학ID, event, gender, 기록]);

  db.query(query, [대학ID, event, gender, 기록], (err, results) => {
    if (err) {
      console.error("❌ 쿼리 오류:", err.message);
      return res.status(500).json({ error: err.message });
    }

    if (results.length > 0) {
      console.log(`🎯 점수 결과: ${results[0].배점}`);
      return res.json({ score: results[0].배점 });
    } else {
      console.warn("⚠️ 범위 내 점수 없음, fallback 처리");

      if (대학ID === 1 || 대학ID === 3) {
        console.log("→ fallback: 0점");
        return res.json({ score: 0 });
      } else if (대학ID === 2) {
        const altQuery = `
          SELECT 배점 FROM \`26수시실기배점\`
          WHERE 대학ID = ? AND 종목명 = ? AND 성별 = ?
          ORDER BY 기록 ${order === 'DESC' ? 'ASC' : 'DESC'}
          LIMIT 1
        `;
        console.log(`[fallback 쿼리] ${altQuery}`);

        db.query(altQuery, [대학ID, event, gender], (err2, rows) => {
          if (err2) {
            console.error("❌ fallback 쿼리 오류:", err2.message);
            return res.status(500).json({ error: err2.message });
          }
          if (rows.length > 0) {
            console.log("→ fallback 점수:", rows[0].배점);
            return res.json({ score: rows[0].배점 });
          }
          console.log("→ fallback도 결과 없음: 0점");
          return res.json({ score: 0 });
        });
      } else {
        console.log("→ fallback: 0점");
        return res.json({ score: 0 });
      }
    }
  });
});

// 서버 실행
app.listen(port, () => {
  console.log(`✅ 26susi 점수 서버 실행 중! http://localhost:${port}/26susi/score-check`);
});
