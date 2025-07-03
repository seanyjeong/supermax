const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');

const { dbAcademy } = require('./college');

console.log("✅ ilsanmaxsys 라우터 적용됨!");


// 카카오/네이버 알림톡 세팅값
const plusFriendId = '@일산맥스체대입시';
const templateCode = 'A06';
const accessKey = 'A8zINaiL6JjWUNbT1uDB';
const secretKey = 'eA958IeOvpxWQI1vYYA9GcXSeVFQYMEv4gCtEorW';
const serviceId = 'ncp:kkobizmsg:kr:2842405:sean';

router.post('/send-alimtalk', async (req, res) => {
  const users = req.body; // [{name, phone, date}]
  if (!Array.isArray(users) || !users.length) return res.status(400).json({ message: "명단 없음" });

  const timestamp = Date.now().toString();
  const uri = `/alimtalk/v2/services/${serviceId}/messages`;
  const method = 'POST';
  const hmac = method + ' ' + uri + '\n' + timestamp + '\n' + accessKey;
  const signature = crypto.createHmac('sha256', secretKey).update(hmac).digest('base64');

  const messages = users.map(u => ({
    to: u.phone.replace(/[^0-9]/g, ''),
    content: `수강료 안내\n${u.name} 학생의 수강료 납부일이, ${u.date} 일입니다\n계좌 하나은행 432-890083-82807 정으뜸`
  }));

  const body = {
    plusFriendId,
    templateCode,
    messages
  };

  try {
    const response = await axios.post(
      `https://sens.apigw.ntruss.com${uri}`,
      body,
      {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'x-ncp-apigw-timestamp': timestamp,
          'x-ncp-iam-access-key': accessKey,
          'x-ncp-apigw-signature-v2': signature
        }
      }
    );
    res.json({ message: `총 ${messages.length}건 발송 완료!`, response: response.data });
  } catch (e) {
    res.status(500).json({ message: '발송 실패', error: e.response?.data || e.message });
  }
});

