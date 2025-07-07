const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const schedule = require('node-schedule');


const { dbAcademy } = require('./college');
const { OpenAI } = require('openai');
require('dotenv').config();  // 👈 최상단에 유지!


const { Client: NotionClient } = require('@notionhq/client');

// ✅ OpenAI 초기화 (v4 방식)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ✅ Notion 클라이언트 초기화
const notion = new NotionClient({ auth: process.env.NOTION_API_KEY });
console.log(process.env.NOTION_API_KEY)
console.log(process.env.NOTION_DATABASE_ID)


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


// ✅ 개별 학생 상세 조회 API (강사 이름 포함 버전)
router.get('/students/:id', (req, res) => {
  const { id } = req.params;

  const sql = `
    SELECT s.*, i.name AS instructor_name
    FROM students s
    LEFT JOIN instructors i ON s.instructor_id = i.id
    WHERE s.id = ?
  `;

  dbAcademy.query(sql, [id], (err, studentRows) => {
    if (err || studentRows.length === 0) {
      return res.status(404).json({ message: '학생을 찾을 수 없습니다' });
    }

    const student = studentRows[0];

    // 결제 내역도 같이 가져오기
    dbAcademy.query(
      'SELECT * FROM payments WHERE student_id = ? ORDER BY month DESC LIMIT 5',
      [id],
      (err2, paymentRows) => {
        if (err2) {
          console.error('결제 내역 조회 오류:', err2);
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

// ✅ POST /college/submit-mock-exam
router.post('/submit-mock-exam', (req, res) => {
  const {
    student_id, exam_month,
    korean_subject, korean_percentile, korean_standard_score, korean_grade,
    math_subject, math_percentile, math_standard_score, math_grade,
    english_grade, history_grade,
    inquiry1_subject, inquiry1_percentile, inquiry1_standard_score, inquiry1_grade,
    inquiry2_subject, inquiry2_percentile, inquiry2_standard_score, inquiry2_grade
  } = req.body;

  // 빈 문자열이면 null로 처리
  function clean(value) {
    return value === '' ? null : value;
  }

  const sql = `
    INSERT INTO mock_scores (
      student_id, exam_month,
      korean_subject, korean_percentile, korean_standard_score, korean_grade,
      math_subject, math_percentile, math_standard_score, math_grade,
      english_grade, history_grade,
      inquiry1_subject, inquiry1_percentile, inquiry1_standard_score, inquiry1_grade,
      inquiry2_subject, inquiry2_percentile, inquiry2_standard_score, inquiry2_grade
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    clean(student_id), clean(exam_month),
    clean(korean_subject), clean(korean_percentile), clean(korean_standard_score), clean(korean_grade),
    clean(math_subject), clean(math_percentile), clean(math_standard_score), clean(math_grade),
    clean(english_grade), clean(history_grade),
    clean(inquiry1_subject), clean(inquiry1_percentile), clean(inquiry1_standard_score), clean(inquiry1_grade),
    clean(inquiry2_subject), clean(inquiry2_percentile), clean(inquiry2_standard_score), clean(inquiry2_grade)
  ];

  dbAcademy.query(sql, values, (err, result) => {
    if (err) {
      console.error('❌ 성적 입력 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json({ message: '✅ 성적 저장 완료' });
  });
});

// ✅ GET /college/mock-score/:student_id (테이블명 수정)
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

// 멘탈 체크 등록
// 멘탈 체크 등록 (수정 완료)
router.post('/mental-check', (req, res) => {
  const {
    student_id, student_name, sleep_hours = 0, stress_level = 3, motivation_level = 3,
    condition_level = 3, pain_level = 3, focus_level = 3, study_level = 3, note = ''
  } = req.body;

  // 중복 제출 방지
  const checkSql = `
    SELECT id FROM mental_check WHERE student_id = ? AND submitted_at = CURDATE()
  `;
  dbAcademy.query(checkSql, [student_id], (err, existing) => {
    if (err) {
      console.error('❌ 중복 제출 확인 오류:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }

    if (existing.length > 0) {
      return res.status(400).json({ message: '이미 오늘 체크를 완료했습니다.' });
    }

    // DB 저장
    const insertSql = `
      INSERT INTO mental_check (
        student_id, sleep_hours, stress_level, motivation_level,
        condition_level, pain_level, focus_level, study_level, note, submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE())
    `;
    const values = [
      student_id, sleep_hours, stress_level, motivation_level,
      condition_level, pain_level, focus_level, study_level, note
    ];

    dbAcademy.query(insertSql, values, async (err2, result) => {
      if (err2) {
        console.error('❌ 멘탈 체크 저장 오류:', err2);
        return res.status(500).json({ message: 'DB 오류' });
      }

      // 총점 계산
      const score =
        (parseFloat(sleep_hours) || 0) +
        (parseFloat(motivation_level) || 0) +
        (parseFloat(condition_level) || 0) +
        (parseFloat(focus_level) || 0) +
        (parseFloat(study_level) || 0) -
        (parseFloat(stress_level) || 0) -
        (parseFloat(pain_level) || 0);
      const totalScore = Math.round(score * 10) / 10;

      // GPT 분석
      let gptComment = '';
      try {
        gptComment = await analyzeMentalWithGPT({
          student_name, sleep_hours, stress_level, motivation_level,
          condition_level, pain_level, focus_level, study_level, note
        });

        // Notion 연동
        await sendToNotion({
          student_name, sleep_hours, stress_level, motivation_level,
          condition_level, pain_level, focus_level, study_level, note
        }, gptComment, totalScore);

      } catch (e) {
        console.error('GPT/Notion 오류:', e);
      }

      // 알림톡은 주석처리 생략

      res.json({ success: true, comment: gptComment });
    });
  });
});




router.get('/mental-check/:student_id', (req, res) => {
  const { student_id } = req.params;

  const sql = `
    SELECT * FROM mental_check
    WHERE student_id = ?
    ORDER BY created_at DESC
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

router.post('/submit-record', (req, res) => {
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  dbAcademy.query(sql, [
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
  ], async (err, result) => {
    if (err) {
      console.error('❌ 기록 저장 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }

    const recorded_at = record_date;
    const map = {
      '제자리멀리뛰기': jump_cm,
      '메디신볼던지기': medicine_m,
      '배근력': back_power_kg,
      '10m왕복(버튼)': run10_btn_sec,
      '10m왕복(콘)': run10_cone_sec,
      '20m왕복(버튼)': run20_btn_sec,
      '20m왕복(콘)': run20_cone_sec,
      '좌전굴': flexibility_cm
    };

    const inserts = [];

    for (const [event_name, value] of Object.entries(map)) {
      if (value !== undefined && value !== null && value !== '' && !isNaN(value)) {
        try {
          await new Promise((resolve, reject) => {
            dbAcademy.query(
              `DELETE FROM physical_records WHERE student_id = ? AND event_name = ? AND recorded_at = ?`,
              [student_id, event_name, recorded_at],
              (err) => (err ? reject(err) : resolve())
            );
          });

          inserts.push([student_id, event_name, parseFloat(value), recorded_at, recorded_at]);
        } catch (e) {
          console.error(`❌ DELETE 실패 (${event_name}):`, e);
          return res.status(500).json({ message: `DELETE 실패 (${event_name})` });
        }
      }
    }

    if (inserts.length === 0) {
      return res.json({ message: '✅ 기록 저장 완료 (차트용 없음)' });
    }

    const insertSql = `
      INSERT INTO physical_records 
      (student_id, event_name, record_value, recorded_at, record_date)
      VALUES ?
    `;

    dbAcademy.query(insertSql, [inserts], (err2) => {
      if (err2) {
        console.error('❌ 기록 세부 insert 실패:', err2);
        return res.status(500).json({ message: '기록 저장 실패 (세부)', error: err2 });
      }
      res.json({ message: '✅ 기록 저장 완료' });
    });
  });
});

//멘탈관련 gpt 조언
router.post('/analyze-mental', async (req, res) => {
  const {
    sleep_hours = 0, stress_level = 3, motivation_level = 3,
    condition_level = 3, pain_level = 3, focus_level = 3, study_level = 3
  } = req.body;

  const totalScore =
    Number(sleep_hours) +
    Number(motivation_level) +
    Number(condition_level) +
    Number(focus_level) +
    Number(study_level) -
    Number(stress_level) -
    Number(pain_level);

  // 부정적 항목 체크 (하나라도 2 이하인지)
  const badCheck =
    Number(sleep_hours) <= 5 ||
    Number(motivation_level) <= 2 ||
    Number(condition_level) <= 2 ||
    Number(focus_level) <= 2 ||
    Number(study_level) <= 1;

  // 1. 학생에게 보여줄 코멘트 (따뜻한 버전)
  const studentPrompt = `
너는 체대입시 멘탈 컨설턴트야.
학생이 제출한 멘탈 체크 결과는 아래와 같아.

- 수면시간: ${sleep_hours}시간
- 스트레스 정도: ${stress_level}/5
- 대학진학 의욕: ${motivation_level}/5
- 컨디션: ${condition_level}/5
- 통증: ${pain_level}/5
- 운동 집중도: ${focus_level}/5
- 학습 집중도: ${study_level}/5

총점: ${totalScore}점

너의 역할:
1. 학생에게 따뜻하게 격려와 응원을 주고,
2. 긍정적인 점은 칭찬, 부족한 점은 용기를 주며 개선 팁을 알려줘.
3. 문장은 3~6줄로 짧고 명확하게 써줘.
`;

  // 2. 강사(노션)용 코멘트 (관리전략/위험진단 버전)
  const teacherPrompt = `
너는 체대입시 전문 코치야.
아래 학생의 멘탈 자가체크 데이터를 토대로, 강사용 상태 보고와 관리 전략을 작성해줘.

- 수면시간: ${sleep_hours}시간
- 스트레스: ${stress_level}/5
- 대학진학 의욕: ${motivation_level}/5
- 컨디션: ${condition_level}/5
- 통증: ${pain_level}/5
- 운동 집중도: ${focus_level}/5
- 학습 집중도: ${study_level}/5
- 총점: ${totalScore}점

분석 기준:
- 14점 이상: 양호
- 10~13점: 주의
- 6~9점: 위험
- 5점 이하: 매우 위험

너의 역할:
1. 객관적으로 현재 학생의 멘탈/컨디션을 진단 (최대 2줄)
2. 우려되는 점(위험/부족/문제)만 딱 2~3개 지목
3. 강사용 관리전략/코칭/면담법 등 실전 관리 팁을 제안 (최대 3줄)
4. 학생 이름이나 “너/당신” 표현 없이, 강사용 보고서 느낌으로.
`;

  try {
    // 1. 학생용 코멘트 생성
    const studentRes = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: studentPrompt }],
      temperature: 0.7
    });
    const studentComment = studentRes.choices[0].message.content.trim();

    // 2. 강사용 코멘트 생성
    const teacherRes = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: teacherPrompt }],
      temperature: 0.7
    });
    const teacherComment = teacherRes.choices[0].message.content.trim();

    // 🔗 학생 이름 가져오기 (학생 정보도 필요하므로)
    const [studentRow] = await dbQuery(`SELECT name FROM students WHERE id = ?`, [req.body.student_id]);
    if (studentRow) {
      const studentData = {
        ...req.body,
        student_name: studentRow.name
      };

      // 조건부 노션 저장
      if (totalScore <= 13 || badCheck) {
        await sendToNotion(studentData, teacherComment, totalScore); // 노션엔 teacher용만!
      }
    }

    // 학생 화면에는 studentComment만 반환!
    res.json({ comment: studentComment });

  } catch (e) {
    console.error('멘탈 GPT 분석 실패:', e);
    res.status(500).json({ message: 'GPT 분석 실패' });
  }
});




// 📌 Notion 연동 함수
async function sendToNotion(data, gptComment, totalScore) {
  try {
    await notion.pages.create({
      parent: { database_id: process.env.NOTION_DATABASE_ID },
      properties: {
        이름: {
          title: [{ text: { content: data.student_name } }]
        },
        총점: {
          number: totalScore
        },
        수면: {
          number: parseFloat(data.sleep_hours)
        },
        스트레스: {
          number: parseFloat(data.stress_level)
        },
        대학진학의욕: {
          number: parseFloat(data.motivation_level)
        },
        컨디션: {
          number: parseFloat(data.condition_level)
        },
        부상정도: {
          number: parseFloat(data.pain_level)
        },
        운동집중도: {
          number: parseFloat(data.focus_level)
        },
        학습집중도: {
          number: parseFloat(data.study_level)
        },
        제출일: {
          date: {
            start: new Date().toISOString().split('T')[0]
          }
        },
        AI분석: { // ✅ 여기에 분석 결과 저장
          rich_text: [{
            type: 'text',
            text: { content: gptComment }
          }]
        }
      },
      children: [  // ✅ 본문 블럭으로도 저장 (선택사항)
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{
              type: 'text',
              text: { content: gptComment }
            }]
          }
        }
      ]
    });
    console.log(`✅ Notion에 멘탈 체크 전송 완료`);
  } catch (e) {
    console.error('❌ Notion 전송 실패:', e.message);
  }
}


