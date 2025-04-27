
const express = require('express');
const router = express.Router();
const { db } = require('./college'); 
function dbQuery(sql, params) {
    return new Promise((resolve, reject) => {
      db.query(sql, params, (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });
  }
  

// 체크 저장 + 메모 저장
router.post('/save-debug-check', async (req, res) => {
  const { 대학학과ID, 체크여부, 메모 } = req.body;
  if (!대학학과ID) return res.status(400).json({ message: '대학학과ID 필요' });

  try {
    await dbQuery(`
      INSERT INTO 디버깅체크 (대학학과ID, 체크여부, 메모)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE 체크여부 = ?, 메모 = ?, updated_at = NOW()
    `, [대학학과ID, 체크여부, 메모, 체크여부, 메모]);

    res.json({ success: true });
  } catch (err) {
    console.error('❌ 디버깅 체크 저장 에러:', err);
    res.status(500).json({ success: false });
  }
});

// 체크+메모 조회
router.get('/get-debug-check', async (req, res) => {
  try {
    const results = await dbQuery('SELECT 대학학과ID, 체크여부, 메모 FROM 디버깅체크');
    res.json({ success: true, data: results });
  } catch (err) {
    console.error('❌ 디버깅 체크 조회 에러:', err);
    res.status(500).json({ success: false });
  }
});

router.get('/get-school-detail', async (req, res) => {
  const { 대학학과ID } = req.query;
  if (!대학학과ID) return res.status(400).json({ message: '대학학과ID 필요' });

  try {
    const [탐구] = await dbQuery('SELECT * FROM 탐구한국사 WHERE 대학학과ID = ?', [대학학과ID]);
    const [반영] = await dbQuery('SELECT * FROM 반영비율규칙 WHERE 대학학과ID = ?', [대학학과ID]);

    if (!탐구 || !반영) {
      return res.status(404).json({ message: '세부정보 없음' });
    }

    res.json({
      success: true,
      data: {
        탐구,
        반영
      }
    });
  } catch (err) {
    console.error('❌ 학교 세부정보 조회 에러:', err);
    res.status(500).json({ success: false });
  }
});


router.get('/calculate-all', async (req, res) => {
  try {
    const schools = await dbQuery('SELECT 대학학과ID, 대학명, 학과명 FROM 학교');

    const results = [];

    for (const school of schools) {
      const payload = {
        대학학과ID: school.대학학과ID,
        studentScore: {
          국어: { 표준점수: 100, 백분위: 66, 등급: 2 },
          수학: { 표준점수: 105, 백분위: 75, 등급: 1 },
          영어등급: 2,
          한국사등급: 1,
          탐구1: { 표준점수: 64, 백분위: 80, 등급: 1 },
          탐구2: { 표준점수: 63, 백분위: 85, 등급: 1 },
          내신: 0,
          실기: 0,
          subject1Name: "사회문화",
          subject2Name: "생활과윤리",
          국어과목명: "화법과작문",
          수학과목명: "확률과통계"
        }
      };

      const response = await fetch('https://supermax.kr/college/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      results.push({
       대학학과ID: school.대학학과ID, // ✅ 이거 추가해야 함
        대학명: school.대학명,
        학과명: school.학과명,
        totalScore: result.totalScore ?? '에러'
      });
    }

    res.json({ success: true, data: results });
  } catch (err) {
    console.error('❌ 전체 계산 에러:', err);
    res.status(500).json({ message: '전체 계산 실패' });
  }
});

module.exports = router;