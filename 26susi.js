const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const app = express();
const port = 8080;

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PATCH, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const db = mysql.createConnection({
  host: '211.37.174.218',
  user: 'maxilsan',
  password: 'q141171616!',
  database: '26susi',
  charset: 'utf8mb4'
});

// 🔍 점수 매칭 함수
function getScore(실기ID, event, 성별, record, isReverse, cb) {
  console.log(`🟡 getScore():`, { 실기ID, event, 성별, record, isReverse });

  if (/^[A-Za-z]$/.test(record)) {
    const sql = `
      SELECT 배점 FROM \`26수시실기배점\`
      WHERE ID=? AND 종목명=? AND 성별=? AND 기록=?
      LIMIT 1
    `;
    console.log(`🔍 [등급] SQL: ${sql}`);
    db.query(sql, [실기ID, event, 성별, record], (err, rows) => {
      if (err) {
        console.error('❌ 등급 쿼리 에러:', err);
        return cb(0);
      }
      console.log(`✅ 등급 매칭 결과:`, rows);
      if (rows.length > 0) return cb(parseInt(rows[0].배점, 10));
      cb(0);
    });
  } else if (/^pass$/i.test(record) || /^fail$/i.test(record)) {
    console.log(`✅ PASS/FAIL 입력됨: ${record}`);
    cb(record.toLowerCase() === 'pass' ? 100 : 0);
  } else {
    const baseSQL = isReverse
      ? `SELECT 배점 FROM \`26수시실기배점\`
         WHERE ID=? AND 종목명=? AND 성별=? AND CAST(TRIM(기록) AS DECIMAL) >= ?
         ORDER BY CAST(TRIM(기록) AS DECIMAL) ASC LIMIT 1`
      : `SELECT 배점 FROM \`26수시실기배점\`
         WHERE ID=? AND 종목명=? AND 성별=? AND CAST(TRIM(기록) AS DECIMAL) <= ?
         ORDER BY CAST(TRIM(기록) AS DECIMAL) DESC LIMIT 1`;

    console.log(`🔍 [숫자기록] 쿼리:`, baseSQL, [실기ID, event, 성별, record]);

    db.query(baseSQL, [실기ID, event, 성별, record], (err, rows) => {
      if (err) {
        console.error('❌ 숫자기록 쿼리 에러:', err);
        return cb(0);
      }
      if (rows.length > 0) {
        console.log(`✅ 숫자 매칭 성공:`, rows);
        return cb(parseInt(rows[0].배점, 10));
      }

      // 🔁 매칭 없으면 보정 (최소값 or 최대값)
      const fallbackSQL = isReverse
        ? `SELECT 배점 FROM \`26수시실기배점\` WHERE ID=? AND 종목명=? AND 성별=? ORDER BY CAST(TRIM(기록) AS DECIMAL) ASC LIMIT 1`
        : `SELECT 배점 FROM \`26수시실기배점\` WHERE ID=? AND 종목명=? AND 성별=? ORDER BY CAST(TRIM(기록) AS DECIMAL) DESC LIMIT 1`;

      console.log('⚠️ 매칭 안 됨. 보정 쿼리:', fallbackSQL);

      db.query(fallbackSQL, [실기ID, event, 성별], (err2, fallbackRows) => {
        if (err2) {
          console.error('❌ fallback 쿼리 에러:', err2);
          return cb(0);
        }
        console.log(`🟢 fallback 결과:`, fallbackRows);
        if (fallbackRows.length > 0) return cb(parseInt(fallbackRows[0].배점, 10));
        cb(0);
      });
    });
  }
}

// 🧪 점수 계산 API
app.post('/26susi/practical', (req, res) => {
  const { 실기ID, 성별, 기록입력 } = req.body;
  const eventNames = Object.keys(기록입력 || {});
  if (!실기ID || eventNames.length === 0) return res.json({ error: "실기ID, 기록입력 필요", total: 0, details: [] });

  console.log(`🔵 실기ID ${실기ID}에 대한 기록입력:`, 기록입력);

  const infoSql = `
    SELECT 대학명, 학과명, 전형명 FROM \`26수시실기배점\`
    WHERE ID=? LIMIT 1
  `;
  db.query(infoSql, [실기ID], (err, infoRows) => {
    if (err || !infoRows.length) return res.status(404).json({ error: "실기ID에 해당하는 대학정보 없음" });

    const { 대학명, 학과명, 전형명 } = infoRows[0];
    let total = 0;
    let results = [];

    const checkEvent = (idx) => {
      if (idx >= eventNames.length) {
        return res.json({
          대학명,
          학과명,
          전형명,
          실기ID,
          성별,
          total,
          details: results
        });
      }
      const event = eventNames[idx];
      const record = 기록입력[event];
      const isReverse = /m|런|run|10|20|100|왕복|z/i.test(event);

      getScore(실기ID, event, 성별, record, isReverse, (score) => {
        console.log(`✅ 계산된 점수: ${event} (${record}) → ${score}`);
        results.push({ event, record, score });
        total += score;
        checkEvent(idx + 1);
      });
    };
    checkEvent(0);
  });
});

// 실기ID 목록
app.get('/26susi/practical-ids', (req, res) => {
  const sql = `
    SELECT MIN(ID) AS 실기ID, 대학명, 학과명, 전형명
    FROM \`26수시실기배점\`
    GROUP BY 대학명, 학과명, 전형명
    ORDER BY 대학명, 학과명
  `;
  db.query(sql, (err, rows) => {
    if (err) {
      console.error('❌ school list error:', err);
      return res.status(500).json({ error: err });
    }
    res.json(rows);
  });
});



// 종목목록
app.get('/26susi/practical-events', (req, res) => {
  const { 실기ID } = req.query;
  const sql = `
    SELECT 종목명, 성별, 기록, 배점
    FROM \`26수시실기배점\`
    WHERE ID = ?
    ORDER BY 종목명, CAST(TRIM(기록) AS DECIMAL) DESC
  `;
  db.query(sql, [실기ID], (err, rows) => {
    if (err) {
      console.error('❌ 종목 불러오기 에러:', err);
      return res.status(500).json({ error: err });
    }
    res.json(rows);
  });
});


// 서버 시작
app.listen(port, () => {
  console.log(`✅ 26susi 점수 서버 실행 중! http://localhost:${port}/26susi/practical`);
});