// 🎯 실기기록 + GPT 코멘트 API
router.post('/analyze-comment', async (req, res) => {
  const { student_id } = req.body;
  if (!student_id) return res.status(400).json({ message: 'student_id 필요' });

  // ✅ 성별 조회
  const genderRow = await dbQuery(`SELECT gender FROM students WHERE id = ?`, [student_id]);
  const gender = genderRow[0]?.gender || '남';

  // ✅ 실기 기록 불러오기
  const recordSql = `
    SELECT event_name, record_value, recorded_at
    FROM physical_records
    WHERE student_id = ?
    ORDER BY recorded_at ASC
    LIMIT 100
  `;
  const rows = await dbQuery(recordSql, [student_id]);
  if (!rows || rows.length === 0) return res.status(404).json({ message: '실기기록 없음' });

  // ✅ 기준 데이터
const referenceStats = {
  "남": {
    "제자리멀리뛰기": { avg: 260, top_avg: 280, max: 300 },
    "메디신볼던지기": { avg: 9.0, top_avg: 10.5, max: 12.5 },
    "좌전굴": { avg: 15, top_avg: 23, max: 30 },
    "배근력": { avg: 155, top_avg: 200, max: 240 },
    "10m왕복(버튼)": { avg: 9.7, top_avg: 9.5, max: 9.0 },
    "10m왕복(콘)": { avg: 9.9, top_avg: 9.6, max: 9.0 },
    "20m왕복(버튼)": { avg: 14.8, top_avg: 14.2, max: 13.4 },
    "20m왕복(콘)": { avg: 15.4, top_avg: 14.9, max: 14.5 }
  },
  "여": {
    "제자리멀리뛰기": { avg: 200, top_avg: 220, max: 245 },
    "메디신볼던지기": { avg: 6.5, top_avg: 8.5, max: 9.5 },
    "좌전굴": { avg: 20, top_avg: 27, max: 35 },
    "배근력": { avg: 110, top_avg: 135, max: 160 },
    "10m왕복(버튼)": { avg: 8.8, top_avg: 8.3, max: 8.0 },
    "10m왕복(콘)": { avg: 10.5, top_avg: 10.2, max: 9.8 },
    "20m왕복(버튼)": { avg: 16.5, top_avg: 15.6, max: 15.0 },
    "20m왕복(콘)": { avg: 17.8, top_avg: 16.8, max: 16.3 }
  }
};


  // ✅ GPT 프롬프트 생성
// 👇 성별 기준으로 기준표 가져오기
const statByGender = referenceStats[gender];

// 📦 실기기록 중 유효한 기록만 추리고 종목별 최대 3개씩
const validRows = rows.filter(r => !isNaN(parseFloat(r.record_value)));
const grouped = {};
for (const r of validRows) {
  if (!grouped[r.event_name]) grouped[r.event_name] = [];
  if (grouped[r.event_name].length < 3) grouped[r.event_name].push(r);
}
const finalRecords = Object.values(grouped).flat();

// 🧠 기준표 포함한 GPT 프롬프트 구성
const prompt = `
너는 체대입시 실기 분석 전문가야.

아래는 남학생/여학생 기준의 종목별 성능 기준표야. 각 종목은 "평균", "상위 평균", "만점 수준"으로 구성되어 있고, 어떤 종목은 기록이 클수록 좋고, 어떤 종목은 작을수록 좋아.

📌 [종목별 해석 방식 안내 (절대 중요)]
- "제자리멀리뛰기", "메디신볼던지기", "좌전굴", "배근력" 👉 숫자가 클수록 좋은 기록 (높을수록 좋음)
- "10m왕복(버튼)", "10m왕복(콘)", "20m왕복(버튼)", "20m왕복(콘)" 👉 숫자가 작을수록 좋은 기록 (낮을수록 좋음)

**절대 이 기준을 헷갈리지 마! GPT가 자주 실수하는 부분이야. 특히 달리기 기록은 작을수록 좋다는 걸 명확하게 반영해야 해.**

⚠️ GPT는 아래를 정확히 반영해서 판단하라. 종목별 기록과 상위 평균을 수치 비교할 때, 수학적 오류 없이 정확히 판단해야 한다.  

예를 들어, 메디신볼던지기 기록이 11이고 상위 평균이 10.5이면, 11 > 10.5 이므로 "상위 평균을 넘는 수준"이다. 절대 반대로 판단하지 마라.

실제로 기록이 상위 평균을 넘었음에도 불구하고 "미치지 못한다"고 말하면 그건 명백한 오답이다. 정확한 수치 비교를 하라. 현재 실수가 10프로이상되고있음


성별: ${gender}

📊 종목별 기준표:
${JSON.stringify(statByGender, null, 2)}

📝 학생 기록:
${JSON.stringify(finalRecords, null, 2)}

이 데이터를 기반으로,
1. 각 종목의 추세가 향상/유지/저하 중 어떤지
2. 상위 평균과 만점 기준을  비교했을 때 어떤 종목이 강점/약점인지 json으로 기준을 줫으니깐 확실하게 수학적으로 제발 비교해줘. 실수는 용납되지 않아. 만점기준이 넘었으면 넘었다고 해야지 근접 했다고 하면안되는거야.
3. 훈련 방향을 요약해서 2~3문장 정도로 한국어로 정리해줘. 뭉뚱그려서 하지말고 . 기록이 점점 낮아지거나 슬럼프가 왓을때 대처방법등도.

‼️ 단, 종목별 해석 방식(높을수록 좋은지, 낮을수록 좋은지)을 반드시 반영해서 정확하게 판단할 것. 
`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7
    });

    const comment = completion.choices[0].message.content.trim();
    res.json({ comment });
  } catch (e) {
    console.error('GPT 에러:', e);
    res.status(500).json({ message: 'GPT 분석 실패' });
  }
});



