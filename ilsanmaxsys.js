const express = require('express');
const router = express.Router();
const { dbAcademy } = require('./college');



// ✅ 수강생 전체 조회 API
router.get('/students', (req, res) => {
  dbAcademy.query('SELECT * FROM students ORDER BY created_at DESC', (err, rows) => {
    if (err) {
      console.error('❌ 수강생 조회 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json(rows);
  });
});

// ✅ 강사 등록 API
router.post('/register-instructor', (req, res) => {
  const { name, birth_year, position, gender, phone } = req.body;

  if (!name || !birth_year || !gender) {
    return res.status(400).json({ message: '❗ 필수 항목 누락' });
  }

  const sql = `
    INSERT INTO instructors 
    (name, birth_year, position, gender, phone)
    VALUES (?, ?, ?, ?, ?)
  `;

  dbAcademy.query(sql, [name, birth_year, position, gender, phone], (err, result) => {
    if (err) {
      console.error('❌ 강사 등록 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json({ message: '✅ 강사 등록 완료', instructor_id: result.insertId });
  });
});

// ✅ 강사 전체 조회 API
router.get('/instructors', (req, res) => {
  dbAcademy.query('SELECT * FROM instructors ORDER BY created_at DESC', (err, rows) => {
    if (err) {
      console.error('❌ 강사 조회 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json(rows);
  });
});

// 월결제
router.post('/register-payment', (req, res) => {
    const {
      student_id,
      month,             // '2025-05'
      weekdays,          // ['월', '수', '금']
      session_count,
      amount,
      is_manual = false,
      status = '정상',
      paid_at
    } = req.body;
  
    if (!student_id || !month || !Array.isArray(weekdays) || !session_count) {
      return res.status(400).json({ message: '❗ 필수 항목 누락' });
    }
  
    const weekdaysStr = weekdays.join(',');
    let finalAmount = amount;
  
    if (!is_manual) {
      if (session_count >= 5) finalAmount = 550000;
      else if (session_count === 4) finalAmount = 500000;
      else if (session_count === 3) finalAmount = 400000;
      else if (session_count === 2) finalAmount = 300000;
      else finalAmount = 150000;
    }
  
    const sql = `
      INSERT INTO payments 
      (student_id, month, weekdays, session_count, amount, is_manual, status, paid_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
  
    dbAcademy.query(sql, [student_id, month, weekdaysStr, session_count, finalAmount, is_manual, status, paid_at], (err, result) => {
      if (err) {
        console.error('❌ 일반 결제 등록 실패:', err);
        return res.status(500).json({ message: 'DB 오류' });
      }
      res.json({ message: '✅ 결제 등록 완료', payment_id: result.insertId });
    });
  });
//월결제 불러오기
  router.get('/payments/:student_id', (req, res) => {
    const student_id = req.params.student_id;
  
    const sql = `
      SELECT * FROM payments 
      WHERE student_id = ? 
      ORDER BY month DESC
    `;
  
    dbAcademy.query(sql, [student_id], (err, rows) => {
      if (err) {
        console.error('❌ 결제 내역 조회 실패:', err);
        return res.status(500).json({ message: 'DB 오류' });
      }
      res.json(rows);
    });
  });

  //시즌비
  router.post('/register-season-payment', (req, res) => {
    const {
      student_id,
      season_type,       // '수시' or '정시'
      start_month,       // '2025-07'
      end_month,         // '2025-10'
      amount,
      paid_at,
      note
    } = req.body;
  
    if (!student_id || !season_type || !start_month || !end_month || !amount) {
      return res.status(400).json({ message: '❗ 필수 항목 누락' });
    }
  
    const sql = `
      INSERT INTO season_payments 
      (student_id, season_type, start_month, end_month, amount, paid_at, note)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
  
    dbAcademy.query(sql, [student_id, season_type, start_month, end_month, amount, paid_at, note], (err, result) => {
      if (err) {
        console.error('❌ 시즌비 등록 실패:', err);
        return res.status(500).json({ message: 'DB 오류' });
      }
      res.json({ message: '✅ 시즌비 등록 완료', season_payment_id: result.insertId });
    });
  });
  //시즌비 불러오기
  router.get('/season-payments/:student_id', (req, res) => {
    const student_id = req.params.student_id;
  
    const sql = `
      SELECT * FROM season_payments 
      WHERE student_id = ? 
      ORDER BY start_month DESC
    `;
  
    dbAcademy.query(sql, [student_id], (err, rows) => {
      if (err) {
        console.error('❌ 시즌비 내역 조회 실패:', err);
        return res.status(500).json({ message: 'DB 오류' });
      }
      res.json(rows);
    });
  });
//학생들 대시보드
  router.get('/student-summary', async (req, res) => {
    const sql = `SELECT * FROM students`;
  
    dbAcademy.query(sql, async (err, students) => {
      if (err) return res.status(500).json({ message: 'DB 오류' });
  
      const summary = {
        total: students.length,
        grade: { '1': 0, '2': 0, '3': 0, 'N': 0 },
        gender: { '남': 0, '여': 0 },
        lesson_type: { '수시': 0, '정시': 0 }
      };
  
      for (const s of students) {
        summary.grade[s.grade] += 1;
        summary.gender[s.gender] += 1;
        if (s.lesson_type) summary.lesson_type[s.lesson_type] += 1;
      }
  
      res.json({ students, summary });
    });
  });

  router.post('/register-student', (req, res) => {
    const {
        name, grade, gender, school, phone, parent_phone,
        tshirt_size, register_source, first_registered_at,
        lesson_type, status, payment_day, weekdays  // ✅ 요일 추가
      } = req.body;
      
      if (!name || !grade || !gender || !first_registered_at) {
        return res.status(400).json({ message: '❗ 필수 항목 누락' });
      }
      
      const sql = `
        INSERT INTO students
        (name, grade, gender, school, phone, parent_phone, tshirt_size, register_source, first_registered_at, lesson_type, status, payment_day, weekdays)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const values = [name, grade, gender, school, phone, parent_phone, tshirt_size, register_source, first_registered_at, lesson_type, status, payment_day, weekdays];
      
  
    dbAcademy.query(sql, values, (err, result) => {
      if (err) {
        console.error('❌ 수강생 등록 실패:', err);
        return res.status(500).json({ message: 'DB 오류' });
      }
      res.json({ message: '✅ 수강생 등록 완료', student_id: result.insertId });
    });
  });
  
  router.get('/payment-today', (req, res) => {
    const today = new Date().getDate(); // 오늘 날짜 (1~31)
  
    const sql = `
      SELECT id, name, phone, payment_day, status 
      FROM students
      WHERE payment_day = ? AND status = '재원'
    `;
  
    dbAcademy.query(sql, [today], (err, rows) => {
      if (err) {
        console.error('❌ 오늘 결제 대상 조회 실패:', err);
        return res.status(500).json({ message: 'DB 오류' });
      }
      res.json(rows);
    });
  });
  
  router.get('/payment-list', (req, res) => {
    const { month } = req.query;
  
    const sql = `
      SELECT 
        s.id AS student_id,
        s.name, s.grade, s.school, s.gender, s.first_registered_at,
        COALESCE(m.status, s.status) AS status,
        COALESCE(m.weekdays, s.weekdays) AS weekdays,
        COALESCE(m.lesson_type, s.lesson_type) AS lesson_type,
        p.amount, p.paid_at
      FROM students s
      LEFT JOIN student_monthly m
        ON s.id = m.student_id AND m.month = ?
      LEFT JOIN payments p
        ON s.id = p.student_id AND p.month = ?
      ORDER BY s.grade, s.name
    `;
  
    dbAcademy.query(sql, [month, month], (err, rows) => {
      if (err) {
        console.error('❌ 결제 목록 조회 실패:', err);
        return res.status(500).json({ message: 'DB 오류' });
      }
  
      res.json(rows);
    });
  });
  

  router.post('/save-payment', (req, res) => {
    const {
      student_id,
      month,
      session_count,
      amount,
      is_manual,
      paid_at,
      payment_method   // ✅ '카드' 또는 '계좌'
    } = req.body;
  
    if (!student_id || !month || !session_count || !amount || !paid_at || !payment_method) {
      return res.status(400).json({ message: '❗ 필수 항목 누락' });
    }
  
    const sql = `
      INSERT INTO payments 
      (student_id, month, weekdays, session_count, amount, is_manual, status, paid_at, payment_method)
      VALUES (?, ?, '', ?, ?, ?, '정상', ?, ?)
      ON DUPLICATE KEY UPDATE 
        session_count = VALUES(session_count),
        amount = VALUES(amount),
        is_manual = VALUES(is_manual),
        paid_at = VALUES(paid_at),
        payment_method = VALUES(payment_method),
        status = '정상'
    `;
  
    const values = [student_id, month, session_count, amount, is_manual, paid_at, payment_method];
  
    dbAcademy.query(sql, values, (err, result) => {
      if (err) {
        console.error('❌ 결제 저장 실패:', err);
        return res.status(500).json({ message: 'DB 오류' });
      }
      res.json({ message: '✅ 결제 저장 완료' });
    });
  });
  
  
// ✅ 수강생 수정 API
router.patch('/update-student/:id', (req, res) => {
    const { id } = req.params;
    const {
      name, grade, gender, school, phone, parent_phone,
      tshirt_size, register_source, first_registered_at,
      lesson_type, status, payment_day, weekdays  // ✅ 요일 추가
    } = req.body;
    
    const sql = `
      UPDATE students SET
        name = ?, grade = ?, gender = ?, school = ?, phone = ?, parent_phone = ?,
        tshirt_size = ?, register_source = ?, first_registered_at = ?,
        lesson_type = ?, status = ?, payment_day = ?, weekdays = ?
      WHERE id = ?
    `;
    
    const values = [name, grade, gender, school, phone, parent_phone, tshirt_size, register_source, first_registered_at, lesson_type, status, payment_day, weekdays, id];
    
  
    dbAcademy.query(sql, values, (err, result) => {
      if (err) {
        console.error('❌ 수강생 수정 실패:', err);
        return res.status(500).json({ message: 'DB 오류' });
      }
      res.json({ message: '✅ 수강생 수정 완료' });
    });
  });
  router.get('/payment-status-summary', (req, res) => {
    const { month } = req.query;
    if (!month) return res.status(400).json({ message: 'month 쿼리 필요' });
  
    const query = `
      SELECT 
        s.id AS student_id,
        s.name, s.school, s.grade, s.phone,
        s.first_registered_at,
        COALESCE(m.status, s.status) AS status,
        COALESCE(m.weekdays, s.weekdays) AS weekdays,
        p.amount, p.paid_at, p.payment_method
      FROM students s
      LEFT JOIN student_monthly m
        ON s.id = m.student_id AND m.month = ?
      LEFT JOIN payments p
        ON s.id = p.student_id AND p.month = ?
      WHERE s.first_registered_at <= ?
      ORDER BY s.grade, s.name
    `;
  
    dbAcademy.query(query, [month, month, `${month}-31`], (err, rows) => {
      if (err) {
        console.error('❌ 결제 요약 조회 실패:', err);
        return res.status(500).json({ message: 'DB 오류' });
      }
  
      const filtered = rows.filter(row => row.status !== '휴식' && row.status !== '퇴원');
  
      let paid = 0;
      let unpaid = 0;
      let total = 0;
      let card = 0;
      let account = 0;
      let expected_total = 0;
      const unpaidList = [];
  
      const weekdayMap = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };
      const countSessionsInMonth = (monthStr, weekdaysStr) => {
        if (!monthStr || !weekdaysStr) return 0;
        const daysInMonth = new Date(monthStr.split('-')[0], monthStr.split('-')[1], 0).getDate();
        const targetDays = weekdaysStr.split('').map(d => weekdayMap[d]);
        let count = 0;
        for (let i = 1; i <= daysInMonth; i++) {
          const date = new Date(`${monthStr}-${String(i).padStart(2, '0')}`);
          if (targetDays.includes(date.getDay())) count++;
        }
        return count;
      };
  
      for (const row of filtered) {
        total++;
  
        const weekCount = row.weekdays ? row.weekdays.length : 0;
        const sessionCount = countSessionsInMonth(month, row.weekdays);
        let expected = 0;
        if (weekCount >= 5) expected = 550000;
        else if (weekCount === 4) expected = 500000;
        else if (weekCount === 3) expected = 400000;
        else if (weekCount === 2) expected = 300000;
        else if (weekCount === 1) expected = 150000;
  
        expected_total += expected;
  
        if (row.paid_at) {
          paid++;
          if (row.payment_method === '카드') card += row.amount;
          else if (row.payment_method === '계좌') account += row.amount;
        } else {
          unpaid++;
          unpaidList.push({
            name: row.name,
            school: row.school,
            grade: row.grade,
            phone: row.phone,
            expected_amount: expected
          });
        }
      }
  
      res.json({
        total,
        paid,
        unpaid,
        rate: total ? ((paid / total) * 100).toFixed(1) + '%' : '-',
        card,
        account,
        total_paid: card + account,
        expected_total,
        unpaid_list: unpaidList
      });
    });
  });
  
  
  
  // ✅ 납부 수단별 합계 API
  router.get('/payment-summary-by-method', (req, res) => {
    const { month } = req.query;
    if (!month) return res.status(400).json({ message: 'month 쿼리 필요' });
  
    const sql = `
      SELECT payment_method, SUM(amount) AS total
      FROM payments
      WHERE month = ? AND paid_at IS NOT NULL
      GROUP BY payment_method
    `;
  
    dbAcademy.query(sql, [month], (err, rows) => {
      if (err) {
        console.error('❌ 정산 요약 실패:', err);
        return res.status(500).json({ message: 'DB 오류' });
      }
  
      const result = { 카드: 0, 계좌: 0 };
      for (const r of rows) {
        if (r.payment_method === '카드') result.카드 = r.total;
        else if (r.payment_method === '계좌') result.계좌 = r.total;
      }
  
      res.json(result);
    });
  });
  
  
  // ilsanmaxsys.js
router.post('/set-student-monthly', (req, res) => {
    const { student_id, month, status, lesson_type, weekdays } = req.body;
  
    if (!student_id || !month) {
      return res.status(400).json({ message: '❗ student_id, month는 필수' });
    }
  
    const sql = `
      INSERT INTO student_monthly (student_id, month, status, lesson_type, weekdays)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        status = VALUES(status),
        lesson_type = VALUES(lesson_type),
        weekdays = VALUES(weekdays)
    `;
  
    const values = [student_id, month, status || null, lesson_type || null, weekdays || null];
  
    dbAcademy.query(sql, values, (err, result) => {
      if (err) {
        console.error('❌ 월별 상태 저장 실패:', err);
        return res.status(500).json({ message: 'DB 오류' });
      }
      res.json({ message: '✅ 월별 상태 저장 완료' });
    });
  });
  
  router.get('/get-student-monthly', (req, res) => {
    const { month } = req.query;
    if (!month) return res.status(400).json({ message: '❗ month 누락' });
  
    const sql = `
      SELECT s.id AS student_id, s.name, s.grade, s.school, s.gender,
             COALESCE(m.status, s.status) AS status,
             COALESCE(m.lesson_type, s.lesson_type) AS lesson_type,
             COALESCE(m.weekdays, s.weekdays) AS weekdays
      FROM students s
      LEFT JOIN student_monthly m
        ON s.id = m.student_id AND m.month = ?
    `;
  
    dbAcademy.query(sql, [month], (err, rows) => {
      if (err) {
        console.error('❌ 월별 상태 조회 실패:', err);
        return res.status(500).json({ message: 'DB 오류' });
      }
      res.json(rows);
    });
  });
  
    

module.exports = router;
