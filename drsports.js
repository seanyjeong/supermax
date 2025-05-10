const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');

const serviceId = 'ncp:sms:kr:284240549231:sean'.split(':').pop(); // 'sean'
const accessKey = 'A8zINaiL6JjWUNbT1uDB';
const secretKey = 'eA958IeOvpxWQI1vYYA9GcXSeVFQYMEv4gCtEorW';
const sender = '01051998691'; // 등록된 발신번호

function makeSignature(uri, timestamp, accessKey, secretKey) {
  const space = ' ';
  const newLine = '\n';
  const method = 'POST';
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(method + space + uri + newLine + timestamp + newLine + accessKey);
  return hmac.digest('base64');
}

async function sendSMS(to, content) {
  const timestamp = Date.now().toString();
  const uri = `/sms/v2/services/${serviceId}/messages`;
  const url = `https://sens.apigw.ntruss.com${uri}`;
  const signature = makeSignature(uri, timestamp, accessKey, secretKey);

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'x-ncp-apigw-timestamp': timestamp,
    'x-ncp-iam-access-key': accessKey,
    'x-ncp-apigw-signature-v2': signature
  };

  const body = {
    type: 'SMS',
    contentType: 'COMM',
    countryCode: '82',
    from: sender,
    content,
    messages: [{ to }]
  };

  try {
    const res = await axios.post(url, body, { headers });
    return res.data;
  } catch (err) {
    console.error(`❌ 문자 전송 실패 (${to}):`, err.response?.data || err.message);
  }
}

const { db_drsports } = require('./college');  // ⬅ 요거!

