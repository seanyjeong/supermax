const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();
const port = 8321;

app.use(cors());
app.use(express.json());

// MySQL 연결 풀 - jungsi (입시 정보)
const dbJungsi = mysql.createPool({
  host: '211.37.174.218',
  user: 'maxilsan',
  password: 'q141171616!',
  database: 'jungsi',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
});

// MySQL 연결 풀 - paca (학원 관리)
const dbPaca = mysql.createPool({
  host: '211.37.174.218',
  user: 'maxilsan',
  password: 'q141171616!',
  database: 'paca',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
});

// P-ACA 학원 ID 고정 (일산맥스)
const ACADEMY_ID = 2;

// n8n/일산맥스AI 전용 API Key 인증
const apiKeyAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey === 'ilsan-max-ai-key-2024') {
    return next();
  }
  return res.status(401).json({ success: false, message: 'API Key 필요' });
};

// =============================================
// API 엔드포인트 (/maxai 경로)
// =============================================

// 헬스체크
app.get('/maxai/health', (req, res) => {
  res.json({ status: 'ok', service: 'ilsan-max-ai' });
});

// 대학 목록 조회
app.get('/maxai/api/universities', apiKeyAuth, async (req, res) => {
  try {
    const { year = 2026 } = req.query;
    const [rows] = await dbJungsi.query(
      'SELECT DISTINCT U_ID, 대학명, 학과명 FROM 정시기본 WHERE 학년도 = ? ORDER BY 대학명, 학과명',
      [year]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('대학 목록 조회 오류:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 대학 검색 (이름으로)
app.get('/maxai/api/universities/search', apiKeyAuth, async (req, res) => {
  try {
    const { name, year = 2026 } = req.query;
    if (!name) {
      return res.status(400).json({ success: false, message: '대학명 또는 학과명 필요' });
    }

    const [rows] = await dbJungsi.query(
      `SELECT DISTINCT U_ID, 대학명, 학과명 FROM 정시기본
       WHERE 학년도 = ? AND (대학명 LIKE ? OR 학과명 LIKE ?)
       ORDER BY 대학명, 학과명`,
      [year, `%${name}%`, `%${name}%`]
    );

    if (rows.length === 0) {
      return res.json({ success: true, data: [], message: '검색 결과 없음' });
    }

    // 첫 번째 결과의 상세 정보도 함께 반환
    if (rows.length === 1) {
      const uid = rows[0].U_ID;

      const [basic] = await dbJungsi.query(
        'SELECT * FROM 정시기본 WHERE U_ID = ? AND 학년도 = ?',
        [uid, year]
      );

      const [rawRatio] = await dbJungsi.query(
        'SELECT * FROM 정시_원본반영표 WHERE 매칭_U_ID = ? AND 학년도 = ?',
        [uid, year]
      );

      const [ratio] = await dbJungsi.query(
        'SELECT * FROM 정시반영비율 WHERE U_ID = ? AND 학년도 = ?',
        [uid, year]
      );

      const [eventNames] = await dbJungsi.query(
        'SELECT DISTINCT 종목명 FROM 정시실기배점 WHERE U_ID = ? AND 학년도 = ?',
        [uid, year]
      );

      // 실기배점표도 가져오기
      const [scoreTable] = await dbJungsi.query(
        'SELECT 종목명, 성별, 기록, 배점 FROM 정시실기배점 WHERE U_ID = ? AND 학년도 = ? ORDER BY 종목명, 성별, CAST(기록 AS DECIMAL(10,2))',
        [uid, year]
      );

      return res.json({
        success: true,
        data: {
          university: rows[0],
          basic: basic[0] || null,
          rawRatio: rawRatio[0] || null,
          ratio: ratio[0] || null,
          events: eventNames.map(s => s.종목명),
          scoreTable: scoreTable
        }
      });
    }

    res.json({ success: true, data: rows, message: `${rows.length}개 검색됨. 더 구체적으로 검색해주세요.` });
  } catch (err) {
    console.error('대학 검색 오류:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 대학 상세 정보 (원본반영표 우선, 없으면 반영비율)
app.get('/maxai/api/universities/:uid', apiKeyAuth, async (req, res) => {
  try {
    const { uid } = req.params;
    const { year = 2026 } = req.query;

    // 기본 정보
    const [basic] = await dbJungsi.query(
      'SELECT * FROM 정시기본 WHERE U_ID = ? AND 학년도 = ?',
      [uid, year]
    );

    // 원본반영표 먼저 조회 (보여주기용)
    const [rawRatio] = await dbJungsi.query(
      'SELECT * FROM 정시_원본반영표 WHERE 매칭_U_ID = ? AND 학년도 = ?',
      [uid, year]
    );

    // 반영비율 (계산용, 원본반영표에 없는 것 보완)
    const [ratio] = await dbJungsi.query(
      'SELECT * FROM 정시반영비율 WHERE U_ID = ? AND 학년도 = ?',
      [uid, year]
    );

    // 실기배점
    const [scores] = await dbJungsi.query(
      'SELECT * FROM 정시실기배점 WHERE U_ID = ? AND 학년도 = ? ORDER BY 종목명, 성별, CAST(기록 AS DECIMAL(10,2))',
      [uid, year]
    );

    res.json({
      success: true,
      data: {
        basic: basic[0] || null,
        rawRatio: rawRatio[0] || null,  // 원본반영표 (보여주기용)
        ratio: ratio[0] || null,         // 반영비율 (계산용)
        scores: scores                   // 실기배점표
      }
    });
  } catch (err) {
    console.error('대학 상세 조회 오류:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 실기 점수 계산
app.post('/maxai/api/calculate-score', apiKeyAuth, async (req, res) => {
  try {
    const { uid, year = 2026, event, record, gender } = req.body;

    if (!uid || !event || record === undefined) {
      return res.status(400).json({ success: false, message: 'uid, event, record 필요' });
    }

    // 해당 종목 배점표 조회
    let query = 'SELECT * FROM 정시실기배점 WHERE U_ID = ? AND 학년도 = ? AND 종목명 = ?';
    const params = [uid, year, event];

    if (gender) {
      query += ' AND (성별 = ? OR 성별 IS NULL OR 성별 = "")';
      params.push(gender);
    }

    query += ' ORDER BY 기록';
    const [scoreTable] = await dbJungsi.query(query, params);

    if (scoreTable.length === 0) {
      return res.json({ success: true, score: null, message: '배점표 없음' });
    }

    // 점수 계산 (silgical.js 로직 적용)
    const score = lookupScore(record, event, scoreTable);

    res.json({
      success: true,
      score: score,
      event: event,
      record: record
    });
  } catch (err) {
    console.error('점수 계산 오류:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// =============================================
// P-ACA 학원 관리 API (academy_id = 2 고정)
// =============================================

// 학생 목록 조회
app.get('/maxai/api/paca/students', apiKeyAuth, async (req, res) => {
  try {
    const { status = 'active' } = req.query;
    let query = 'SELECT id, name, grade, phone, parent_phone, status, created_at FROM students WHERE academy_id = ?';
    const params = [ACADEMY_ID];

    if (status !== 'all') {
      query += ' AND status = ?';
      params.push(status);
    }
    query += ' ORDER BY name';

    const [rows] = await dbPaca.query(query, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('학생 목록 조회 오류:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 미납자 조회
app.get('/maxai/api/paca/unpaid', apiKeyAuth, async (req, res) => {
  try {
    const [rows] = await dbPaca.query(`
      SELECT s.id, s.name, s.grade, s.phone, sp.final_amount, sp.due_date, sp.year_month
      FROM students s
      JOIN student_payments sp ON s.id = sp.student_id
      WHERE s.academy_id = ? AND s.status = 'active' AND sp.payment_status IN ('pending', 'overdue')
      ORDER BY sp.due_date, s.name
    `, [ACADEMY_ID]);

    const totalUnpaid = rows.reduce((sum, r) => sum + Number(r.final_amount), 0);
    res.json({ success: true, data: rows, totalUnpaid, count: rows.length });
  } catch (err) {
    console.error('미납자 조회 오류:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 오늘 수업 대상자 중 미납자 조회
app.get('/maxai/api/paca/today-unpaid', apiKeyAuth, async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];

    // 요일 계산
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const dateObj = new Date(targetDate);
    const dayOfWeek = dayNames[dateObj.getDay()];

    const [rows] = await dbPaca.query(`
      SELECT DISTINCT s.id, s.name, s.grade, s.phone, sp.final_amount
      FROM students s
      JOIN attendance a ON s.id = a.student_id
      JOIN class_schedules cs ON a.class_schedule_id = cs.id
      JOIN student_payments sp ON s.id = sp.student_id
      WHERE s.academy_id = ?
        AND s.status = 'active'
        AND DATE(cs.class_date) = ?
        AND sp.payment_status IN ('pending', 'overdue')
      ORDER BY s.grade, s.name
    `, [ACADEMY_ID, targetDate]);

    res.json({
      success: true,
      date: targetDate,
      dayOfWeek: dayOfWeek,
      data: rows,
      count: rows.length
    });
  } catch (err) {
    console.error('오늘 미납자 조회 오류:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 월별 매출 조회
app.get('/maxai/api/paca/revenue', apiKeyAuth, async (req, res) => {
  try {
    const { year, month } = req.query;

    let query = `
      SELECT
        DATE_FORMAT(paid_date, '%Y-%m') as month,
        SUM(paid_amount) as total,
        COUNT(*) as count
      FROM student_payments
      WHERE student_id IN (SELECT id FROM students WHERE academy_id = ?)
        AND payment_status = 'paid'
    `;
    const params = [ACADEMY_ID];

    if (year && month) {
      query += ' AND YEAR(paid_date) = ? AND MONTH(paid_date) = ?';
      params.push(year, month);
    } else if (year) {
      query += ' AND YEAR(paid_date) = ?';
      params.push(year);
    }

    query += ' GROUP BY DATE_FORMAT(paid_date, "%Y-%m") ORDER BY month DESC';

    const [rows] = await dbPaca.query(query, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('매출 조회 오류:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 출석 현황 조회
app.get('/maxai/api/paca/attendance', apiKeyAuth, async (req, res) => {
  try {
    const { date, student_id } = req.query;

    let query = `
      SELECT a.*, s.name as student_name, cs.class_date
      FROM attendance a
      JOIN students s ON a.student_id = s.id
      JOIN class_schedules cs ON a.class_schedule_id = cs.id
      WHERE s.academy_id = ?
    `;
    const params = [ACADEMY_ID];

    if (date) {
      query += ' AND DATE(cs.class_date) = ?';
      params.push(date);
    }
    if (student_id) {
      query += ' AND a.student_id = ?';
      params.push(student_id);
    }

    query += ' ORDER BY cs.class_date DESC, s.name LIMIT 100';

    const [rows] = await dbPaca.query(query, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('출석 조회 오류:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 오늘 수업 예정 학생 수 조회
app.get('/maxai/api/paca/today-attendance', apiKeyAuth, async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];

    // 요일 계산
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const dateObj = new Date(targetDate);
    const dayOfWeek = dayNames[dateObj.getDay()];

    const [rows] = await dbPaca.query(`
      SELECT s.id, s.name, s.grade, a.attendance_status
      FROM attendance a
      JOIN students s ON a.student_id = s.id
      JOIN class_schedules cs ON a.class_schedule_id = cs.id
      WHERE s.academy_id = ?
        AND DATE(cs.class_date) = ?
      ORDER BY s.grade, s.name
    `, [ACADEMY_ID, targetDate]);

    res.json({
      success: true,
      date: targetDate,
      dayOfWeek: dayOfWeek,
      data: rows,
      count: rows.length
    });
  } catch (err) {
    console.error('오늘 출석 조회 오류:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 강사 목록 조회
app.get('/maxai/api/paca/instructors', apiKeyAuth, async (req, res) => {
  try {
    const [rows] = await dbPaca.query(
      'SELECT id, name, phone, email, status FROM instructors WHERE academy_id = ? ORDER BY name',
      [ACADEMY_ID]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('강사 목록 조회 오류:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 대시보드 요약 정보
app.get('/maxai/api/paca/dashboard', apiKeyAuth, async (req, res) => {
  try {
    // 재원생 수
    const [[{ activeCount }]] = await dbPaca.query(
      'SELECT COUNT(*) as activeCount FROM students WHERE academy_id = ? AND status = "active"',
      [ACADEMY_ID]
    );

    // 이번달 매출
    const [[{ monthRevenue }]] = await dbPaca.query(`
      SELECT COALESCE(SUM(paid_amount), 0) as monthRevenue
      FROM student_payments
      WHERE student_id IN (SELECT id FROM students WHERE academy_id = ?)
        AND payment_status = 'paid'
        AND YEAR(paid_date) = YEAR(CURDATE())
        AND MONTH(paid_date) = MONTH(CURDATE())
    `, [ACADEMY_ID]);

    // 미납 건수
    const [[{ unpaidCount }]] = await dbPaca.query(`
      SELECT COUNT(*) as unpaidCount
      FROM student_payments sp
      JOIN students s ON sp.student_id = s.id
      WHERE s.academy_id = ? AND s.status = 'active' AND sp.payment_status IN ('pending', 'overdue')
    `, [ACADEMY_ID]);

    // 오늘 출석
    const [[{ todayAttendance }]] = await dbPaca.query(`
      SELECT COUNT(*) as todayAttendance
      FROM attendance a
      JOIN students s ON a.student_id = s.id
      JOIN class_schedules cs ON a.class_schedule_id = cs.id
      WHERE s.academy_id = ? AND DATE(cs.class_date) = CURDATE() AND a.attendance_status = 'present'
    `, [ACADEMY_ID]);

    res.json({
      success: true,
      data: {
        activeStudents: activeCount,
        monthRevenue: Number(monthRevenue),
        unpaidCount: unpaidCount,
        todayAttendance: todayAttendance
      }
    });
  } catch (err) {
    console.error('대시보드 조회 오류:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// =============================================
// 실기 점수 계산 헬퍼 함수 (silgical.js에서 가져옴)
// =============================================

function getEventRules(eventName) {
  eventName = eventName || '';
  const LOW_IS_BETTER_KEYWORDS = ['m', 'run', '왕복', '초', '벽', '지그', 'z'];
  let method = 'higher_is_better';

  if (LOW_IS_BETTER_KEYWORDS.some((k) => eventName.toLowerCase().includes(k))) {
    method = 'lower_is_better';
  }
  if (eventName.includes('던지기') || eventName.includes('멀리뛰기')) {
    method = 'higher_is_better';
  }
  return method;
}

function lookupScore(studentRecord, eventName, scoreTable) {
  if (!scoreTable || scoreTable.length === 0) return 0;

  const method = getEventRules(eventName);
  const studentValueStr = String(studentRecord).trim().toUpperCase();

  // F, G, 미응시 등은 최하점
  const FORCE_MIN_KEYWORDS = ['F', 'G', '미응시', '파울', '실격'];
  if (FORCE_MIN_KEYWORDS.includes(studentValueStr)) {
    const scores = scoreTable.map(r => Number(r.배점)).filter(n => !isNaN(n));
    return Math.min(...scores);
  }

  const studentValueNum = Number(studentRecord);
  if (isNaN(studentValueNum)) return 0;

  // 숫자 기록들만 추출
  const numericLevels = scoreTable
    .filter(r => !isNaN(Number(r.기록)))
    .map(r => ({ record: Number(r.기록), score: Number(r.배점) }));

  if (numericLevels.length === 0) return 0;

  // 정렬 후 매칭
  if (method === 'lower_is_better') {
    // 낮을수록 좋음 (달리기): 내림차순, 기록 이상이면 해당 점수
    numericLevels.sort((a, b) => b.record - a.record);
    for (const level of numericLevels) {
      if (studentValueNum >= level.record) return level.score;
    }
    return numericLevels[numericLevels.length - 1].score;
  } else {
    // 높을수록 좋음 (제멀): 내림차순, 기록 이상이면 해당 점수
    numericLevels.sort((a, b) => b.record - a.record);
    for (const level of numericLevels) {
      if (studentValueNum >= level.record) return level.score;
    }
    return numericLevels[numericLevels.length - 1].score;
  }
}

// =============================================
// 서버 시작
// =============================================

app.listen(port, () => {
  console.log(`일산맥스AI 서버 실행 중: http://localhost:${port}`);
});
