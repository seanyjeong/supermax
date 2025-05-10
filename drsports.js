const express = require('express');
const router = express.Router();
const { db_drsports } = require('./college');  // ⬅ 요거!

// ✅ 예: 회원 목록 조회
router.get('/members', (req, res) => {
  db_drsports.query('SELECT * FROM members ORDER BY registered_at DESC', (err, rows) => {
    if (err) {
      console.error('❌ 회원 조회 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json(rows);
  });
});

module.exports = router;