// ==== [멘탈 자가 체크 알림톡 스케줄러] ====
// ※ ilsanmaxsys.js 맨 아래 module.exports = router; 다음에 붙여넣기!



// 템플릿/이미지/버튼
const mentalUrl = 'https://ilsanmax.com/mental.html';

const TEMPLATES = {
  m01: {
    code: 'm01',
    content: `[일산맥스체대입시]

현재 수강중인,
#{이름} 학생의 자가멘탈체크

10초도 걸리지 않으니, 빠르게 체크하자
-절대 대충 하지말고 현재, 내 상황을 정확하게 체크 하길 바랄께!`
  }
  // m02도 필요하면 여기에 추가!
};

async function sendAlimtalk(users, templateKey) {
  if (!users.length) return;
  const template = TEMPLATES[templateKey];

  const timestamp = Date.now().toString();
  const uri = `/alimtalk/v2/services/${serviceId}/messages`;
  const method = 'POST';
  const hmac = method + ' ' + uri + '\n' + timestamp + '\n' + accessKey;
  const signature = crypto.createHmac('sha256', secretKey).update(hmac).digest('base64');

  const messages = users.map(u => ({
    to: u.phone.replace(/[^0-9]/g, ''),
    content: template.content.replace('#{이름}', u.name),
    buttons: [
      {
        type: 'WL',
        name: '자가멘탈체크',
        linkMobile: mentalUrl,
        linkPc: mentalUrl  // ★ 반드시 추가
      }
    ]
    // image 필드 X!
  }));

  const body = {
    plusFriendId,
    templateCode: template.code,
    messages
  };

  try {
    await axios.post(
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
    console.log(`[${templateKey}] ${users.length}명 알림톡 발송 완료!`);
  } catch (e) {
    console.error('알림톡 발송 실패:', e.response?.data || e.message);
    throw e;
  }
}


// 1. 2일에 한 번 23:00 (m01)
schedule.scheduleJob('0 23 */2 * *', async () => {
  dbAcademy.query(
    `SELECT id, name, phone FROM students WHERE status='재원' AND phone IS NOT NULL`,
    async (err, rows) => {
      if (err) return console.error('학생 조회 오류:', err);
      await sendAlimtalk(rows, 'm01');
    }
  );
});

// 2. 매일 8:00 (m02, 미입력자만)
schedule.scheduleJob('0 8 * * *', async () => {
  const yesterday = new Date(Date.now() - 24*60*60*1000);
  const ymd = yesterday.toISOString().slice(0, 10);
  dbAcademy.query(
    `
    SELECT s.id, s.name, s.phone 
    FROM students s
    LEFT JOIN (SELECT student_id FROM mental_check WHERE submitted_at = ?) mc
      ON s.id = mc.student_id
    WHERE s.status='재원' AND s.phone IS NOT NULL AND mc.student_id IS NULL
    `,
    [ymd],
    async (err, rows) => {
      if (err) return console.error('멘탈 미입력 학생 조회 오류:', err);
      await sendAlimtalk(rows, 'm02');
    }
  );
});

console.log('멘탈 자가체크 알림톡 스케줄러 구동 시작됨!');


// ====== 테스트용 멘탈 알림톡 단건 발송 라우터 ======
router.post('/test-mental-alimtalk', async (req, res) => {
  const { name = '테스트학생', templateKey = 'm01' } = req.body;

  // 테스트 번호 (고정)
  const phone = '01021446765';

  try {
    await sendAlimtalk([{ name, phone }], templateKey);
    res.json({ success: true, message: `알림톡 ${templateKey} ${phone}로 발송 완료!` });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
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
 
  
    
