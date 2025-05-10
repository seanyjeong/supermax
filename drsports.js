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

router.post('/register-members', (req, res) => {
  const members = req.body;

  if (!Array.isArray(members) || members.length === 0) {
    return res.status(400).json({ message: '❗ 등록할 회원 정보가 없습니다' });
  }

  const values = members.map(m => [
    m.name,
    m.birth,
    m.phone || '',
    m.parent_phone || '',
    m.gender,
    m.status || '재원'
  ]);

  const sql = `
    INSERT INTO members (name, birth, phone, parent_phone, gender, status)
    VALUES ?
  `;

  db_drsports.query(sql, [values], (err, result) => {
    if (err) {
      console.error('❌ 일괄 등록 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json({ message: `✅ ${result.affectedRows}명 등록 완료` });
  });
});


router.put('/update-member/:id', (req, res) => {
  const { id } = req.params;
  const { name, birth, phone, parent_phone, gender, status } = req.body;

  const sql = `
    UPDATE members
    SET name = ?, birth = ?, phone = ?, parent_phone = ?, gender = ?, status = ?
    WHERE id = ?
  `;
  db_drsports.query(sql, [name, birth, phone, parent_phone, gender, status, id], (err, result) => {
    if (err) {
      console.error('❌ 회원 수정 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json({ message: '✅ 회원 수정 완료' });
  });
});

router.delete('/delete-member/:id', (req, res) => {
  const { id } = req.params;

  const sql = `DELETE FROM members WHERE id = ?`;
  db_drsports.query(sql, [id], (err, result) => {
    if (err) {
      console.error('❌ 회원 삭제 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json({ message: '🗑️ 회원 삭제 완료' });
  });
});


module.exports = router;
