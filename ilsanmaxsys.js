const express = require('express');
const router = express.Router();
const { dbAcademy } = require('./college'); // 학원관리 DB 연결

// ✅ 수강생 등록 API
router.post('/register-student', (req, res) => {
  const {
    name,
    grade,            // '1', '2', '3', 'N'
    gender,           // '남', '여'
    school,
    phone,
    parent_phone,
    tshirt_size,
    register_source,
    first_registered_at   // 'YYYY-MM-DD' 형태 (예: '2025-05-05')
  } = req.body;

  if (!name || !grade || !gender || !first_registered_at) {
    return res.status(400).json({ message: '❗ 필수 항목 누락' });
  }

  const sql = `
    INSERT INTO students 
    (name, grade, gender, school, phone, parent_phone, tshirt_size, register_source, first_registered_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [name, grade, gender, school, phone, parent_phone, tshirt_size, register_source, first_registered_at];

  dbAcademy.query(sql, values, (err, result) => {
    if (err) {
      console.error('❌ 수강생 등록 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json({ message: '✅ 수강생 등록 완료', student_id: result.insertId });
  });
});

module.exports = router;
