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

// ✅ isReverse 판별 함수
const isReverseEvent = (eventName) => {
  const lower = eventName.toLowerCase();
  return ['10', '20', 'run', '100', 'z', '달리기'].some(keyword => lower.includes(keyword));
};

// ✅ 1. 대학/학과 선택용 실기ID 목록
app.get('/26susi/practical-ids', (req, res) => {
  const sql = `
    SELECT MIN(ID) AS 실기ID, 대학명, 학과명, 전형명, 성별
    FROM \`26수시실기배점\`
    GROUP BY 대학명, 학과명, 전형명, 성별
    ORDER BY 대학명
  `;
  db.query(sql, (err, results) => {
    if (err) {
      console.error('❌ [실기ID 목록 조회 오류]', err);
      return res.status(500).json({ message: 'DB 오류' });
    }

    console.log('\n📌 [실기ID 목록 응답]');
    results.forEach(r => {
      console.log(`▶ 실기ID: ${r.실기ID} | ${r.대학명} / ${r.학과명} / ${r.전형명} / ${r.성별}`);
    });

    res.json(results);
  });
});



// ✅ 2. 종목명 + 성별 리스트
app.get('/26susi/events/:id', (req, res) => {
  const 실기ID = req.params.id;

  const sql = `
    SELECT DISTINCT 종목명, 성별
    FROM \`26수시실기배점\`
    WHERE 실기ID = ?
  `;
  db.query(sql, [실기ID], (err, results) => {
    if (err) {
      console.error('❌ [종목 조회 오류]', err);
      return res.status(500).json({ message: 'DB 오류' });
    }

    console.log(`\n📌 [실기ID ${실기ID} 종목 조회 결과]`);
    if (results.length === 0) {
      console.warn('⚠️ 종목 없음');
    } else {
      results.forEach(r => {
        console.log(`▶ 종목: ${r.종목명}, 성별: ${r.성별}`);
      });
    }

    res.json(results);
  });
});


// ✅ 3. 배점 계산 API
app.post('/26susi/calculate-score', (req, res) => {
  const { 실기ID, gender, inputs } = req.body;

  console.log('📥 요청 도착');
  console.log('실기ID:', 실기ID);
  console.log('성별:', gender);
  console.log('입력 기록:', inputs);

  const tasks = inputs.map((input) => {
    return new Promise((resolve, reject) => {
      const reverse = isReverseEvent(input.종목명);
      const operator = reverse ? '>=' : '<=';
      const order = reverse ? 'ASC' : 'DESC';

const sql = `
  SELECT 배점
  FROM \`26수시실기배점\`
  WHERE 실기ID = ? AND 종목명 = ? AND 성별 = ? AND CAST(기록 AS DECIMAL(10,2)) ${operator} ?
  ORDER BY CAST(기록 AS DECIMAL(10,2)) ${order}
  LIMIT 1
`;


      db.query(sql, [실기ID, input.종목명, gender, input.기록], (err, rows) => {
        if (err) {
          console.error('배점 쿼리 오류:', err);
          return reject(err);
        }

        const 점수 = rows.length > 0 ? Number(rows[0].배점) : 0;
        console.log(`▶ ${input.종목명} (${reverse ? '작을수록 높음' : '클수록 높음'}) → 기록: ${input.기록} → 배점: ${점수}`);
        resolve({ 종목명: input.종목명, 기록: input.기록, 배점: 점수 });
      });
    });
  });

  Promise.all(tasks)
    .then(results => {
      const 총점 = results.reduce((sum, row) => sum + row.배점, 0);
      console.log('✅ 총점:', 총점);
      res.json({ 종목별결과: results, 총점 });
    })
    .catch(err => {
      console.error('배점 계산 실패:', err);
      res.status(500).json({ message: '계산 오류', error: err });
    });
});

// ✅ 서버 실행
app.listen(port, () => {
  console.log(`🔥 26수시 실기배점 서버 실행 중: http://localhost:${port}`);
});
