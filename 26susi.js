const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const app = express();
const port = 8080;

// CORS 설정
app.use(cors());
app.use(express.json()); // JSON 바디 파싱

// CORS preflight 처리
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

// 점수 매칭 함수 (isReverse, cb 모두 확실하게)
function getScore(실기ID, event, 성별, record, isReverse, cb) {
  if (/^[A-Za-z]$/.test(record)) {
    // 등급(알파벳)
    const sql = `
      SELECT 배점 FROM \`26수시실기배점\`
      WHERE 실기ID=? AND 종목명=? AND 성별=? AND 기록=?
      LIMIT 1
    `;
    db.query(sql, [실기ID, event, 성별, record], (err, rows) => {
      if (err) return cb(0);
      if (rows.length > 0) return cb(parseInt(rows[0].배점, 10));
      cb(0);
    });
  } else if (/^pass$/i.test(record) || /^fail$/i.test(record)) {
    cb(record.toLowerCase() === 'pass' ? 100 : 0);
  } else {
    // 숫자 기록
    if (isReverse) {
      // 기록이 작을수록 점수 높음 (달리기)
      const sql = `
        SELECT 배점 FROM \`26수시실기배점\`
        WHERE 실기ID=? AND 종목명=? AND 성별=? AND CAST(기록 AS DECIMAL) >= ?
        ORDER BY CAST(기록 AS DECIMAL) ASC LIMIT 1
      `;
      db.query(sql, [실기ID, event, 성별, record], (err, rows) => {
        if (err) return cb(0);
        if (rows.length > 0) return cb(parseInt(rows[0].배점, 10));
        // 값 없으면 "최대 기록"의 배점 반환
        db.query(
          `SELECT 배점 FROM \`26수시실기배점\`
           WHERE 실기ID=? AND 종목명=? AND 성별=?
           ORDER BY CAST(기록 AS DECIMAL) ASC LIMIT 1`,
          [실기ID, event, 성별],
          (err2, minRows) => {
            if (minRows.length > 0) return cb(parseInt(minRows[0].배점, 10));
            cb(0);
          }
        );
      });
    } else {
      // 기록이 클수록 점수 높음 (제멀, 윗몸 등)
      const sql = `
        SELECT 배점 FROM \`26수시실기배점\`
        WHERE 실기ID=? AND 종목명=? AND 성별=? AND CAST(기록 AS DECIMAL) <= ?
        ORDER BY CAST(기록 AS DECIMAL) DESC LIMIT 1
      `;
      db.query(sql, [실기ID, event, 성별, record], (err, rows) => {
        if (err) return cb(0);
        if (rows.length > 0) return cb(parseInt(rows[0].배점, 10));
        // 값 없으면 "최소 기록"의 배점 반환
        db.query(
          `SELECT 배점 FROM \`26수시실기배점\`
           WHERE 실기ID=? AND 종목명=? AND 성별=?
           ORDER BY CAST(기록 AS DECIMAL) DESC LIMIT 1`,
          [실기ID, event, 성별],
          (err2, maxRows) => {
            if (maxRows.length > 0) return cb(parseInt(maxRows[0].배점, 10));
            cb(0);
          }
        );
      });
    }
  }
}

// 실기 점수 계산 라우터
app.post('/26susi/practical', (req, res) => {
  const { 실기ID, 성별, 기록입력 } = req.body;
  const eventNames = Object.keys(기록입력 || {});
  if (!실기ID || eventNames.length === 0) return res.json({ error: "실기ID, 기록입력 필요", total: 0, details: [] });

  // 실기ID로 대학정보(대학명, 학과명, 전형명) 가져오기
  const infoSql = `
    SELECT 대학명, 학과명, 전형명 FROM \`26수시실기배점\`
    WHERE 실기ID=? LIMIT 1
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
      // 여기서 isReverse 자동 감지
      const isReverse = /m|런|run|10|20|100|왕복|z/i.test(event);
      getScore(실기ID, event, 성별, record, isReverse, (score) => {
        results.push({ event, record, score });
        total += score;
        checkEvent(idx + 1);
      });
    };
    checkEvent(0);
  });
});

// 실기ID + 대학명 + 학과명 + 전형명 목록 (프론트 드롭다운용)
app.get('/26susi/practical-ids', (req, res) => {
  const sql = `
    SELECT DISTINCT 실기ID, 대학명, 학과명, 전형명
    FROM \`26수시실기배점\`
    WHERE 실기ID IS NOT NULL AND 실기ID != 0
    ORDER BY 대학명, 학과명, 전형명
  `;
  db.query(sql, (err, rows) => {
    if (err) {
      console.log('SQL ERROR:', err);
      return res.status(500).json({ error: err });
    }
    res.json(rows);
  });
});

// 종목 목록
app.get('/26susi/practical-events', (req, res) => {
  const { 실기ID } = req.query;
  const sql = `
    SELECT DISTINCT 종목명, 성별
    FROM \`26수시실기배점\`
    WHERE 실기ID = ?
  `;
  db.query(sql, [실기ID], (err, rows) => {
    if (err) return res.status(500).json({ error: err });
    res.json(rows);
  });
});

// 서버 실행
app.listen(port, () => {
  console.log(`✅ 26susi 점수 서버 실행 중! http://localhost:${port}/26susi/practical`);
});