// ✅ 수강생 전체 조회 API
router.get('/students', (req, res) => {
  const sql = `
    SELECT s.*, i.name AS instructor_name
    FROM students s
    LEFT JOIN instructors i ON s.instructor_id = i.id
    ORDER BY s.name ASC
  `;
  dbAcademy.query(sql, (err, rows) => {
    if (err) {
      console.error('❌ 수강생 조회 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json(rows);
  });
});


router.post('/save-expected-amount', (req, res) => {
    console.log('✅ [save-expected-amount] POST 호출됨', req.body); 
  const { student_id, month, expected_amount } = req.body;
  const sql = `
    INSERT INTO payments (student_id, month, applied_month, expected_amount)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE expected_amount = VALUES(expected_amount)
  `;
  dbAcademy.query(sql, [student_id, month, month, expected_amount], (err, result) => {
    if (err) return res.status(500).json({ message: 'DB 오류' });
    res.json({ message: '예정금액 저장 완료' });
  });
});


// ✅ 개별 학생 상세 조회 API (추가 권장)
router.get('/students/:id', (req, res) => {
  const { id } = req.params;
  
  // 학생 기본 정보 조회
  dbAcademy.query('SELECT * FROM students WHERE id = ?', [id], (err, studentRows) => {
    if (err || studentRows.length === 0) {
      return res.status(404).json({ message: '학생을 찾을 수 없습니다' });
    }
    
    const student = studentRows[0];
    
    // 결제 내역 조회 (선택적)
    dbAcademy.query(
      'SELECT * FROM payments WHERE student_id = ? ORDER BY month DESC LIMIT 5', 
      [id], 
      (err, paymentRows) => {
        if (err) {
          console.error('결제 내역 조회 오류:', err);
          return res.json({ ...student, payments: [] });
        }
        
        res.json({ ...student, payments: paymentRows });
      }
    );
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
      s.payment_day,
      p.amount, p.paid_at, p.payment_method,
      p.expected_amount      -- ⭐️ 이 줄만 추가!
    FROM students s
    LEFT JOIN student_monthly m ON s.id = m.student_id AND m.month = ?
    LEFT JOIN payments p ON s.id = p.student_id AND p.applied_month = ?
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
    applied_month,
    session_count,
    amount,
    is_manual,
    paid_at,
    payment_method,
    expected_amount // ⭐️ 추가!
  } = req.body;

  const sql = `
    INSERT INTO payments 
    (student_id, month, applied_month, weekdays, session_count, amount, is_manual, status, paid_at, payment_method, expected_amount)
    VALUES (?, ?, ?, '', ?, ?, ?, '정상', ?, ?, ?)
    ON DUPLICATE KEY UPDATE 
      session_count = VALUES(session_count),
      amount = VALUES(amount),
      is_manual = VALUES(is_manual),
      paid_at = VALUES(paid_at),
      payment_method = VALUES(payment_method),
      applied_month = VALUES(applied_month),
      expected_amount = VALUES(expected_amount), -- ⭐️ 이 줄도 추가!
      status = '정상'
  `;

  const values = [
    student_id, month, applied_month, session_count, amount,
    is_manual, paid_at, payment_method,
    expected_amount ?? null // 값이 없으면 null로!
  ];

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
  const month = req.query.month;
  if (!month) return res.status(400).json({ message: 'month 파라미터 누락' });

  const sql = `
    SELECT 
      s.id AS student_id,
      s.name, s.grade, s.gender, s.phone, s.school,
      COALESCE(m.status, s.status) AS status,
      COALESCE(m.weekdays, s.weekdays) AS weekdays,
      COALESCE(m.lesson_type, s.lesson_type) AS lesson_type,
      p.amount, p.paid_at,
      s.first_registered_at
    FROM students s
    LEFT JOIN student_monthly m ON s.id = m.student_id AND m.month = ?
    LEFT JOIN payments p ON s.id = p.student_id AND p.month = ?
    WHERE DATE_FORMAT(s.first_registered_at, '%Y-%m') <= ?
  `;

  dbAcademy.query(sql, [month, month, month], (err, rows) => {
    if (err) {
      console.error('❌ 결제 상태 요약 실패:', err);
      return res.status(500).json({ message: 'DB 오류', error: err });
    }

    const enriched = rows.map(r => {
      const weeklyCount = r.weekdays ? r.weekdays.replace(/,/g, '').length : 0;
      const expected_amount =
        weeklyCount >= 5 ? 550000 :
        weeklyCount === 4 ? 500000 :
        weeklyCount === 3 ? 400000 :
        weeklyCount === 2 ? 300000 :
        weeklyCount === 1 ? 150000 : 0;

      return {
        ...r,
        expected_amount,
        status: r.paid_at ? '납부완료' : (r.status === '재원' ? '미납' : r.status)
      };
    });

    res.json(enriched);
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

  // ✅ 다개월 선납 결제 등록 API
router.post('/register-multi-payment', (req, res) => {
  const {
    student_id,
    start_month,
    month_count,
    total_amount,
    paid_at,
    payment_method,
    session_count,
    note
  } = req.body;

  console.log('✅ [register-multi-payment] 호출됨');
  console.log('💬 요청 데이터:', req.body);

  // 필수 항목 검사
  if (!student_id || !start_month || !month_count || !total_amount || !paid_at || !payment_method) {
    console.log('❌ 필수 항목 누락');
    return res.status(400).json({ message: '❗ 필수 항목 누락' });
  }

  const unit_amount = Math.floor(total_amount / month_count);
  const valuesList = [];

  try {
    for (let i = 0; i < month_count; i++) {
      const baseDate = new Date(`${start_month}-01`);
      baseDate.setMonth(baseDate.getMonth() + i);
      const applied_month = baseDate.toISOString().slice(0, 7);

      console.log(`➡️ ${i + 1}번째 적용월: ${applied_month}`);

      valuesList.push([
        student_id,
        start_month,
        applied_month,
        session_count || 12,
        unit_amount,
        1,
        '정상',
        paid_at,
        payment_method,
        note || ''
      ]);
    }

    // 👉 예시 insert 코드 (너 실제 insert 구문으로 대체해)
    const sql = `
      INSERT INTO payments
      (student_id, month, applied_month, session_count, amount, is_manual, status, paid_at, payment_method, note)
      VALUES ?
    `;
    console.log('🛠 INSERT 실행 준비 완료');
    dbAcademy.query(sql, [valuesList], (err, result) => {
      if (err) {
        console.error('❌ DB 오류:', err);
        return res.status(500).json({ message: 'DB 오류', error: err });
      }
      console.log('✅ DB 저장 완료:', result);
      res.json({ message: '납부 등록 성공', inserted: result.affectedRows });
    });

  } catch (e) {
    console.error('❌ 처리 중 에러:', e);
    res.status(500).json({ message: '서버 오류', error: e });
  }
});

// ✅ 전체 매출, 월별 매출, 총 등록자 수, 휴식자 수 포함
router.get('/dashboardsummary', async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ message: 'month 쿼리 파라미터가 필요합니다 (YYYY-MM)' });

  try {
    // ✅ 총 매출
    const [totalRevenueRows] = await dbQuery(`SELECT SUM(amount) AS total FROM payments WHERE paid_at IS NOT NULL`);

    // ✅ 월별 매출
    const monthlyRevenueRows = await dbQuery(`
      SELECT DATE_FORMAT(paid_at, '%Y-%m') AS month, SUM(amount) AS total
      FROM payments
      WHERE paid_at IS NOT NULL
      GROUP BY DATE_FORMAT(paid_at, '%Y-%m')
      ORDER BY month DESC
    `);

    // ✅ 전체 학생 통계
    const [studentCounts] = await dbQuery(`
SELECT 
  COUNT(*) AS total_students,
  SUM(status = '재원') AS active_students,
  SUM(status = '휴식') AS resting_students,
  SUM(status = '퇴원') AS withdrawn_students
FROM students
WHERE status != '퇴원'
    `);

    // ✅ 이번 달 기준 재원자/휴식자 계산 (student_monthly 우선, 없으면 students 참고)
    const monthlyStats = await dbQuery(`
      SELECT 
        sm.student_id,
        sm.status AS monthly_status,
        s.name, s.school, s.grade, s.gender, s.tshirt_size,
        COALESCE(sm.status, s.status) AS final_status,
        COALESCE(sm.lesson_type, s.lesson_type) AS final_lesson_type
      FROM students s
      LEFT JOIN student_monthly sm
        ON s.id = sm.student_id AND sm.month = ?
      WHERE s.status IN ('재원', '휴식')
    `, [month]);

    const studentList = monthlyStats.map(row => ({
      name: row.name,
      school: row.school,
      grade: row.grade,
      gender: row.gender,
      status: row.final_status,
      tshirt_size: row.tshirt_size,
      lesson_type: row.final_lesson_type 
    }));

    // ✅ 해당 월 매출
    const selectedMonthRevenue = monthlyRevenueRows.find(r => r.month === month)?.total || 0;

    const registered = studentList.length;
    const resting = studentList.filter(s => s.status === '휴식').length;

    res.json({
      totalRevenue: totalRevenueRows.total || 0,
      monthlyRevenue: monthlyRevenueRows,
      studentStats: studentCounts,
      selectedMonthStats: {
        month,
        revenue: selectedMonthRevenue,
        registered,
        resting
      },
      studentList
    });

  } catch (err) {
    console.error('❌ 대시보드 요약 통계 실패:', err);
    res.status(500).json({ message: 'DB 오류', error: err });
  }
});

router.post('/mock-score', (req, res) => {
  const {
    student_id, exam_month,
    korean_subject, korean_percentile, korean_standard_score, korean_grade,
    math_subject, math_percentile, math_standard_score, math_grade,
    english_grade, history_grade,
    inquiry1_subject, inquiry1_percentile, inquiry1_standard_score, inquiry1_grade,
    inquiry2_subject, inquiry2_percentile, inquiry2_standard_score, inquiry2_grade
  } = req.body;

  if (!student_id || !exam_month || !korean_subject || !math_subject) {
    return res.status(400).json({ message: '❗ 필수 항목 누락' });
  }

  const sql = `
    INSERT INTO mock_scores (
      student_id, exam_month,
      korean_subject, korean_percentile, korean_standard_score, korean_grade,
      math_subject, math_percentile, math_standard_score, math_grade,
      english_grade, history_grade,
      inquiry1_subject, inquiry1_percentile, inquiry1_standard_score, inquiry1_grade,
      inquiry2_subject, inquiry2_percentile, inquiry2_standard_score, inquiry2_grade
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      korean_subject = VALUES(korean_subject),
      korean_percentile = VALUES(korean_percentile),
      korean_standard_score = VALUES(korean_standard_score),
      korean_grade = VALUES(korean_grade),
      math_subject = VALUES(math_subject),
      math_percentile = VALUES(math_percentile),
      math_standard_score = VALUES(math_standard_score),
      math_grade = VALUES(math_grade),
      english_grade = VALUES(english_grade),
      history_grade = VALUES(history_grade),
      inquiry1_subject = VALUES(inquiry1_subject),
      inquiry1_percentile = VALUES(inquiry1_percentile),
      inquiry1_standard_score = VALUES(inquiry1_standard_score),
      inquiry1_grade = VALUES(inquiry1_grade),
      inquiry2_subject = VALUES(inquiry2_subject),
      inquiry2_percentile = VALUES(inquiry2_percentile),
      inquiry2_standard_score = VALUES(inquiry2_standard_score),
      inquiry2_grade = VALUES(inquiry2_grade)
  `;

  const values = [
    student_id, exam_month,
    korean_subject, korean_percentile, korean_standard_score, korean_grade,
    math_subject, math_percentile, math_standard_score, math_grade,
    english_grade, history_grade,
    inquiry1_subject, inquiry1_percentile, inquiry1_standard_score, inquiry1_grade,
    inquiry2_subject, inquiry2_percentile, inquiry2_standard_score, inquiry2_grade
  ];

  dbAcademy.query(sql, values, (err, result) => {
    if (err) {
      console.error('❌ 모의고사 성적 저장 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json({ message: '✅ 모의고사 성적 저장 완료' });
  });
});

router.get('/mock-score/:student_id', (req, res) => {
  const student_id = req.params.student_id;

  const sql = `
    SELECT * FROM mock_scores 
    WHERE student_id = ? 
    ORDER BY FIELD(exam_month, '3월', '6월', '9월')
  `;

  dbAcademy.query(sql, [student_id], (err, rows) => {
    if (err) {
      console.error('❌ 모의고사 성적 조회 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json(rows);
  });
});

router.post('/record-physical', (req, res) => {
  const {
    student_id,
    record_date,
    jump_cm,
    medicine_m,
    back_power_kg,
    run10_btn_sec,
    run10_cone_sec,
    run20_btn_sec,
    run20_cone_sec,
    flexibility_cm
  } = req.body;

  const sql = `
    INSERT INTO physical_records (
      student_id, record_date,
      jump_cm, medicine_m, back_power_kg,
      run10_btn_sec, run10_cone_sec,
      run20_btn_sec, run20_cone_sec,
      flexibility_cm
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  dbAcademy.query(sql, [
    student_id, record_date,
    jump_cm, medicine_m, back_power_kg,
    run10_btn_sec, run10_cone_sec,
    run20_btn_sec, run20_cone_sec,
    flexibility_cm
  ], (err, result) => {
    if (err) {
      console.error('❌ 실기기록 입력 오류:', err);
      return res.status(500).json({ message: 'DB 오류', error: err });
    }

    res.json({ message: '✅ 실기 기록 저장 완료', id: result.insertId });
  });
});


router.get('/physical-record/:student_id', (req, res) => {
  const { student_id } = req.params;

  const sql = `
    SELECT * FROM physical_records 
    WHERE student_id = ?
    ORDER BY recorded_at DESC, event_name
  `;

  dbAcademy.query(sql, [student_id], (err, rows) => {
    if (err) {
      console.error('❌ 실기기록 조회 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json(rows);
  });
});

router.get('/physical-record/:student_id/:event_name', (req, res) => {
  const { student_id, event_name } = req.params;

  const sql = `
    SELECT recorded_at, record_value 
    FROM physical_records
    WHERE student_id = ? AND event_name = ?
    ORDER BY recorded_at ASC
  `;

  dbAcademy.query(sql, [student_id, event_name], (err, rows) => {
    if (err) {
      console.error('❌ 기록 추이 조회 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json(rows);  // 프론트에서 날짜별 그래프용으로 사용 가능
  });
});

router.delete('/physical-record/:id', (req, res) => {
  const { id } = req.params;

  const sql = `DELETE FROM physical_records WHERE id = ?`;

  dbAcademy.query(sql, [id], (err, result) => {
    if (err) {
      console.error('❌ 실기기록 삭제 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json({ message: '✅ 실기기록 삭제 완료' });
  });
});

router.get('/student-full-summary', async (req, res) => {
  try {
    // 1. 전체 학생 조회
    const students = await dbQuery(`SELECT * FROM students ORDER BY grade, name`);

    const results = [];

    for (const student of students) {
      const student_id = student.id;

      // 2. 최신 모의고사 성적 1개 (가장 최근 시험)
      const [latestScore] = await dbQuery(`
        SELECT * FROM mock_scores 
        WHERE student_id = ?
        ORDER BY FIELD(exam_month, '9월', '6월', '3월') LIMIT 1
      `, [student_id]);

      // 3. 실기 종목별 최신 기록
      const physicalRecords = await dbQuery(`
        SELECT event_name, record_value, recorded_at 
        FROM physical_records
        WHERE student_id = ?
        ORDER BY event_name, recorded_at DESC
      `, [student_id]);

      // 종목별로 최신 기록만 추리기
      const latestPhysicalMap = {};
      for (const record of physicalRecords) {
        const e = record.event_name;
        if (!latestPhysicalMap[e]) latestPhysicalMap[e] = record;
      }

      results.push({
        ...student,
        latest_mock_score: latestScore || null,
        latest_physical: latestPhysicalMap
      });
    }

    res.json(results);
  } catch (err) {
    console.error('❌ 학생 전체 성적 및 기록 조회 실패:', err);
    res.status(500).json({ message: 'DB 오류', error: err });
  }
});

router.post('/mental-check', (req, res) => {
  const {
    student_id, submitted_at,
    sleep_hours, stress_level, motivation_level,
    condition_level, pain_level, focus_level, study_level,
    note
  } = req.body;

  if (!student_id || !submitted_at) {
    return res.status(400).json({ message: '❗ student_id, submitted_at 필수' });
  }

  const sql = `
    INSERT INTO mental_check (
      student_id, submitted_at,
      sleep_hours, stress_level, motivation_level,
      condition_level, pain_level, focus_level, study_level,
      note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    student_id, submitted_at,
    sleep_hours, stress_level, motivation_level,
    condition_level, pain_level, focus_level, study_level,
    note
  ];

  dbAcademy.query(sql, values, (err, result) => {
    if (err) {
      console.error('❌ 멘탈 평가 등록 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }

    // ✅ 슬럼프 감지 (간단한 기준 예시)
    const alertNeeded =
      (stress_level >= 4 && motivation_level <= 2) ||
      (condition_level <= 2 && pain_level >= 3);

    res.json({
      message: '✅ 멘탈 평가 저장 완료',
      slump_alert: alertNeeded ? '⚠️ 상담 필요' : '정상',
      record_id: result.insertId
    });
  });
});

router.get('/mental-check/:student_id', (req, res) => {
  const { student_id } = req.params;

  const sql = `
    SELECT * FROM mental_check
    WHERE student_id = ?
    ORDER BY submitted_at DESC
  `;

  dbAcademy.query(sql, [student_id], (err, rows) => {
    if (err) {
      console.error('❌ 멘탈 이력 조회 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json(rows);
  });
});

router.patch('/assign-instructor/:student_id', (req, res) => {
  const { student_id } = req.params;
  const { instructor_id } = req.body;

  if (!instructor_id) {
    return res.status(400).json({ message: '❗ instructor_id 누락' });
  }

  const sql = `UPDATE students SET instructor_id = ? WHERE id = ?`;

  dbAcademy.query(sql, [instructor_id, student_id], (err, result) => {
    if (err) {
      console.error('❌ 강사 지정 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }

    res.json({ message: '✅ 강사 배정 완료', affectedRows: result.affectedRows });
  });
});

router.get('/students-with-instructor', (req, res) => {
  const sql = `
    SELECT 
      s.id AS student_id, s.name AS student_name, s.grade, s.gender, s.school,
      i.id AS instructor_id, i.name AS instructor_name
    FROM students s
    LEFT JOIN instructors i ON s.instructor_id = i.id
    ORDER BY i.name, s.name
  `;

  dbAcademy.query(sql, (err, rows) => {
    if (err) {
      console.error('❌ 학생 + 강사 조회 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json(rows);
  });
});

router.post('/register-instructor', (req, res) => {
  const { name, birth_year, position, gender, phone } = req.body;

  if (!name) return res.status(400).json({ message: '강사 이름은 필수입니다.' });

  const sql = `
    INSERT INTO instructors (name, birth_year, position, gender, phone)
    VALUES (?, ?, ?, ?, ?)
  `;

  dbAcademy.query(sql, [name, birth_year, position, gender, phone], (err, result) => {
    if (err) return res.status(500).json({ message: 'DB 오류', error: err });
    res.json({ message: '✅ 강사 등록 완료', id: result.insertId });
  });
});

router.get('/instructors', (req, res) => {
  const sql = `SELECT * FROM instructors ORDER BY name`;

  dbAcademy.query(sql, (err, rows) => {
    if (err) return res.status(500).json({ message: 'DB 오류', error: err });
    res.json(rows);
  });
});

// ✅ 실기 기록 입력 API
router.post('/submit-record', (req, res) => {
  const {
    student_id,
    record_date,
    standing_long_jump,
    medicine_ball_throw,
    back_strength,
    shuttle_10m_button,
    shuttle_10m_cone,
    shuttle_20m_button,
    shuttle_20m_cone,
    sit_and_reach
  } = req.body;

  if (!student_id || !record_date) {
    return res.status(400).json({ message: '❗ 필수 항목 누락' });
  }

  const sql = `
    INSERT INTO physical_records (
      student_id, record_date,
      standing_long_jump, medicine_ball_throw, back_strength,
      shuttle_10m_button, shuttle_10m_cone,
      shuttle_20m_button, shuttle_20m_cone,
      sit_and_reach
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  dbAcademy.query(sql, [
    student_id, record_date,
    standing_long_jump || null, medicine_ball_throw || null, back_strength || null,
    shuttle_10m_button || null, shuttle_10m_cone || null,
    shuttle_20m_button || null, shuttle_20m_cone || null,
    sit_and_reach || null
  ], (err, result) => {
    if (err) {
      console.error('❌ 기록 저장 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json({ message: '✅ 기록 저장 완료', record_id: result.insertId });
  });
});






// 유틸성 DB Promise
function dbQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    dbAcademy.query(sql, params, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
}


  
  
    

module.exports = router;