// ✅ 예: 회원 목록 조회
router.get('/drmembers', (req, res) => {
  db_drsports.query('SELECT * FROM members ORDER BY registered_at DESC', (err, rows) => {
    if (err) {
      console.error('❌ 회원 조회 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json(rows);
  });
});

router.post('/drregister-members', async (req, res) => {
  const rows = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: '❗ 등록할 데이터 없음' });
  }

  let inserted = 0, updated = 0, scheduleInserted = 0;

  for (const row of rows) {
    const {
      name, birth, phone = '', parent_phone = '', gender,
      status = '재원', school = '', grade = '',
      weekday, time
    } = row;

    // 1. 기존 회원 검색
    const memberSearch = await new Promise(resolve => {
      db_drsports.query(
        'SELECT id FROM members WHERE name = ? AND birth = ?',
        [name, birth],
        (err, result) => resolve(result?.[0])
      );
    });

    let memberId = memberSearch?.id;

    // 2. 신규 회원 등록
    if (!memberId) {
      const insertResult = await new Promise(resolve => {
        db_drsports.query(
          `INSERT INTO members 
            (name, birth, phone, parent_phone, gender, status, school, grade)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [name, birth, phone, parent_phone, gender, status, school, grade],
          (err, result) => resolve(result)
        );
      });
      memberId = insertResult?.insertId;
      inserted++;
    } else {
      updated++;
    }

    // 3. 수업이 지정되었을 경우 클래스 조회 → lesson_schedule 등록
    if (weekday && time) {
      const classRow = await new Promise(resolve => {
        db_drsports.query(
          'SELECT id FROM classes WHERE weekday = ? AND time = ? LIMIT 1',
          [weekday, time],
          (err, rows) => resolve(rows?.[0])
        );
      });

      if (classRow?.id) {
        await new Promise(resolve => {
          db_drsports.query(
            `INSERT INTO lesson_schedule (member_id, class_id)
             VALUES (?, ?) ON DUPLICATE KEY UPDATE class_id = class_id`,
            [memberId, classRow.id],
            (err, result) => resolve()
          );
        });
        scheduleInserted++;
      }
    }
  }

  res.json({
    message: '✅ 등록 완료',
    inserted,
    updated,
    scheduleInserted
  });
});



router.put('/drupdate-member/:id', (req, res) => {
  const { id } = req.params;
  const { name, birth, phone, parent_phone, gender, status, school, grade } = req.body;

  const sql = `
    UPDATE members
    SET name = ?, birth = ?, phone = ?, parent_phone = ?, gender = ?, status = ?, school = ?, grade = ?
    WHERE id = ?
  `;

  db_drsports.query(sql, [name, birth, phone, parent_phone, gender, status, school, grade, id], (err, result) => {
    if (err) {
      console.error('❌ 회원 수정 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json({ message: '✅ 회원 수정 완료' });
  });
});


router.delete('/drdelete-member/:id', (req, res) => {
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

router.post('/drregister-schedules', (req, res) => {
  const data = req.body;

  if (!Array.isArray(data) || data.length === 0) {
    return res.status(400).json({ message: '❗ 등록할 스케줄 정보가 없습니다' });
  }

  const values = [];

  data.forEach(entry => {
    const member_id = entry.member_id;
    const class_ids = entry.class_ids || [];
  
    class_ids.forEach(class_id => {
      values.push([member_id, class_id]);
    });
  });
  
  const sql = `INSERT INTO lesson_schedule (member_id, class_id) VALUES ? ON DUPLICATE KEY UPDATE class_id = class_id`;

  db_drsports.query(sql, [values], (err, result) => {
    if (err) {
      console.error('❌ 일괄 스케줄 등록 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json({ message: `✅ ${result.affectedRows}개의 수업 스케줄 등록 완료` });
  });
});

router.get('/drschedules', (req, res) => {
  const { member_id } = req.query;

  if (!member_id) {
    return res.status(400).json({ message: '❗ member_id 누락' });
  }

  const sql = `
  SELECT c.id AS class_id, c.weekday, c.time, c.title
  FROM lesson_schedule ls
  JOIN classes c ON ls.class_id = c.id
  WHERE ls.member_id = ?
  ORDER BY FIELD(c.weekday, '월', '화', '수', '목', '금', '토', '일'), c.time
`;


  db_drsports.query(sql, [member_id], (err, rows) => {
    if (err) {
      console.error('❌ 스케줄 조회 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json(rows);
  });
});

router.get('/drschedules-by-time', (req, res) => {
  const { weekday, time } = req.query;

  if (!weekday || !time) {
    return res.status(400).json({ message: '❗ 요일 또는 시간 누락' });
  }

  const sql = `
  SELECT m.id, m.name, m.gender, m.phone, m.parent_phone
  FROM lesson_schedule ls
  JOIN classes c ON ls.class_id = c.id
  JOIN members m ON ls.member_id = m.id
  WHERE c.weekday = ? AND c.time = ?
  ORDER BY m.name
`;


  db_drsports.query(sql, [weekday, time], (err, rows) => {
    if (err) {
      console.error('❌ 타임별 스케줄 조회 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json(rows);
  });
});
router.post('/drattendance', (req, res) => {
  const records = req.body;

  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ message: '❗ 출석 데이터 없음' });
  }

  const values = records.map(r => [
    r.member_id,
    r.date,
    r.time,
    r.status,
    r.make_up_class || false
  ]);

  const sql = `
    INSERT INTO attendance (member_id, date, time, status, make_up_class)
    VALUES ?
    ON DUPLICATE KEY UPDATE status=VALUES(status), make_up_class=VALUES(make_up_class)
  `;

  db_drsports.query(sql, [values], (err, result) => {
    if (err) {
      console.error('❌ 출석 등록 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json({ message: `✅ ${result.affectedRows}건 출석 처리 완료` });
  });
});
router.get('/drattendance', (req, res) => {
  const { date, time } = req.query;

  if (!date || !time) {
    return res.status(400).json({ message: '❗ 날짜 또는 시간 누락' });
  }

  const sql = `
    SELECT a.*, m.name, m.phone, m.parent_phone
    FROM attendance a
    JOIN members m ON a.member_id = m.id
    WHERE a.date = ? AND a.time = ?
    ORDER BY m.name
  `;

  db_drsports.query(sql, [date, time], (err, rows) => {
    if (err) {
      console.error('❌ 출석 조회 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json(rows);
  });
});

router.post('/drpayment', (req, res) => {
  const {
    member_id, year_month,
    expected_amount, paid_amount,
    payment_date, memo,
    method = '계좌'  // 기본값
  } = req.body;

  if (!member_id || !year_month) {
    return res.status(400).json({ message: '❗ 필수 항목 누락' });
  }

  const sql = `
    INSERT INTO payment_history
    (member_id, year_month, expected_amount, paid_amount, payment_date, memo, method)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      expected_amount = VALUES(expected_amount),
      paid_amount = VALUES(paid_amount),
      payment_date = VALUES(payment_date),
      memo = VALUES(memo),
      method = VALUES(method)
  `;

  db_drsports.query(sql, [
    member_id, year_month, expected_amount, paid_amount, payment_date, memo, method
  ], (err, result) => {
    if (err) {
      console.error('❌ 결제 등록 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json({ message: '✅ 결제 등록 완료' });
  });
});

router.get('/drpayment', (req, res) => {
  const { year_month } = req.query;

  if (!year_month) {
    return res.status(400).json({ message: '❗ 월 정보 누락' });
  }

  const sql = `
    SELECT ph.*, m.name, m.phone, m.parent_phone, m.gender
    FROM payment_history ph
    JOIN members m ON ph.member_id = m.id
    WHERE ph.year_month = ?
    ORDER BY m.name
  `;

  db_drsports.query(sql, [year_month], (err, rows) => {
    if (err) {
      console.error('❌ 결제 조회 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json(rows); // 여기엔 method 필드 포함되어 있음
  });
});




router.get('/drtuition', (req, res) => {
  const { member_id, type } = req.query;
  const discount_type = type || '기본';

  if (!member_id) {
    return res.status(400).json({ message: '❗ member_id 누락' });
  }

  const getLessonCountSql = `
    SELECT COUNT(DISTINCT weekday) AS lesson_count
    FROM lesson_schedule
    WHERE member_id = ?
  `;

  db_drsports.query(getLessonCountSql, [member_id], (err, result) => {
    if (err) {
      console.error('❌ 수업 횟수 조회 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }

    const lesson_count = result[0].lesson_count;

    const getPriceSql = `
      SELECT price, description
      FROM tuition_policy
      WHERE lesson_count = ? AND discount_type = ?
      LIMIT 1
    `;

    db_drsports.query(getPriceSql, [lesson_count, discount_type], (err2, rows) => {
      if (err2) {
        console.error('❌ 수업료 조회 실패:', err2);
        return res.status(500).json({ message: 'DB 오류' });
      }

      if (rows.length === 0) {
        return res.status(404).json({ message: `❗ ${lesson_count}회, ${discount_type} 가격 정보 없음` });
      }

      res.json({
        member_id,
        lesson_count,
        discount_type,
        price: rows[0].price,
        description: rows[0].description
      });
    });
  });
});

router.post('/drforce-absence', (req, res) => {
  const { date, weekday, time } = req.body;

  if (!date || !weekday || !time) {
    return res.status(400).json({ message: '❗ 날짜, 요일, 시간은 필수입니다' });
  }

  // 1. 해당 요일+시간에 수업 등록된 학생 찾기
  const getStudentsSql = `
    SELECT member_id
    FROM lesson_schedule
    WHERE weekday = ? AND time = ?
  `;

  db_drsports.query(getStudentsSql, [weekday, time], (err, rows) => {
    if (err) {
      console.error('❌ 학생 조회 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }

    if (rows.length === 0) {
      return res.status(404).json({ message: '❗ 해당 요일+시간에 등록된 학생 없음' });
    }

    const values = rows.map(row => [
      row.member_id,
      date,
      time,
      '결석',
      false // 보충수업 아님
    ]);

    const insertSql = `
      INSERT INTO attendance (member_id, date, time, status, make_up_class)
      VALUES ?
      ON DUPLICATE KEY UPDATE status = VALUES(status), make_up_class = VALUES(make_up_class)
    `;

    db_drsports.query(insertSql, [values], (err2, result) => {
      if (err2) {
        console.error('❌ 결석 등록 실패:', err2);
        return res.status(500).json({ message: 'DB 오류' });
      }

      res.json({ message: `✅ ${result.affectedRows}명 전체 결석 처리 완료` });
    });
  });
});

router.get('/drpending-payments', (req, res) => {
  const { year_month, today } = req.query;
  const 기준일 = today || new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  if (!year_month) {
    return res.status(400).json({ message: '❗ year_month 누락' });
  }

  const sql = `
    SELECT m.id AS member_id, m.name, m.phone, m.parent_phone, ph.expected_amount, ph.paid_amount, ph.payment_date
    FROM members m
    LEFT JOIN payment_history ph
      ON m.id = ph.member_id AND ph.year_month = ?
    WHERE 
      (
        ph.payment_date IS NULL
        OR ph.paid_amount IS NULL
        OR ph.paid_amount < ph.expected_amount
      )
      AND DATE_SUB(STR_TO_DATE(CONCAT(?, '-01'), '%Y-%m-%d'), INTERVAL -7 DAY) <= ?
    ORDER BY m.name
  `;

  db_drsports.query(sql, [year_month, year_month, 기준일], (err, rows) => {
    if (err) {
      console.error('❌ 미결제자 조회 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }

    res.json(rows);
  });
});

const { format, addDays, parseISO } = require('date-fns');

router.get('/drtuition-auto', (req, res) => {
  const { member_id, year_month, discount_type = '기본' } = req.query;

  if (!member_id || !year_month) {
    return res.status(400).json({ message: '❗ member_id, year_month 누락' });
  }

  const [year, month] = year_month.split('-').map(Number);
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  const weekdayMap = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };

  const getScheduleSql = `
SELECT DISTINCT c.weekday, c.time, c.start_date
FROM lesson_schedule ls
JOIN classes c ON ls.class_id = c.id
WHERE ls.member_id = ?
`;

  db_drsports.query(getScheduleSql, [member_id], (err, schedules) => {
    if (err) return res.status(500).json({ message: '❌ 수업 정보 조회 실패', err });
    if (schedules.length === 0) return res.status(404).json({ message: '❗ 수업 스케줄 없음' });

    // 휴강 데이터 불러오기
    const getClosureSql = `
      SELECT date, time FROM class_closure
      WHERE date BETWEEN ? AND ?
    `;

    db_drsports.query(getClosureSql, [
      format(startDate, 'yyyy-MM-dd'),
      format(endDate, 'yyyy-MM-dd')
    ], (err2, closures) => {
      if (err2) return res.status(500).json({ message: '❌ 휴강 조회 실패', err2 });

      const closureKeys = closures.map(c => `${format(new Date(c.date), 'yyyy-MM-dd')}_${c.time.slice(0, 5)}`);

      const actualClassDates = [];

      + schedules.forEach(({ weekday, time, start_date }) => {
        const targetDay = weekdayMap[weekday];
        let d = new Date(startDate);

        while (d <= endDate) {
          if (d.getDay() === targetDay) {
            const dateStr = format(d, 'yyyy-MM-dd');
            const timeStr = time.slice(0, 5);
            const key = `${dateStr}_${timeStr}`;
            if (new Date(dateStr) >= new Date(start_date)) {
            if (!closureKeys.includes(key)) {
              actualClassDates.push({ date: dateStr, time: timeStr });
            }
          }
          }
          d.setDate(d.getDate() + 1);
        }
      });

      const lesson_count = actualClassDates.length;

      const getPriceSql = `
        SELECT price
        FROM tuition_policy
        WHERE lesson_count = ? AND discount_type = ?
        LIMIT 1
      `;

      db_drsports.query(getPriceSql, [lesson_count, discount_type], (err3, rows) => {
        if (err3) return res.status(500).json({ message: '❌ 수업료 조회 실패', err3 });

        if (rows.length === 0) {
          return res.status(404).json({
            message: `❗ ${lesson_count}회 ${discount_type} 가격 정보 없음`
          });
        }

        const price = rows[0].price;
        const lastClassDate = actualClassDates.sort((a, b) => a.date.localeCompare(b.date)).pop();
        const dueDate = format(addDays(parseISO(lastClassDate.date), 7), 'yyyy-MM-dd');

        res.json({
          member_id,
          year_month,
          lesson_count,
          discount_type,
          price,
          due_date: dueDate,
          class_dates: actualClassDates
        });
      });
    });
  });
});

//문자보내기
router.get('/drsend-smart-bill', async (req, res) => {
  const { year_month, discount_type = '기본' } = req.query;
  if (!year_month) return res.status(400).json({ message: '❗ year_month 누락' });

  const parentSql = `SELECT DISTINCT parent_phone FROM members WHERE parent_phone IS NOT NULL`;
  db_drsports.query(parentSql, async (err, parentPhones) => {
    if (err) return res.status(500).json({ message: '❌ 부모 목록 조회 실패' });

    for (const row of parentPhones) {
      const parentPhone = row.parent_phone;
      const studentsSql = `SELECT * FROM members WHERE parent_phone = ? ORDER BY name`;

      db_drsports.query(studentsSql, async (err2, students) => {
        if (err2) return console.error('❌ 학생 조회 실패:', err2);

        let totalPrice = 0;
        let message = `[닥터스포츠] ${year_month} 수업료 안내\n\n`;
        for (const student of students) {
          const lessonSql = `SELECT weekday, time FROM lesson_schedule WHERE member_id = ?`;
          const closureSql = `SELECT date, time FROM class_closure WHERE date LIKE '${year_month}%'`;

          const [schedules, closures] = await Promise.all([
            new Promise(resolve => db_drsports.query(lessonSql, [student.id], (e, r) => resolve(r || []))),
            new Promise(resolve => db_drsports.query(closureSql, (e, r) => resolve(r || [])))
          ]);

          const closureSet = new Set(closures.map(c => `${format(new Date(c.date), 'yyyy-MM-dd')}_${c.time.slice(0, 5)}`));

          const weekdayMap = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };
          const weekdayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

          const [year, month] = year_month.split('-').map(Number);
          const start = new Date(year, month - 1, 1);
          const end = new Date(year, month, 0);

          const countByWeekday = {};
          const classDates = [];

          schedules.forEach(({ weekday, time }) => {
            const targetDay = weekdayMap[weekday];
            const timeStr = time.slice(0, 5);
            let d = new Date(start);
            while (d <= end) {
              if (d.getDay() === targetDay) {
                const dateStr = format(d, 'yyyy-MM-dd');
                const key = `${dateStr}_${timeStr}`;
                if (!closureSet.has(key)) {
                  countByWeekday[weekdayNames[targetDay]] = (countByWeekday[weekdayNames[targetDay]] || 0) + 1;
                  classDates.push(dateStr);
                }
              }
              d.setDate(d.getDate() + 1);
            }
          });

          const totalCount = Object.values(countByWeekday).reduce((a, b) => a + b, 0);

          const priceSql = `SELECT price FROM tuition_policy WHERE lesson_count = ? AND discount_type = ? LIMIT 1`;
          const priceRow = await new Promise(resolve => {
            db_drsports.query(priceSql, [totalCount, discount_type], (e, r) => resolve((r && r[0]) || { price: 0 }));
          });

          totalPrice += priceRow.price;

          message += `👤 ${student.name}\n`;
          for (const [day, count] of Object.entries(countByWeekday)) {
            message += `- ${day}: ${count}회\n`;
          }
          message += `→ 총 ${totalCount}회\n\n`;
        }

        const lastDate = classDates.sort().pop();
        const dueDate = format(addDays(parseISO(lastDate), 7), 'yyyy-MM-dd');

        message += `💰 총 수업료: ${totalPrice.toLocaleString()}원\n💳 납부 마감일: ${dueDate}`;

        // 발송
        try {
          await sendSMS(parentPhone.replace(/-/g, ''), message);
          console.log(`✅ 문자 전송 완료: ${parentPhone}`);
        } catch (e) {
          console.error(`❌ 문자 전송 실패: ${parentPhone}`, e.response?.data || e.message);
        }
      });
    }

    res.json({ message: '📤 문자 전송 시작됨 (비동기 처리)' });
  });
});


router.post('/drsend-custom-sms', async (req, res) => {
  const { to, message } = req.body;

  if (!to || !message) {
    return res.status(400).json({ message: '❗ 수신번호 또는 메시지 누락' });
  }

  try {
    const result = await sendSMS(to.replace(/-/g, ''), message);
    res.json({ message: '✅ 커스텀 문자 전송 완료', result });
  } catch (err) {
    console.error(`❌ 문자 전송 실패 (${to}):`, err.response?.data || err.message);
    res.status(500).json({ message: '문자 전송 실패' });
  }
});

// ✅ 학년 자동 승급 API


function getUpgradedGrade(currentGrade, schoolName) {
  const stage = schoolName.includes('초등') ? '초등'
              : schoolName.includes('중') ? '중'
              : schoolName.includes('고') ? '고'
              : null;

  const num = parseInt(currentGrade.replace(/[^0-9]/g, ''));
  if (isNaN(num)) return currentGrade;

  if (stage === '초등') return num < 6 ? `${num + 1}학년` : '중1';
  if (stage === '중') return num < 3 ? `${num + 1}학년` : '고1';
  if (stage === '고') return num < 3 ? `${num + 1}학년` : '졸업';

  return currentGrade; // 그대로 유지
}

router.post('/drupgrade-grades', (req, res) => {
  const sql = 'SELECT id, grade, school FROM members WHERE grade IS NOT NULL AND school IS NOT NULL';
  db_drsports.query(sql, (err, members) => {
    if (err) {
      console.error('❌ 학년 승급 조회 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }

    let updatedCount = 0;
    members.forEach(m => {
      const newGrade = getUpgradedGrade(m.grade, m.school);
      if (newGrade !== m.grade) {
        const updateSql = 'UPDATE members SET grade = ? WHERE id = ?';
        db_drsports.query(updateSql, [newGrade, m.id], err2 => {
          if (!err2) updatedCount++;
        });
      }
    });

    res.json({ message: `✅ 학년 자동 승급 완료`, updated: updatedCount });
  });
});

router.post('/drclasses', (req, res) => {
   const { title, weekday, time, instructor, description, start_date } = req.body;

  if (!title || !weekday || !time) {
    return res.status(400).json({ message: '❗ 필수 항목 누락' });
  }

  const sql = `
   INSERT INTO classes (title, weekday, time, instructor, description, start_date)
   VALUES (?, ?, ?, ?, ?, ?)
  `;

  db_drsports.query(sql, [title, weekday, time, instructor || '', description || '', start_date || null], (err, result) => {
    if (err) {
      console.error('❌ 수업 등록 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json({ message: '✅ 수업 등록 완료', id: result.insertId });
  });
});

router.get('/drclasses', (req, res) => {
  const sql = `SELECT *, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date
               FROM classes ORDER BY FIELD(weekday, '월', '화', '수', '목', '금', '토', '일'), time`;

  db_drsports.query(sql, (err, rows) => {
    if (err) {
      console.error('❌ 수업 조회 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json(rows);
  });
});

router.delete('/drclasses/:id', (req, res) => {
  const { id } = req.params;

  const sql = `DELETE FROM classes WHERE id = ?`;
  db_drsports.query(sql, [id], (err, result) => {
    if (err) {
      console.error('❌ 수업 삭제 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json({ message: '🗑️ 수업 삭제 완료' });
  });
});

router.get('/drpayment-summary', (req, res) => {
  const { year_month } = req.query;
  if (!year_month) return res.status(400).json({ message: '❗ year_month 누락' });

  const sql = `
    SELECT 
      COUNT(m.id) AS total_students,
      SUM(CASE WHEN sm.status != '휴식' THEN 1 ELSE 0 END) AS active_students,
      SUM(ph.expected_amount) AS total_expected,
      SUM(CASE WHEN ph.method = '카드' THEN ph.paid_amount ELSE 0 END) AS total_card,
      SUM(CASE WHEN ph.method = '계좌' THEN ph.paid_amount ELSE 0 END) AS total_bank,
      SUM(ph.paid_amount) AS total_paid,
      SUM(CASE WHEN ph.paid_amount IS NULL OR ph.paid_amount < ph.expected_amount THEN 1 ELSE 0 END) AS unpaid_count
    FROM members m
    LEFT JOIN student_monthly sm ON sm.member_id = m.id AND sm.month = ?
    LEFT JOIN payment_history ph ON ph.member_id = m.id AND ph.year_month = ?
  `;

  db_drsports.query(sql, [year_month, year_month], (err, rows) => {
    if (err) {
      console.error('❌ 결제 요약 조회 실패:', err);
      return res.status(500).json({ message: 'DB 오류' });
    }
    res.json(rows[0]);
  });
});










module.exports = router;
