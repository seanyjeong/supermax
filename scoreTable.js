// ✅ scoreTable.js
const express = require('express');
const router = express.Router();
const mysql = require('mysql');

const db = mysql.createConnection({
  host: '211.37.174.218',
  user: 'maxilsan',
  password: 'q141171616!',
  database: '정시엔진',
  charset: 'utf8mb4'
});

const scoreTable = {
  "제자리멀리뛰기": {
    남: [300, 298, 296, 294, 292, 290, 288, 286, 284, 282, 280, 278, 276, 274, 272, 270, 268, 266, 264, 262, 260, 258, 256, 254, 252, 250, 248, 246, 244, 242, 240, 238, 236, 234, 232, 230, 228, 226, 225],
    여: [250, 248, 246, 244, 242, 240, 238, 236, 234, 232, 230, 228, 226, 224, 222, 220, 218, 216, 214, 212, 210, 208, 206, 204, 202, 200, 198, 196, 194, 192, 190, 188, 186, 184, 182, 180, 178, 176, 175]
  },
  "20m왕복달리기": {
    남: [13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 14.0, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 15.0, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9, 16.0, 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8, 16.9, 17.0, 17.1, 17.2],
    여: [15.5, 15.6, 15.7, 15.8, 15.9, 16.0, 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8, 16.9, 17.0, 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9, 18.0, 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9, 19.0, 19.1, 19.2, 19.3],
    reverse: true
  },
  "좌전굴": {
    남: [30.0, 29.5, 29.0, 28.5, 28.0, 27.5, 27.0, 26.5, 26.0, 25.5, 25.0, 24.5, 24.0, 23.5, 23.0, 22.5, 22.0, 21.5, 21.0, 20.5, 20.0, 19.5, 19.0, 18.5, 18.0, 17.5, 17.0, 16.5, 16.0, 15.5, 15.0, 14.5, 14.0, 13.5, 13.0, 12.5, 12.0, 11.5, 11.4],
    여: [32.0, 31.5, 31.0, 30.5, 30.0, 29.5, 29.0, 28.5, 28.0, 27.5, 27.0, 26.5, 26.0, 25.5, 25.0, 24.5, 24.0, 23.5, 23.0, 22.5, 22.0, 21.5, 21.0, 20.5, 20.0, 19.5, 19.0, 18.5, 18.0, 17.5, 17.0, 16.5, 16.0, 15.5, 15.0, 14.5, 14.0, 13.5, 13.4]
  },
  "윗몸일으키기": {
    남: [75, 74, 73, 72, 71, 70, 69, 68, 67, 66, 65, 64, 63, 62, 61, 60, 59, 58, 57, 56, 55, 54, 53, 52, 51, 50, 49, 48, 47, 46, 45, 44, 43, 42, 41, 40, 39, 38, 37],
    여: [70, 69, 68, 67, 66, 65, 64, 63, 62, 61, 60, 59, 58, 57, 56, 55, 54, 53, 52, 51, 50, 49, 48, 47, 46, 45, 44, 43, 42, 41, 40, 39, 38, 37, 36, 35, 34, 33, 32]
  },
  "배근력": {
    남: [220, 218, 216, 214, 212, 210, 208, 206, 204, 202, 200, 198, 196, 194, 192, 190, 188, 186, 184, 182, 180, 178, 176, 174, 172, 170, 168, 166, 164, 162, 160, 158, 156, 154, 152, 150, 148, 146, 145.9],
    여: [150, 148, 146, 144, 142, 140, 138, 136, 134, 132, 130, 128, 126, 124, 122, 120, 118, 116, 114, 112, 110, 108, 106, 104, 102, 100, 98, 96, 94, 92, 90, 88, 86, 84, 82, 80, 78, 76, 75.9]
  },
  "메디신볼던지기": {
    남: [12.0, 11.8, 11.6, 11.4, 11.2, 11.0, 10.8, 10.6, 10.4, 10.2, 10.0, 9.8, 9.6, 9.4, 9.2, 9.0, 8.8, 8.6, 8.4, 8.2, 8.0, 7.8, 7.6, 7.4, 7.2, 7.0, 6.8, 6.6, 6.4, 6.2, 6.0, 5.8, 5.6, 5.4, 5.2, 5.0, 4.8, 4.6, 4.5],
    여: [9.0, 8.8, 8.6, 8.4, 8.2, 8.0, 7.8, 7.6, 7.4, 7.2, 7.0, 6.8, 6.6, 6.4, 6.2, 6.0, 5.8, 5.6, 5.4, 5.2, 5.0, 4.8, 4.6, 4.4, 4.2, 4.0, 3.8, 3.6, 3.4, 3.2, 3.0, 2.8, 2.6, 2.4, 2.2, 2.0, 1.8, 1.6, 1.5]
  },
  "10m왕복달리기": {
    남: [8.0, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 9.0, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 10.0, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 11.0, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8],
    여: [9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 10.0, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 11.0, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 12.0, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 13.0],
    reverse: true
  }
};

function getScore(event, gender, value) {
  const list = scoreTable[event][gender];
  const isReverse = scoreTable[event].reverse || false;
  for (let i = 0; i < list.length; i++) {
    const score = 100 - i * 2;
    const standard = list[i];
    if (isReverse) {
      if (value <= standard) return score;
    } else {
      if (value >= standard) return score;
    }
  }
  return 24;
}

router.post('/test-record', async (req, res) => {
  const {
    exam_number, name, grade, gender, branch, test_month,
    jump, run20m, sit_reach, situp, back, medball, run10m
  } = req.body;

  const scores = {
    jump_score: getScore('제자리멀리뛰기', gender, jump),
    run20m_score: getScore('20m왕복달리기', gender, run20m),
    sit_score: getScore('좌전굴', gender, sit_reach),
    situp_score: getScore('윗몸일으키기', gender, situp),
    back_score: getScore('배근력', gender, back),
    medball_score: getScore('메디신볼던지기', gender, medball),
    run10m_score: getScore('10m왕복달리기', gender, run10m)
  };

  const total_score = Object.values(scores).reduce((a, b) => a + b, 0);

  await db.query(
    `INSERT INTO 실기기록_테스트 (
      exam_number, name, grade, gender, branch, test_month,
      jump_cm, jump_score, run20m_sec, run20m_score,
      sit_reach_cm, sit_score, situp_count, situp_score,
      back_strength, back_score, medball_m, medball_score,
      run10m_sec, run10m_score, total_score
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [exam_number, name, grade, gender, branch, test_month,
     jump, scores.jump_score, run20m, scores.run20m_score,
     sit_reach, scores.sit_score, situp, scores.situp_score,
     back, scores.back_score, medball, scores.medball_score,
     run10m, scores.run10m_score, total_score]
  );

  res.json({ success: true, total_score });
});

router.get('/test-records', async (req, res) => {
  const { test_month } = req.query;
  let sql = 'SELECT * FROM 실기기록_테스트';
  const params = [];
  if (test_month) {
    sql += ' WHERE test_month = ?';
    params.push(test_month);
  }
  sql += ' ORDER BY total_score DESC';
  const [rows] = await new Promise((resolve, reject) => {
    db.query(sql, params, (err, results) => {
      if (err) reject(err);
      else resolve([results]);
    });
  });
  res.json({ success: true, records: rows });
});

module.exports = router;
