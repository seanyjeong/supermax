// ✅ 26수시 실기 점수 서버 (정확한 실기ID 기반 전체 배점 매칭 + 종목 리스트 분리 API 추가)
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const app = express();
const port = 8080;

app.use(cors());
app.use(express.json());

const db = mysql.createConnection({
  host: '211.37.174.218',
  user: 'maxilsan',
  password: 'q141171616!',
  database: '26susi',
  charset: 'utf8mb4'
});

// 1. 실기ID 목록 (학교 선택용)
app.get('/26susi/practical-ids', (req, res) => {
  const sql = `
    SELECT MIN(ID) AS 실기ID, 대학명, 학과명, 전형명
    FROM \`26수시실기배점\`
    GROUP BY 대학명, 학과명, 전형명
    ORDER BY 대학명, 학과명
  `;
  db.query(sql, (err, rows) => {
    if (err) return res.status(500).json({ error: err });
    res.json(rows);
  });
});

// 2. 실기ID로 해당 종목 리스트만 (종목명 + 성별) 반환
app.get('/26susi/practical-event-list', (req, res) => {
  const { 실기ID } = req.query;
  const sql = `
    SELECT DISTINCT 종목명, 성별
    FROM \`26수시실기배점\`
    WHERE ID = ?
    ORDER BY 종목명
  `;
  db.query(sql, [실기ID], (err, rows) => {
    if (err) return res.status(500).json({ error: err });
    res.json(rows);
  });
});

// 3. 점수 계산
app.post('/26susi/practical', (req, res) => {
  const { 실기ID, 성별, 기록입력 } = req.body;
  if (!실기ID || !기록입력 || !성별) return res.json({ error: '필수값 없음' });

  const infoSql = `SELECT 대학명, 학과명, 전형명 FROM \`26수시실기배점\` WHERE ID = ? LIMIT 1`;
  db.query(infoSql, [실기ID], (err, infoRows) => {
    if (err || !infoRows.length) return res.status(500).json({ error: '실기ID에 대한 학교정보 없음' });

    const { 대학명, 학과명, 전형명 } = infoRows[0];

    const sql = `SELECT * FROM \`26수시실기배점\` WHERE ID = ?`;
    db.query(sql, [실기ID], (err, rows) => {
      if (err || !rows.length) return res.status(500).json({ error: '배점표 없음' });

      const 배점표 = rows.map(r => ({
        종목명: r.종목명.trim(),
        성별: r.성별.trim(),
        기록: r.기록.toString().trim(),
        배점: parseInt(r.배점)
      }));

      let total = 0;
      const results = [];

      for (const [event, recordRaw] of Object.entries(기록입력)) {
        const record = recordRaw.toString().trim();
        const isReverse = /m|런|run|10|20|100|왕복|z/i.test(event);

        const 후보 = 배점표.filter(row => row.종목명 === event && row.성별 === 성별);
        const target = parseFloat(record);
        const 정렬 = 후보
          .filter(r => !isNaN(parseFloat(r.기록)))
          .sort((a, b) => isReverse
            ? parseFloat(a.기록) - parseFloat(b.기록)
            : parseFloat(b.기록) - parseFloat(a.기록));

        let score = 0;
        for (const row of 정렬) {
          const 기준 = parseFloat(row.기록);
          if ((isReverse && 기준 >= target) || (!isReverse && 기준 <= target)) {
            score = row.배점;
            break;
          }
        }
        if (score === 0 && 정렬.length > 0) score = 정렬[정렬.length - 1].배점;

        results.push({ event, record, score });
        total += score;
      }

      res.json({ 실기ID, 대학명, 학과명, 전형명, 성별, total, details: results });
    });
  });
});

app.listen(port, () => {
  console.log(`✅ 26susi 점수 서버 실행 중! http://localhost:${port}`);
});
