const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken, checkPermission } = require('../middleware/auth');

// ============================================
// 관리자 API - 인증 필요
// 상담 신청 관리 및 설정
// ============================================

// ================== 상담 신청 관리 ==================

// GET /paca/consultations - 상담 신청 목록 조회
router.get('/', verifyToken, async (req, res) => {
  try {
    const academyId = req.user.academy_id;
    const {
      status,
      startDate,
      endDate,
      search,
      consultationType,
      page = 1,
      limit = 20
    } = req.query;

    let whereClause = 'WHERE c.academy_id = ?';
    const params = [academyId];

    if (status) {
      whereClause += ' AND c.status = ?';
      params.push(status);
    }

    if (startDate) {
      whereClause += ' AND c.preferred_date >= ?';
      params.push(startDate);
    }

    if (endDate) {
      whereClause += ' AND c.preferred_date <= ?';
      params.push(endDate);
    }

    if (consultationType) {
      whereClause += ' AND c.consultation_type = ?';
      params.push(consultationType);
    }

    if (search) {
      whereClause += ' AND (c.parent_name LIKE ? OR c.student_name LIKE ? OR c.parent_phone LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    // 전체 개수 조회
    const [countResult] = await db.query(
      `SELECT COUNT(*) as total FROM consultations c ${whereClause}`,
      params
    );
    const total = countResult[0].total;

    // 페이징
    const offset = (parseInt(page) - 1) * parseInt(limit);
    params.push(parseInt(limit), offset);

    // 목록 조회
    const [consultations] = await db.query(
      `SELECT c.*, s.name as linked_student_name
       FROM consultations c
       LEFT JOIN students s ON c.linked_student_id = s.id
       ${whereClause}
       ORDER BY c.preferred_date DESC, c.preferred_time DESC
       LIMIT ? OFFSET ?`,
      params
    );

    // 상태별 통계
    const [stats] = await db.query(
      `SELECT status, COUNT(*) as count
       FROM consultations
       WHERE academy_id = ?
       GROUP BY status`,
      [academyId]
    );

    res.json({
      consultations: consultations.map(c => {
        // JSON 필드가 이미 객체일 수도 있고 문자열일 수도 있음
        let academicScores = null;
        let referralSources = null;

        try {
          academicScores = c.academic_scores
            ? (typeof c.academic_scores === 'string' ? JSON.parse(c.academic_scores) : c.academic_scores)
            : null;
        } catch (e) {
          console.error('academic_scores 파싱 오류:', e);
        }

        try {
          referralSources = c.referral_sources
            ? (typeof c.referral_sources === 'string' ? JSON.parse(c.referral_sources) : c.referral_sources)
            : null;
        } catch (e) {
          console.error('referral_sources 파싱 오류:', e);
        }

        return {
          ...c,
          academicScores,
          referralSources
        };
      }),
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      },
      stats: stats.reduce((acc, s) => {
        acc[s.status] = s.count;
        return acc;
      }, {})
    });
  } catch (error) {
    console.error('상담 목록 조회 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// GET /paca/consultations/:id - 상담 상세 조회
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const academyId = req.user.academy_id;

    const [consultations] = await db.query(
      `SELECT c.*, s.name as linked_student_name, s.grade as linked_student_grade
       FROM consultations c
       LEFT JOIN students s ON c.linked_student_id = s.id
       WHERE c.id = ? AND c.academy_id = ?`,
      [id, academyId]
    );

    if (consultations.length === 0) {
      return res.status(404).json({ error: '상담 신청을 찾을 수 없습니다.' });
    }

    const consultation = consultations[0];

    // JSON 필드 파싱 (이미 객체일 수도 있음)
    let academicScores = null;
    let referralSources = null;

    try {
      academicScores = consultation.academic_scores
        ? (typeof consultation.academic_scores === 'string' ? JSON.parse(consultation.academic_scores) : consultation.academic_scores)
        : null;
    } catch (e) {
      console.error('academic_scores 파싱 오류:', e);
    }

    try {
      referralSources = consultation.referral_sources
        ? (typeof consultation.referral_sources === 'string' ? JSON.parse(consultation.referral_sources) : consultation.referral_sources)
        : null;
    } catch (e) {
      console.error('referral_sources 파싱 오류:', e);
    }

    res.json({
      ...consultation,
      academicScores,
      referralSources
    });
  } catch (error) {
    console.error('상담 상세 조회 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// PUT /paca/consultations/:id - 상담 수정 (상태, 메모, 체크리스트)
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const academyId = req.user.academy_id;
    const { status, adminNotes, preferredDate, preferredTime, checklist, consultationMemo } = req.body;

    // 기존 상담 확인
    const [existing] = await db.query(
      'SELECT id FROM consultations WHERE id = ? AND academy_id = ?',
      [id, academyId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ error: '상담 신청을 찾을 수 없습니다.' });
    }

    const updates = [];
    const params = [];

    if (status) {
      updates.push('status = ?');
      params.push(status);
    }

    if (adminNotes !== undefined) {
      updates.push('admin_notes = ?');
      params.push(adminNotes);
    }

    if (preferredDate) {
      updates.push('preferred_date = ?');
      params.push(preferredDate);
    }

    if (preferredTime) {
      updates.push('preferred_time = ?');
      params.push(preferredTime + ':00');
    }

    // 체크리스트 업데이트
    if (checklist !== undefined) {
      updates.push('checklist = ?');
      params.push(JSON.stringify(checklist));
    }

    // 상담 메모 업데이트
    if (consultationMemo !== undefined) {
      updates.push('consultation_memo = ?');
      params.push(consultationMemo);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: '수정할 내용이 없습니다.' });
    }

    params.push(id);

    await db.query(
      `UPDATE consultations SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    res.json({ message: '상담 정보가 수정되었습니다.' });
  } catch (error) {
    console.error('상담 수정 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// DELETE /paca/consultations/:id - 상담 삭제
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const academyId = req.user.academy_id;

    const [result] = await db.query(
      'DELETE FROM consultations WHERE id = ? AND academy_id = ?',
      [id, academyId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '상담 신청을 찾을 수 없습니다.' });
    }

    res.json({ message: '상담 신청이 삭제되었습니다.' });
  } catch (error) {
    console.error('상담 삭제 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /paca/consultations/direct - 관리자가 직접 상담 등록
router.post('/direct', verifyToken, async (req, res) => {
  try {
    const academyId = req.user.academy_id;
    const { studentName, phone, grade, preferredDate, preferredTime, notes } = req.body;

    // 필수 필드 검증
    if (!studentName || !phone || !grade || !preferredDate || !preferredTime) {
      return res.status(400).json({ error: '학생명, 전화번호, 학년, 상담일시는 필수입니다.' });
    }

    // 상담 등록 (관리자 등록이므로 바로 confirmed 상태)
    const [result] = await db.query(
      `INSERT INTO consultations (
        academy_id, consultation_type, student_name, student_phone, student_grade,
        preferred_date, preferred_time, status, admin_notes,
        checklist, consultation_memo, created_at
      ) VALUES (?, 'new_registration', ?, ?, ?, ?, ?, 'confirmed', ?, '[]', '', NOW())`,
      [
        academyId,
        studentName,
        phone,
        grade,
        preferredDate,
        preferredTime + ':00',
        notes || null
      ]
    );

    res.status(201).json({
      message: '상담이 등록되었습니다.',
      id: result.insertId
    });
  } catch (error) {
    console.error('직접 상담 등록 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /paca/consultations/:id/link-student - 기존 학생과 연결
router.post('/:id/link-student', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const academyId = req.user.academy_id;
    const { studentId } = req.body;

    // 상담 존재 확인
    const [existing] = await db.query(
      'SELECT id FROM consultations WHERE id = ? AND academy_id = ?',
      [id, academyId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ error: '상담 신청을 찾을 수 없습니다.' });
    }

    // 학생 존재 확인
    const [students] = await db.query(
      'SELECT id, name FROM students WHERE id = ? AND academy_id = ?',
      [studentId, academyId]
    );

    if (students.length === 0) {
      return res.status(404).json({ error: '학생을 찾을 수 없습니다.' });
    }

    await db.query(
      'UPDATE consultations SET linked_student_id = ? WHERE id = ?',
      [studentId, id]
    );

    res.json({
      message: '학생이 연결되었습니다.',
      linkedStudent: students[0]
    });
  } catch (error) {
    console.error('학생 연결 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /paca/consultations/:id/convert-to-trial - 상담 완료 → 체험 학생 등록
router.post('/:id/convert-to-trial', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const academyId = req.user.academy_id;
    const { trialDates } = req.body; // [{ date, timeSlot }, { date, timeSlot }]

    // 필수 검증
    if (!trialDates || !Array.isArray(trialDates) || trialDates.length !== 2) {
      return res.status(400).json({ error: '체험 일정 2개를 선택해주세요.' });
    }

    // 상담 정보 조회
    const [consultations] = await db.query(
      'SELECT * FROM consultations WHERE id = ? AND academy_id = ?',
      [id, academyId]
    );

    if (consultations.length === 0) {
      return res.status(404).json({ error: '상담 신청을 찾을 수 없습니다.' });
    }

    const consultation = consultations[0];

    // 이미 체험 학생으로 연결되어 있는지 확인
    if (consultation.linked_student_id) {
      return res.status(400).json({ error: '이미 학생으로 등록되어 있습니다.' });
    }

    // trial_dates JSON 구조
    const trialDatesJson = trialDates.map(d => ({
      date: d.date,
      timeSlot: d.timeSlot,
      attended: false
    }));

    // 체험 학생 등록
    const phone = consultation.student_phone || consultation.parent_phone;
    const [studentResult] = await db.query(
      `INSERT INTO students (
        academy_id, name, grade, phone, status,
        is_trial, trial_remaining, trial_dates, created_at
      ) VALUES (?, ?, ?, ?, 'active', 1, 2, ?, NOW())`,
      [
        academyId,
        consultation.student_name,
        consultation.student_grade,
        phone,
        JSON.stringify(trialDatesJson)
      ]
    );

    const studentId = studentResult.insertId;

    // 상담 상태 업데이트 (completed + 학생 연결)
    await db.query(
      `UPDATE consultations SET status = 'completed', linked_student_id = ? WHERE id = ?`,
      [studentId, id]
    );

    res.json({
      message: '체험 학생으로 등록되었습니다.',
      studentId,
      trialDates: trialDatesJson
    });
  } catch (error) {
    console.error('체험 학생 등록 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ================== 상담 설정 ==================

// GET /paca/consultations/settings - 상담 설정 조회
router.get('/settings/info', verifyToken, async (req, res) => {
  try {
    const academyId = req.user.academy_id;

    // 학원 정보 (slug 포함)
    const [academies] = await db.query(
      'SELECT id, name, slug FROM academies WHERE id = ?',
      [academyId]
    );

    // 상담 설정 조회
    const [settings] = await db.query(
      'SELECT * FROM consultation_settings WHERE academy_id = ?',
      [academyId]
    );

    // 요일별 운영 시간
    const [weeklyHours] = await db.query(
      `SELECT day_of_week, is_available, start_time, end_time
       FROM consultation_weekly_hours
       WHERE academy_id = ?
       ORDER BY day_of_week`,
      [academyId]
    );

    // 차단된 날짜들
    const [blockedSlots] = await db.query(
      `SELECT id, blocked_date, is_all_day, start_time, end_time, reason
       FROM consultation_blocked_slots
       WHERE academy_id = ? AND blocked_date >= CURDATE()
       ORDER BY blocked_date`,
      [academyId]
    );

    const setting = settings[0] || {};

    res.json({
      academy: academies[0],
      settings: {
        isEnabled: setting.is_enabled ?? true,
        pageTitle: setting.page_title || '상담 예약',
        pageDescription: setting.page_description || '',
        slotDuration: setting.slot_duration || 30,
        maxReservationsPerSlot: setting.max_reservations_per_slot || 1,
        advanceDays: setting.advance_days || 30,
        referralSources: setting.referral_sources
          ? (typeof setting.referral_sources === 'string'
              ? JSON.parse(setting.referral_sources)
              : setting.referral_sources)
          : ['블로그/인터넷 검색', '지인 소개', '현수막/전단지', 'SNS', '기타'],
        sendConfirmationAlimtalk: setting.send_confirmation_alimtalk ?? true,
        confirmationTemplateCode: setting.confirmation_template_code || ''
      },
      weeklyHours: weeklyHours.map(h => ({
        dayOfWeek: h.day_of_week,
        isAvailable: h.is_available === 1,
        startTime: h.start_time,
        endTime: h.end_time
      })),
      blockedSlots
    });
  } catch (error) {
    console.error('상담 설정 조회 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// PUT /paca/consultations/settings - 상담 설정 수정
router.put('/settings/info', verifyToken, async (req, res) => {
  try {
    const academyId = req.user.academy_id;
    const {
      slug,
      isEnabled,
      pageTitle,
      pageDescription,
      slotDuration,
      maxReservationsPerSlot,
      advanceDays,
      referralSources,
      sendConfirmationAlimtalk,
      confirmationTemplateCode
    } = req.body;

    // slug 업데이트 (학원 테이블)
    if (slug !== undefined) {
      // slug 유효성 검사
      if (!/^[a-z0-9-]+$/.test(slug)) {
        return res.status(400).json({ error: 'slug는 영문 소문자, 숫자, 하이픈만 사용 가능합니다.' });
      }

      // 중복 체크
      const [existing] = await db.query(
        'SELECT id FROM academies WHERE slug = ? AND id != ?',
        [slug, academyId]
      );

      if (existing.length > 0) {
        return res.status(409).json({ error: '이미 사용 중인 주소입니다.' });
      }

      await db.query('UPDATE academies SET slug = ? WHERE id = ?', [slug, academyId]);
    }

    // 설정 UPSERT
    await db.query(
      `INSERT INTO consultation_settings (
        academy_id, is_enabled, page_title, page_description,
        slot_duration, max_reservations_per_slot, advance_days,
        referral_sources, send_confirmation_alimtalk, confirmation_template_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        is_enabled = VALUES(is_enabled),
        page_title = VALUES(page_title),
        page_description = VALUES(page_description),
        slot_duration = VALUES(slot_duration),
        max_reservations_per_slot = VALUES(max_reservations_per_slot),
        advance_days = VALUES(advance_days),
        referral_sources = VALUES(referral_sources),
        send_confirmation_alimtalk = VALUES(send_confirmation_alimtalk),
        confirmation_template_code = VALUES(confirmation_template_code)`,
      [
        academyId,
        isEnabled ?? true,
        pageTitle || '상담 예약',
        pageDescription || '',
        slotDuration || 30,
        maxReservationsPerSlot || 1,
        advanceDays || 30,
        referralSources ? JSON.stringify(referralSources) : '["블로그/인터넷 검색", "지인 소개", "현수막/전단지", "SNS", "기타"]',
        sendConfirmationAlimtalk ?? true,
        confirmationTemplateCode || null
      ]
    );

    res.json({ message: '설정이 저장되었습니다.' });
  } catch (error) {
    console.error('상담 설정 수정 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// PUT /paca/consultations/settings/weekly-hours - 요일별 운영 시간 수정
router.put('/settings/weekly-hours', verifyToken, async (req, res) => {
  try {
    const academyId = req.user.academy_id;
    const { weeklyHours } = req.body;

    if (!Array.isArray(weeklyHours) || weeklyHours.length !== 7) {
      return res.status(400).json({ error: '7일 치 운영 시간 정보가 필요합니다.' });
    }

    // 기존 데이터 삭제 후 재생성
    await db.query('DELETE FROM consultation_weekly_hours WHERE academy_id = ?', [academyId]);

    for (const hour of weeklyHours) {
      await db.query(
        `INSERT INTO consultation_weekly_hours
         (academy_id, day_of_week, is_available, start_time, end_time)
         VALUES (?, ?, ?, ?, ?)`,
        [
          academyId,
          hour.dayOfWeek,
          hour.isAvailable,
          hour.startTime || null,
          hour.endTime || null
        ]
      );
    }

    res.json({ message: '운영 시간이 저장되었습니다.' });
  } catch (error) {
    console.error('운영 시간 수정 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /paca/consultations/settings/blocked-slots - 시간대 차단 추가
router.post('/settings/blocked-slots', verifyToken, async (req, res) => {
  try {
    const academyId = req.user.academy_id;
    const userId = req.user.id;
    const { blockedDate, isAllDay, startTime, endTime, reason } = req.body;

    if (!blockedDate) {
      return res.status(400).json({ error: '날짜를 선택해주세요.' });
    }

    const [result] = await db.query(
      `INSERT INTO consultation_blocked_slots
       (academy_id, blocked_date, is_all_day, start_time, end_time, reason, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        academyId,
        blockedDate,
        isAllDay ?? true,
        isAllDay ? null : startTime,
        isAllDay ? null : endTime,
        reason || null,
        userId
      ]
    );

    res.status(201).json({
      message: '시간대가 차단되었습니다.',
      id: result.insertId
    });
  } catch (error) {
    console.error('시간대 차단 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// DELETE /paca/consultations/settings/blocked-slots/:id - 시간대 차단 해제
router.delete('/settings/blocked-slots/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const academyId = req.user.academy_id;

    const [result] = await db.query(
      'DELETE FROM consultation_blocked_slots WHERE id = ? AND academy_id = ?',
      [id, academyId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '차단된 시간대를 찾을 수 없습니다.' });
    }

    res.json({ message: '차단이 해제되었습니다.' });
  } catch (error) {
    console.error('차단 해제 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// GET /paca/consultations/calendar - 캘린더용 상담 일정 조회
router.get('/calendar/events', verifyToken, async (req, res) => {
  try {
    const academyId = req.user.academy_id;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: '시작일과 종료일이 필요합니다.' });
    }

    const [consultations] = await db.query(
      `SELECT id, student_name, parent_name, preferred_date, preferred_time, status, consultation_type
       FROM consultations
       WHERE academy_id = ? AND preferred_date >= ? AND preferred_date <= ?
       ORDER BY preferred_date, preferred_time`,
      [academyId, startDate, endDate]
    );

    // 날짜별로 그룹화
    const eventsByDate = consultations.reduce((acc, c) => {
      const date = c.preferred_date;
      if (!acc[date]) {
        acc[date] = [];
      }
      acc[date].push(c);
      return acc;
    }, {});

    res.json({ events: eventsByDate });
  } catch (error) {
    console.error('캘린더 조회 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

module.exports = router;
