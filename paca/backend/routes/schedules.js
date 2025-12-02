const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken, requireRole, checkPermission } = require('../middleware/auth');
const { updateSalaryFromAttendance } = require('../utils/salaryCalculator');

/**
 * GET /paca/schedules
 * Get class schedules (for calendar view)
 * Access: owner, admin, teacher
 */
router.get('/', verifyToken, async (req, res) => {
    try {
        const { start_date, end_date, instructor_id, time_slot } = req.query;

        let query = `
            SELECT
                cs.id,
                cs.class_date,
                cs.time_slot,
                cs.instructor_id,
                cs.title,
                cs.content,
                cs.attendance_taken,
                cs.notes,
                cs.created_at,
                i.name AS instructor_name,
                (SELECT COUNT(DISTINCT a.student_id) FROM attendance a
                 JOIN students s ON a.student_id = s.id AND s.deleted_at IS NULL
                 WHERE a.class_schedule_id = cs.id) AS student_count
            FROM class_schedules cs
            LEFT JOIN instructors i ON cs.instructor_id = i.id
            WHERE cs.academy_id = ?
        `;

        const params = [req.user.academyId];

        // Date range filter
        if (start_date) {
            query += ' AND cs.class_date >= ?';
            params.push(start_date);
        }

        if (end_date) {
            query += ' AND cs.class_date <= ?';
            params.push(end_date);
        }

        // Instructor filter
        if (instructor_id) {
            query += ' AND cs.instructor_id = ?';
            params.push(parseInt(instructor_id));
        }

        // Time slot filter
        if (time_slot && ['morning', 'afternoon', 'evening'].includes(time_slot)) {
            query += ' AND cs.time_slot = ?';
            params.push(time_slot);
        }

        query += ' ORDER BY cs.class_date ASC, cs.time_slot ASC';

        const [schedules] = await db.query(query, params);

        res.json({
            message: `Found ${schedules.length} schedules`,
            schedules
        });
    } catch (error) {
        console.error('Error fetching schedules:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch schedules'
        });
    }
});

/**
 * GET /paca/schedules/instructor/:instructor_id
 * Get schedules for specific instructor
 * Access: owner, admin, teacher
 */
router.get('/instructor/:instructor_id', verifyToken, async (req, res) => {
    const instructorId = parseInt(req.params.instructor_id);

    try {
        const { start_date, end_date } = req.query;

        // Verify instructor belongs to academy
        const [instructors] = await db.query(
            'SELECT id, name FROM instructors WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
            [instructorId, req.user.academyId]
        );

        if (instructors.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Instructor not found'
            });
        }

        let query = `
            SELECT
                cs.id,
                cs.class_date,
                cs.time_slot,
                cs.title,
                cs.content,
                cs.attendance_taken,
                cs.notes
            FROM class_schedules cs
            WHERE cs.academy_id = ?
            AND cs.instructor_id = ?
        `;

        const params = [req.user.academyId, instructorId];

        if (start_date) {
            query += ' AND cs.class_date >= ?';
            params.push(start_date);
        }

        if (end_date) {
            query += ' AND cs.class_date <= ?';
            params.push(end_date);
        }

        query += ' ORDER BY cs.class_date ASC, cs.time_slot ASC';

        const [schedules] = await db.query(query, params);

        res.json({
            message: `Found ${schedules.length} schedules for ${instructors[0].name}`,
            instructor: instructors[0],
            schedules
        });
    } catch (error) {
        console.error('Error fetching instructor schedules:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch instructor schedules'
        });
    }
});

// ==========================================
// 타임슬롯 관련 API (/:id 보다 먼저 정의해야 함)
// ==========================================

/**
 * GET /paca/schedules/slot
 * 특정 날짜/타임슬롯의 정보 조회
 * Query: date, time_slot
 */
router.get('/slot', verifyToken, async (req, res) => {
    try {
        const { date, time_slot } = req.query;

        if (!date || !time_slot) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'date and time_slot are required'
            });
        }

        // 해당 슬롯의 스케줄 조회
        const [schedules] = await db.query(
            `SELECT cs.*, i.name as instructor_name
             FROM class_schedules cs
             LEFT JOIN instructors i ON cs.instructor_id = i.id
             WHERE cs.academy_id = ? AND cs.class_date = ? AND cs.time_slot = ?`,
            [req.user.academyId, date, time_slot]
        );

        const schedule = schedules[0] || null;

        // 스케줄이 있으면 배정된 학생 조회 (시즌 정보 포함)
        let students = [];
        if (schedule) {
            const [attendanceRecords] = await db.query(
                `SELECT DISTINCT a.student_id, s.name as student_name, a.attendance_status,
                        (SELECT se2.season_type
                         FROM student_seasons ss2
                         JOIN seasons se2 ON ss2.season_id = se2.id
                         WHERE ss2.student_id = s.id
                         AND ss2.is_cancelled = 0
                         AND ss2.payment_status != 'cancelled'
                         AND se2.status = 'active'
                         AND ? BETWEEN se2.season_start_date AND se2.season_end_date
                         LIMIT 1) as season_type
                 FROM attendance a
                 JOIN students s ON a.student_id = s.id
                 WHERE a.class_schedule_id = ?
                 AND s.deleted_at IS NULL
                 ORDER BY season_type IS NOT NULL DESC, s.name`,
                [date, schedule.id]
            );
            students = attendanceRecords;
        }

        // 해당 요일에 수업이 있는 학생 중 아직 배정되지 않은 학생 조회
        // class_days는 숫자 배열로 저장됨 (0=일, 1=월, 2=화, ...)
        const dayOfWeek = new Date(date + 'T00:00:00').getDay();

        const [availableStudents] = await db.query(
            `SELECT s.id, s.name, s.grade, s.student_type, s.class_days
             FROM students s
             WHERE s.academy_id = ?
             AND s.status = 'active'
             AND s.deleted_at IS NULL
             AND JSON_CONTAINS(s.class_days, ?)
             AND s.id NOT IN (
                SELECT a.student_id FROM attendance a
                JOIN class_schedules cs ON a.class_schedule_id = cs.id
                WHERE cs.class_date = ? AND cs.academy_id = ?
             )
             ORDER BY s.name`,
            [req.user.academyId, JSON.stringify(dayOfWeek), date, req.user.academyId]
        );

        res.json({
            schedule: schedule ? { ...schedule, students } : null,
            available_students: availableStudents
        });
    } catch (error) {
        console.error('Error fetching slot data:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch slot data'
        });
    }
});

/**
 * POST /paca/schedules/slot/student
 * 학생을 특정 슬롯에 추가
 */
router.post('/slot/student', verifyToken, checkPermission('schedules', 'edit'), async (req, res) => {
    try {
        const { date, time_slot, student_id } = req.body;

        if (!date || !time_slot || !student_id) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'date, time_slot, and student_id are required'
            });
        }

        // 해당 슬롯의 스케줄 조회 또는 생성
        let [schedules] = await db.query(
            `SELECT id FROM class_schedules
             WHERE academy_id = ? AND class_date = ? AND time_slot = ?`,
            [req.user.academyId, date, time_slot]
        );

        let scheduleId;
        if (schedules.length === 0) {
            // 스케줄이 없으면 생성
            const [result] = await db.query(
                `INSERT INTO class_schedules (academy_id, class_date, time_slot, attendance_taken)
                 VALUES (?, ?, ?, false)`,
                [req.user.academyId, date, time_slot]
            );
            scheduleId = result.insertId;
        } else {
            scheduleId = schedules[0].id;
        }

        // 이미 배정되어 있는지 확인
        const [existing] = await db.query(
            `SELECT id FROM attendance
             WHERE class_schedule_id = ? AND student_id = ?`,
            [scheduleId, student_id]
        );

        if (existing.length > 0) {
            return res.status(400).json({
                error: 'Bad Request',
                message: '이미 해당 수업에 배정된 학생입니다.'
            });
        }

        // 출석 기록 생성
        await db.query(
            `INSERT INTO attendance (class_schedule_id, student_id, attendance_status)
             VALUES (?, ?, NULL)`,
            [scheduleId, student_id]
        );

        res.json({ message: '학생이 배정되었습니다.' });
    } catch (error) {
        console.error('Error adding student to slot:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to add student to slot'
        });
    }
});

/**
 * DELETE /paca/schedules/slot/student
 * 학생을 특정 슬롯에서 제거
 */
router.delete('/slot/student', verifyToken, checkPermission('schedules', 'edit'), async (req, res) => {
    try {
        const { date, time_slot, student_id } = req.query;

        if (!date || !time_slot || !student_id) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'date, time_slot, and student_id are required'
            });
        }

        // 해당 슬롯의 스케줄 조회
        const [schedules] = await db.query(
            `SELECT id FROM class_schedules
             WHERE academy_id = ? AND class_date = ? AND time_slot = ?`,
            [req.user.academyId, date, time_slot]
        );

        if (schedules.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: '해당 수업을 찾을 수 없습니다.'
            });
        }

        // 출석 기록 삭제
        await db.query(
            `DELETE FROM attendance
             WHERE class_schedule_id = ? AND student_id = ?`,
            [schedules[0].id, student_id]
        );

        res.json({ message: '학생이 제거되었습니다.' });
    } catch (error) {
        console.error('Error removing student from slot:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to remove student from slot'
        });
    }
});

/**
 * POST /paca/schedules/slot/move
 * 학생을 다른 슬롯으로 이동
 */
router.post('/slot/move', verifyToken, checkPermission('schedules', 'edit'), async (req, res) => {
    try {
        const { date, from_slot, to_slot, student_id } = req.body;

        if (!date || !from_slot || !to_slot || !student_id) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'date, from_slot, to_slot, and student_id are required'
            });
        }

        // 출발 슬롯 스케줄 조회
        const [fromSchedules] = await db.query(
            `SELECT id FROM class_schedules
             WHERE academy_id = ? AND class_date = ? AND time_slot = ?`,
            [req.user.academyId, date, from_slot]
        );

        if (fromSchedules.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: '출발 수업을 찾을 수 없습니다.'
            });
        }

        // 도착 슬롯 스케줄 조회 또는 생성
        let [toSchedules] = await db.query(
            `SELECT id FROM class_schedules
             WHERE academy_id = ? AND class_date = ? AND time_slot = ?`,
            [req.user.academyId, date, to_slot]
        );

        let toScheduleId;
        if (toSchedules.length === 0) {
            // 스케줄 생성
            const [result] = await db.query(
                `INSERT INTO class_schedules (academy_id, class_date, time_slot, attendance_taken)
                 VALUES (?, ?, ?, false)`,
                [req.user.academyId, date, to_slot]
            );
            toScheduleId = result.insertId;
        } else {
            toScheduleId = toSchedules[0].id;
        }

        // 출석 기록 이동 (class_schedule_id 변경)
        await db.query(
            `UPDATE attendance
             SET class_schedule_id = ?
             WHERE class_schedule_id = ? AND student_id = ?`,
            [toScheduleId, fromSchedules[0].id, student_id]
        );

        res.json({ message: '학생이 이동되었습니다.' });
    } catch (error) {
        console.error('Error moving student:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to move student'
        });
    }
});

/**
 * GET /paca/schedules/:id
 * Get schedule details
 * Access: owner, admin, teacher
 */
router.get('/:id', verifyToken, async (req, res) => {
    const scheduleId = parseInt(req.params.id);

    try {
        const [schedules] = await db.query(
            `SELECT
                cs.*,
                i.name AS instructor_name,
                i.phone AS instructor_phone
            FROM class_schedules cs
            LEFT JOIN instructors i ON cs.instructor_id = i.id
            WHERE cs.id = ?
            AND cs.academy_id = ?`,
            [scheduleId, req.user.academyId]
        );

        if (schedules.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Schedule not found'
            });
        }

        res.json({
            message: 'Schedule found',
            schedule: schedules[0]
        });
    } catch (error) {
        console.error('Error fetching schedule:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch schedule'
        });
    }
});

/**
 * POST /paca/schedules/bulk
 * Create multiple schedules at once (일괄 스케줄 생성)
 * 시즌 기반, 반 기반, 또는 학생 수업요일 기반으로 생성 가능
 * Access: owner, admin only
 */
router.post('/bulk', verifyToken, checkPermission('schedules', 'edit'), async (req, res) => {
    const connection = await db.getConnection();

    try {
        const { class_id, season_id, target_grade, year, month, weekdays, excluded_dates, time_slot, time_slots, title, mode } = req.body;

        // 모드 확인: 'season', 'class', 'student' (학생 수업요일 기반)
        const isSeasonBased = mode === 'season' || (!!season_id && !mode);
        const isClassBased = mode === 'class' || (!!class_id && !season_id && !mode);
        const isStudentBased = mode === 'student';

        // 어느 모드도 아닌 경우
        if (!isSeasonBased && !isClassBased && !isStudentBased) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'mode, class_id, 또는 season_id가 필요합니다'
            });
        }

        let targetDates = [];
        let scheduleTitle = title || '수업';
        let useTimeSlot = time_slot || 'evening';
        let useClassId = class_id || null;
        let useSeasonId = null;
        let useTargetGrade = null;

        if (isSeasonBased) {
            // 시즌 기반 생성 - target_grade 필수
            if (!target_grade) {
                connection.release();
                return res.status(400).json({
                    error: 'Validation Error',
                    message: '시즌 기반 스케줄 생성 시 target_grade(고3, N수)가 필요합니다'
                });
            }

            const [seasons] = await connection.query(
                `SELECT id, season_name, season_start_date, season_end_date, operating_days, grade_time_slots
                FROM seasons WHERE id = ? AND academy_id = ?`,
                [season_id, req.user.academyId]
            );

            if (seasons.length === 0) {
                connection.release();
                return res.status(404).json({
                    error: 'Not Found',
                    message: '시즌을 찾을 수 없습니다'
                });
            }

            const season = seasons[0];
            useSeasonId = season.id;
            useTargetGrade = target_grade;
            scheduleTitle = title || `${season.season_name} ${target_grade}`;

            // 학년별 시간대 설정이 있으면 적용
            if (season.grade_time_slots && !time_slot) {
                try {
                    const gradeSlots = typeof season.grade_time_slots === 'string'
                        ? JSON.parse(season.grade_time_slots)
                        : season.grade_time_slots;
                    if (gradeSlots[target_grade]) {
                        useTimeSlot = gradeSlots[target_grade];
                    }
                } catch {
                    // 파싱 실패 시 기본값 사용
                }
            }

            // Parse operating_days
            let operatingDays = [];
            try {
                operatingDays = typeof season.operating_days === 'string'
                    ? JSON.parse(season.operating_days)
                    : (season.operating_days || []);
            } catch {
                operatingDays = [];
            }

            if (operatingDays.length === 0) {
                connection.release();
                return res.status(400).json({
                    error: 'Validation Error',
                    message: '시즌에 운영 요일이 설정되지 않았습니다'
                });
            }

            // 시즌 기간 내 운영 요일에 해당하는 날짜들 계산
            const startDate = new Date(season.season_start_date + 'T00:00:00');
            const endDate = new Date(season.season_end_date + 'T00:00:00');
            const excludedSet = new Set(excluded_dates || []);

            for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                const dayOfWeek = d.getDay();
                if (operatingDays.includes(dayOfWeek)) {
                    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    if (!excludedSet.has(dateStr)) {
                        targetDates.push(dateStr);
                    }
                }
            }
        } else if (isStudentBased) {
            // 학생 수업요일 기반 생성 (새로운 모드)
            if (!year || !month) {
                connection.release();
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'year, month가 필요합니다'
                });
            }

            // 해당 학원의 활성 학생들의 수업요일 조회
            const [students] = await connection.query(
                `SELECT DISTINCT s.class_days
                FROM students s
                WHERE s.academy_id = ?
                AND s.status = 'active'
                AND s.deleted_at IS NULL
                AND s.class_days IS NOT NULL`,
                [req.user.academyId]
            );

            if (students.length === 0) {
                connection.release();
                return res.status(400).json({
                    error: 'Validation Error',
                    message: '활성 학생이 없거나 수업요일이 설정되지 않았습니다'
                });
            }

            // 모든 학생의 수업요일을 합집합으로
            const allWeekdays = new Set();
            for (const student of students) {
                try {
                    const days = typeof student.class_days === 'string'
                        ? JSON.parse(student.class_days)
                        : (student.class_days || []);
                    if (Array.isArray(days)) {
                        days.forEach(d => allWeekdays.add(d));
                    }
                } catch {
                    // 파싱 실패 무시
                }
            }

            if (allWeekdays.size === 0) {
                connection.release();
                return res.status(400).json({
                    error: 'Validation Error',
                    message: '학생들의 수업요일이 설정되지 않았습니다'
                });
            }

            scheduleTitle = title || `${month}월 수업`;
            useTimeSlot = time_slot || 'evening';

            // 해당 월의 수업요일에 맞는 날짜들 계산
            const firstDay = new Date(year, month - 1, 1);
            const lastDay = new Date(year, month, 0);
            const excludedSet = new Set(excluded_dates || []);

            for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
                const dayOfWeek = d.getDay();
                if (allWeekdays.has(dayOfWeek)) {
                    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    if (!excludedSet.has(dateStr)) {
                        targetDates.push(dateStr);
                    }
                }
            }
        } else {
            // 반 기반 생성 (기존 로직)
            if (!year || !month || !Array.isArray(weekdays) || weekdays.length === 0) {
                connection.release();
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'year, month, weekdays가 필요합니다'
                });
            }

            // class_id가 있으면 반 정보 조회
            if (class_id) {
                const [classes] = await connection.query(
                    'SELECT id, class_name, default_time_slot FROM classes WHERE id = ? AND academy_id = ?',
                    [class_id, req.user.academyId]
                );

                if (classes.length === 0) {
                    connection.release();
                    return res.status(404).json({
                        error: 'Not Found',
                        message: '반을 찾을 수 없습니다'
                    });
                }

                const classInfo = classes[0];
                scheduleTitle = title || classInfo.class_name;
                useTimeSlot = time_slot || classInfo.default_time_slot || 'evening';
            } else {
                // 반 없이 요일 기반으로 생성
                scheduleTitle = title || `${month}월 수업`;
                useTimeSlot = time_slot || 'evening';
            }

            // 해당 월의 요일에 맞는 날짜들 계산
            const firstDay = new Date(year, month - 1, 1);
            const lastDay = new Date(year, month, 0);
            const excludedSet = new Set(excluded_dates || []);

            for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
                const dayOfWeek = d.getDay();
                if (weekdays.includes(dayOfWeek)) {
                    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    if (!excludedSet.has(dateStr)) {
                        targetDates.push(dateStr);
                    }
                }
            }
        }

        if (targetDates.length === 0) {
            connection.release();
            return res.status(400).json({
                error: 'Validation Error',
                message: '생성할 날짜가 없습니다'
            });
        }

        // 시즌 모드에서 복수 시간대 지원
        const timeSlotsToCreate = (isSeasonBased && Array.isArray(time_slots) && time_slots.length > 0)
            ? time_slots
            : [useTimeSlot];

        // Start transaction
        await connection.beginTransaction();

        const createdSchedules = [];
        const skippedDates = [];

        for (const dateStr of targetDates) {
            for (const slotToCreate of timeSlotsToCreate) {
                // Check for existing schedule on this date and time slot
                const [existing] = await connection.query(
                    'SELECT id FROM class_schedules WHERE academy_id = ? AND class_date = ? AND time_slot = ?',
                    [req.user.academyId, dateStr, slotToCreate]
                );

                if (existing.length > 0) {
                    skippedDates.push(`${dateStr}_${slotToCreate}`);
                    continue;
                }

                // Create schedule with season_id and target_grade
                const [result] = await connection.query(
                    `INSERT INTO class_schedules
                    (academy_id, class_id, season_id, target_grade, class_date, time_slot, instructor_id, title)
                    VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
                    [req.user.academyId, useClassId, useSeasonId, useTargetGrade, dateStr, slotToCreate, scheduleTitle]
                );

                createdSchedules.push({
                    id: result.insertId,
                    class_date: dateStr,
                    time_slot: slotToCreate
                });
            }
        }

        await connection.commit();
        connection.release();

        res.status(201).json({
            message: `${createdSchedules.length}개 스케줄 생성 완료`,
            season_id: season_id || null,
            class_id: useClassId,
            title: scheduleTitle,
            created_count: createdSchedules.length,
            skipped_count: skippedDates.length,
            skipped_dates: skippedDates,
            schedules: createdSchedules
        });
    } catch (error) {
        await connection.rollback();
        connection.release();
        console.error('Error creating bulk schedules:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to create schedules'
        });
    }
});

/**
 * POST /paca/schedules
 * Create new class schedule
 * instructor_id는 선택사항 (나중에 배정 가능)
 * Access: owner, admin only
 */
router.post('/', verifyToken, checkPermission('schedules', 'edit'), async (req, res) => {
    try {
        const { class_date, time_slot, instructor_id, title, content, notes } = req.body;

        // Validation - instructor_id는 선택사항
        if (!class_date || !time_slot) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'class_date and time_slot are required'
            });
        }

        // Validate time_slot
        if (!['morning', 'afternoon', 'evening'].includes(time_slot)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'time_slot must be morning, afternoon, or evening'
            });
        }

        // Validate date format (YYYY-MM-DD)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(class_date)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'class_date must be in YYYY-MM-DD format'
            });
        }

        // Verify instructor exists if provided
        if (instructor_id) {
            const [instructors] = await db.query(
                'SELECT id FROM instructors WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
                [instructor_id, req.user.academyId]
            );

            if (instructors.length === 0) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: 'Instructor not found or does not belong to your academy'
                });
            }
        }

        // Check for duplicate schedule (same date, time_slot)
        const [existing] = await db.query(
            `SELECT id FROM class_schedules
            WHERE academy_id = ?
            AND class_date = ?
            AND time_slot = ?`,
            [req.user.academyId, class_date, time_slot]
        );

        if (existing.length > 0) {
            return res.status(409).json({
                error: 'Conflict',
                message: 'A schedule already exists at this date and time'
            });
        }

        // Create schedule (instructor_id can be null)
        const [result] = await db.query(
            `INSERT INTO class_schedules
            (academy_id, class_date, time_slot, instructor_id, title, content, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [req.user.academyId, class_date, time_slot, instructor_id || null, title || null, content || null, notes || null]
        );

        // Fetch created schedule
        const [newSchedule] = await db.query(
            `SELECT cs.*, i.name AS instructor_name
            FROM class_schedules cs
            LEFT JOIN instructors i ON cs.instructor_id = i.id
            WHERE cs.id = ?`,
            [result.insertId]
        );

        res.status(201).json({
            message: 'Schedule created successfully',
            schedule: newSchedule[0]
        });
    } catch (error) {
        console.error('Error creating schedule:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to create schedule'
        });
    }
});

/**
 * PUT /paca/schedules/:id/assign-instructor
 * Assign instructor to a schedule (강사 배정)
 * Access: owner, admin only
 */
router.put('/:id/assign-instructor', verifyToken, checkPermission('schedules', 'edit'), async (req, res) => {
    const scheduleId = parseInt(req.params.id);

    try {
        const { instructor_id, time_slots } = req.body;

        // Check if schedule exists
        const [schedules] = await db.query(
            'SELECT id, class_date, time_slot FROM class_schedules WHERE id = ? AND academy_id = ?',
            [scheduleId, req.user.academyId]
        );

        if (schedules.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Schedule not found'
            });
        }

        // Validate instructor if provided
        if (instructor_id) {
            const [instructors] = await db.query(
                'SELECT id, name FROM instructors WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
                [instructor_id, req.user.academyId]
            );

            if (instructors.length === 0) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: 'Instructor not found'
                });
            }
        }

        // Update schedule with instructor
        await db.query(
            'UPDATE class_schedules SET instructor_id = ? WHERE id = ?',
            [instructor_id || null, scheduleId]
        );

        // If time_slots array provided, create/update instructor attendance records
        if (Array.isArray(time_slots) && time_slots.length > 0 && instructor_id) {
            const schedule = schedules[0];

            for (const slot of time_slots) {
                if (!['morning', 'afternoon', 'evening'].includes(slot)) continue;

                // UPSERT instructor attendance
                await db.query(
                    `INSERT INTO instructor_attendance
                    (instructor_id, class_schedule_id, work_date, time_slot, attendance_status)
                    VALUES (?, ?, ?, ?, 'present')
                    ON DUPLICATE KEY UPDATE
                    class_schedule_id = VALUES(class_schedule_id),
                    attendance_status = 'present',
                    updated_at = CURRENT_TIMESTAMP`,
                    [instructor_id, scheduleId, schedule.class_date, slot]
                );
            }
        }

        // Fetch updated schedule
        const [updated] = await db.query(
            `SELECT cs.*, i.name AS instructor_name
            FROM class_schedules cs
            LEFT JOIN instructors i ON cs.instructor_id = i.id
            WHERE cs.id = ?`,
            [scheduleId]
        );

        res.json({
            message: 'Instructor assigned successfully',
            schedule: updated[0]
        });
    } catch (error) {
        console.error('Error assigning instructor:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to assign instructor'
        });
    }
});

/**
 * PUT /paca/schedules/:id
 * Update class schedule
 * Access: owner, admin only
 */
router.put('/:id', verifyToken, checkPermission('schedules', 'edit'), async (req, res) => {
    const scheduleId = parseInt(req.params.id);

    try {
        const { class_date, time_slot, instructor_id, title, content, notes } = req.body;

        // Check if schedule exists
        const [schedules] = await db.query(
            'SELECT id FROM class_schedules WHERE id = ? AND academy_id = ?',
            [scheduleId, req.user.academyId]
        );

        if (schedules.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Schedule not found'
            });
        }

        // Validate time_slot if provided
        if (time_slot && !['morning', 'afternoon', 'evening'].includes(time_slot)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'time_slot must be morning, afternoon, or evening'
            });
        }

        // Verify instructor if provided
        if (instructor_id) {
            const [instructors] = await db.query(
                'SELECT id FROM instructors WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
                [instructor_id, req.user.academyId]
            );

            if (instructors.length === 0) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: 'Instructor not found'
                });
            }
        }

        // Build update query dynamically
        const updates = [];
        const params = [];

        if (class_date !== undefined) {
            updates.push('class_date = ?');
            params.push(class_date);
        }
        if (time_slot !== undefined) {
            updates.push('time_slot = ?');
            params.push(time_slot);
        }
        if (instructor_id !== undefined) {
            updates.push('instructor_id = ?');
            params.push(instructor_id);
        }
        if (title !== undefined) {
            updates.push('title = ?');
            params.push(title);
        }
        if (content !== undefined) {
            updates.push('content = ?');
            params.push(content);
        }
        if (notes !== undefined) {
            updates.push('notes = ?');
            params.push(notes);
        }

        if (updates.length === 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'No fields to update'
            });
        }

        params.push(scheduleId);

        await db.query(
            `UPDATE class_schedules SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        // Fetch updated schedule
        const [updated] = await db.query(
            `SELECT cs.*, i.name AS instructor_name
            FROM class_schedules cs
            LEFT JOIN instructors i ON cs.instructor_id = i.id
            WHERE cs.id = ?`,
            [scheduleId]
        );

        res.json({
            message: 'Schedule updated successfully',
            schedule: updated[0]
        });
    } catch (error) {
        console.error('Error updating schedule:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to update schedule'
        });
    }
});

/**
 * DELETE /paca/schedules/:id
 * Delete class schedule
 * Access: owner, admin only
 */
router.delete('/:id', verifyToken, checkPermission('schedules', 'edit'), async (req, res) => {
    const scheduleId = parseInt(req.params.id);

    try {
        // Check if schedule exists
        const [schedules] = await db.query(
            'SELECT id FROM class_schedules WHERE id = ? AND academy_id = ?',
            [scheduleId, req.user.academyId]
        );

        if (schedules.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Schedule not found'
            });
        }

        // Delete schedule (CASCADE will delete attendance records)
        await db.query('DELETE FROM class_schedules WHERE id = ?', [scheduleId]);

        res.json({
            message: 'Schedule deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting schedule:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to delete schedule'
        });
    }
});

/**
 * GET /paca/schedules/:id/attendance
 * Get attendance status for a specific class
 *
 * 동적 조회 방식:
 * 1. 스케줄 날짜 기준으로 활성 시즌 확인
 * 2. 시즌이 있으면 → 해당 시즌에 등록된 학생 중 시간대에 맞는 학년 학생 조회
 * 3. 시즌이 없으면 → class_days 매칭 학생 조회 (고1, 고2, 공무원/성인)
 *
 * Access: owner, admin, teacher
 */
router.get('/:id/attendance', verifyToken, async (req, res) => {
    const scheduleId = parseInt(req.params.id);

    try {
        // Get schedule details
        const [schedules] = await db.query(
            `SELECT
                cs.id,
                cs.class_date,
                cs.time_slot,
                cs.title,
                cs.attendance_taken,
                i.name AS instructor_name
            FROM class_schedules cs
            LEFT JOIN instructors i ON cs.instructor_id = i.id
            WHERE cs.id = ?
            AND cs.academy_id = ?`,
            [scheduleId, req.user.academyId]
        );

        if (schedules.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Schedule not found'
            });
        }

        const schedule = schedules[0];
        const classDateStr = typeof schedule.class_date === 'string'
            ? schedule.class_date
            : schedule.class_date.toISOString().split('T')[0];
        const classDate = new Date(classDateStr + 'T00:00:00');
        const dayOfWeek = classDate.getDay();

        let students = [];
        let seasonInfo = null;

        // 1. 스케줄 날짜에 활성화된 시즌 찾기
        const [activeSeasons] = await db.query(
            `SELECT id, season_name, season_type, grade_time_slots, operating_days
            FROM seasons
            WHERE academy_id = ?
            AND status = 'active'
            AND season_start_date <= ?
            AND season_end_date >= ?`,
            [req.user.academyId, classDateStr, classDateStr]
        );

        if (activeSeasons.length > 0) {
            // 시즌 기간 내 - 시즌 등록 학생 조회
            const season = activeSeasons[0];
            const gradeTimeSlots = typeof season.grade_time_slots === 'string'
                ? JSON.parse(season.grade_time_slots)
                : season.grade_time_slots;

            // 현재 시간대에 맞는 학년 찾기
            let targetGrades = [];
            if (gradeTimeSlots) {
                for (const [grade, timeSlot] of Object.entries(gradeTimeSlots)) {
                    if (timeSlot === schedule.time_slot) {
                        targetGrades.push(grade);
                    }
                }
            }

            // 해당 시간대에 배정된 학년이 없으면 모든 시즌 등록 학생
            if (targetGrades.length === 0) {
                targetGrades = ['고3', 'N수'];
            }

            seasonInfo = {
                id: season.id,
                season_name: season.season_name,
                season_type: season.season_type,
                target_grades: targetGrades
            };

            // 시즌에 등록된 학생 중 해당 학년 학생 조회
            const [seasonStudents] = await db.query(
                `SELECT
                    s.id AS student_id,
                    s.name AS student_name,
                    s.student_number,
                    s.student_type,
                    s.grade,
                    s.class_days,
                    ss.id AS season_registration_id,
                    a.attendance_status,
                    a.makeup_date,
                    a.notes AS attendance_notes
                FROM students s
                INNER JOIN student_seasons ss ON ss.student_id = s.id AND ss.season_id = ?
                LEFT JOIN attendance a ON a.student_id = s.id AND a.class_schedule_id = ?
                WHERE s.academy_id = ?
                AND s.status = 'active'
                AND s.deleted_at IS NULL
                AND ss.payment_status != 'cancelled'
                AND s.grade IN (?)
                ORDER BY s.name ASC`,
                [season.id, scheduleId, req.user.academyId, targetGrades]
            );

            students = seasonStudents;
        }

        // 2. 비시즌 또는 시즌 학생 외에 class_days 매칭 학생도 조회 (고1, 고2, 공무원/성인)
        // 시즌에 등록되지 않은 학생 중 해당 요일에 수업 있는 학생
        const [regularStudents] = await db.query(
            `SELECT
                s.id AS student_id,
                s.name AS student_name,
                s.student_number,
                s.student_type,
                s.grade,
                s.class_days,
                NULL AS season_registration_id,
                a.attendance_status,
                a.makeup_date,
                a.notes AS attendance_notes
            FROM students s
            LEFT JOIN student_seasons ss ON ss.student_id = s.id
                AND ss.payment_status != 'cancelled'
                AND ss.season_id IN (
                    SELECT id FROM seasons
                    WHERE academy_id = ? AND status = 'active'
                    AND season_start_date <= ? AND season_end_date >= ?
                )
            LEFT JOIN attendance a ON a.student_id = s.id AND a.class_schedule_id = ?
            WHERE s.academy_id = ?
            AND s.status = 'active'
            AND s.deleted_at IS NULL
            AND ss.id IS NULL
            AND JSON_CONTAINS(s.class_days, ?)
            ORDER BY s.name ASC`,
            [req.user.academyId, classDateStr, classDateStr, scheduleId, req.user.academyId, JSON.stringify(dayOfWeek)]
        );

        // 기존 학생 ID Set 생성
        const existingIds = new Set(students.map(s => s.student_id));
        // 중복 제거하며 추가
        for (const student of regularStudents) {
            if (!existingIds.has(student.student_id)) {
                students.push(student);
            }
        }

        // 3. Get students who have makeup scheduled for this date
        const [makeupStudents] = await db.query(
            `SELECT
                s.id AS student_id,
                s.name AS student_name,
                s.student_number,
                s.student_type,
                a.attendance_status AS original_status,
                cs.class_date AS original_date,
                a.notes AS attendance_notes
            FROM attendance a
            INNER JOIN students s ON a.student_id = s.id
            INNER JOIN class_schedules cs ON a.class_schedule_id = cs.id
            WHERE a.makeup_date = ?
            AND a.attendance_status = 'makeup'
            AND s.academy_id = ?
            AND s.status = 'active'
            AND s.deleted_at IS NULL
            ORDER BY s.name ASC`,
            [classDateStr, req.user.academyId]
        );

        // 4. Create student list with attendance info
        const studentsWithInfo = students.map(student => ({
            student_id: student.student_id,
            student_name: student.student_name,
            student_number: student.student_number,
            student_type: student.student_type,
            attendance_status: student.attendance_status || null,
            makeup_date: student.makeup_date || null,
            notes: student.attendance_notes || '',
            is_expected: true,
            is_makeup: false,
            is_season_student: !!student.season_registration_id
        }));

        // 5. Add makeup students (avoid duplicates)
        const existingStudentIds = new Set(studentsWithInfo.map(s => s.student_id));
        for (const makeup of makeupStudents) {
            if (!existingStudentIds.has(makeup.student_id)) {
                const originalDateStr = typeof makeup.original_date === 'string'
                    ? makeup.original_date
                    : makeup.original_date?.toISOString().split('T')[0];
                studentsWithInfo.push({
                    student_id: makeup.student_id,
                    student_name: makeup.student_name,
                    student_number: makeup.student_number,
                    student_type: makeup.student_type,
                    attendance_status: 'present', // 보충으로 온 학생은 기본적으로 출석 처리 제안
                    makeup_date: null,
                    notes: makeup.attendance_notes || '',
                    is_expected: false,
                    is_makeup: true,
                    original_date: originalDateStr,
                    is_season_student: false
                });
            }
        }

        res.json({
            message: 'Attendance records retrieved',
            schedule: {
                id: schedule.id,
                class_date: schedule.class_date,
                time_slot: schedule.time_slot,
                instructor_name: schedule.instructor_name,
                title: schedule.title,
                attendance_taken: schedule.attendance_taken
            },
            season: seasonInfo ? {
                id: seasonInfo.id,
                season_name: seasonInfo.season_name,
                season_type: seasonInfo.season_type,
                target_grades: seasonInfo.target_grades
            } : null,
            students: studentsWithInfo
        });
    } catch (error) {
        console.error('Error fetching attendance:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch attendance records'
        });
    }
});

/**
 * POST /paca/schedules/:id/attendance
 * Take attendance for a class
 * Access: owner, admin, teacher
 */
router.post('/:id/attendance', verifyToken, async (req, res) => {
    const scheduleId = parseInt(req.params.id);
    const connection = await db.getConnection();

    try {
        const { attendance_records } = req.body;

        // Validation
        if (!Array.isArray(attendance_records) || attendance_records.length === 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'attendance_records must be a non-empty array'
            });
        }

        // Check if schedule exists
        const [schedules] = await connection.query(
            'SELECT id, class_date FROM class_schedules WHERE id = ? AND academy_id = ?',
            [scheduleId, req.user.academyId]
        );

        if (schedules.length === 0) {
            connection.release();
            return res.status(404).json({
                error: 'Not Found',
                message: 'Schedule not found'
            });
        }

        const schedule = schedules[0];

        // Start transaction
        await connection.beginTransaction();

        const validStatuses = ['present', 'absent', 'late', 'excused', 'makeup'];
        const processedRecords = [];

        for (const record of attendance_records) {
            const { student_id, attendance_status, makeup_date, notes } = record;

            // Validate attendance_status
            if (!validStatuses.includes(attendance_status)) {
                await connection.rollback();
                connection.release();
                return res.status(400).json({
                    error: 'Validation Error',
                    message: `Invalid attendance_status: ${attendance_status}. Must be one of: ${validStatuses.join(', ')}`
                });
            }

            // Validate makeup_date if status is makeup
            if (attendance_status === 'makeup') {
                if (!makeup_date) {
                    await connection.rollback();
                    connection.release();
                    return res.status(400).json({
                        error: 'Validation Error',
                        message: 'makeup_date is required when attendance_status is makeup'
                    });
                }
                // Validate date format
                const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
                if (!dateRegex.test(makeup_date)) {
                    await connection.rollback();
                    connection.release();
                    return res.status(400).json({
                        error: 'Validation Error',
                        message: 'makeup_date must be in YYYY-MM-DD format'
                    });
                }
            }

            // Verify student exists and belongs to academy
            const [students] = await connection.query(
                'SELECT id, name FROM students WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
                [student_id, req.user.academyId]
            );

            if (students.length === 0) {
                await connection.rollback();
                connection.release();
                return res.status(404).json({
                    error: 'Not Found',
                    message: `Student with ID ${student_id} not found`
                });
            }

            // UPSERT attendance record with makeup_date
            await connection.query(
                `INSERT INTO attendance
                (class_schedule_id, student_id, attendance_status, makeup_date, notes, recorded_by)
                VALUES (?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                attendance_status = VALUES(attendance_status),
                makeup_date = VALUES(makeup_date),
                notes = VALUES(notes),
                recorded_by = VALUES(recorded_by),
                updated_at = CURRENT_TIMESTAMP`,
                [scheduleId, student_id, attendance_status, attendance_status === 'makeup' ? makeup_date : null, notes || null, req.user.id]
            );

            processedRecords.push({
                student_id,
                student_name: students[0].name,
                attendance_status,
                makeup_date: attendance_status === 'makeup' ? makeup_date : null,
                notes: notes || ''
            });
        }

        // Mark attendance as taken
        await connection.query(
            'UPDATE class_schedules SET attendance_taken = true WHERE id = ?',
            [scheduleId]
        );

        // Commit transaction
        await connection.commit();
        connection.release();

        res.json({
            message: `Attendance recorded for ${processedRecords.length} students`,
            schedule_id: scheduleId,
            class_date: schedule.class_date,
            attendance_records: processedRecords
        });
    } catch (error) {
        await connection.rollback();
        connection.release();
        console.error('Error recording attendance:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to record attendance'
        });
    }
});

/**
 * GET /paca/schedules/:id/instructor-attendance
 * Get instructor attendance for a specific schedule
 * Access: owner, admin, teacher
 */
router.get('/:id/instructor-attendance', verifyToken, async (req, res) => {
    const scheduleId = parseInt(req.params.id);

    try {
        // Get schedule details
        const [schedules] = await db.query(
            `SELECT
                cs.id,
                cs.class_date,
                cs.time_slot,
                cs.instructor_id,
                i.name AS instructor_name
            FROM class_schedules cs
            LEFT JOIN instructors i ON cs.instructor_id = i.id
            WHERE cs.id = ?
            AND cs.academy_id = ?`,
            [scheduleId, req.user.academyId]
        );

        if (schedules.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Schedule not found'
            });
        }

        const schedule = schedules[0];

        // Get instructor attendance records for this date
        const [attendances] = await db.query(
            `SELECT
                ia.id,
                ia.instructor_id,
                i.name AS instructor_name,
                ia.time_slot,
                ia.attendance_status,
                ia.check_in_time,
                ia.check_out_time,
                ia.notes
            FROM instructor_attendance ia
            JOIN instructors i ON ia.instructor_id = i.id
            WHERE ia.work_date = ?
            AND i.academy_id = ?
            ORDER BY ia.time_slot, i.name`,
            [schedule.class_date, req.user.academyId]
        );

        res.json({
            message: 'Instructor attendance retrieved',
            schedule: {
                id: schedule.id,
                class_date: schedule.class_date,
                time_slot: schedule.time_slot,
                instructor_id: schedule.instructor_id,
                instructor_name: schedule.instructor_name
            },
            attendances
        });
    } catch (error) {
        console.error('Error fetching instructor attendance:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch instructor attendance'
        });
    }
});

/**
 * POST /paca/schedules/:id/instructor-attendance
 * Record instructor attendance for a schedule
 * Access: owner, admin
 */
router.post('/:id/instructor-attendance', verifyToken, checkPermission('schedules', 'edit'), async (req, res) => {
    const scheduleId = parseInt(req.params.id);
    const connection = await db.getConnection();

    try {
        const { attendances } = req.body;

        // Validation
        if (!Array.isArray(attendances) || attendances.length === 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'attendances must be a non-empty array'
            });
        }

        // Check if schedule exists
        const [schedules] = await connection.query(
            'SELECT id, class_date, time_slot FROM class_schedules WHERE id = ? AND academy_id = ?',
            [scheduleId, req.user.academyId]
        );

        if (schedules.length === 0) {
            connection.release();
            return res.status(404).json({
                error: 'Not Found',
                message: 'Schedule not found'
            });
        }

        const schedule = schedules[0];

        await connection.beginTransaction();

        const validStatuses = ['present', 'absent', 'late', 'half_day'];
        const processedRecords = [];

        for (const record of attendances) {
            const { instructor_id, time_slot, attendance_status, check_in_time, check_out_time, notes } = record;

            // Validate attendance_status
            if (!validStatuses.includes(attendance_status)) {
                await connection.rollback();
                connection.release();
                return res.status(400).json({
                    error: 'Validation Error',
                    message: `Invalid attendance_status: ${attendance_status}. Must be one of: ${validStatuses.join(', ')}`
                });
            }

            // Validate time_slot
            const useTimeSlot = time_slot || schedule.time_slot;
            if (!['morning', 'afternoon', 'evening'].includes(useTimeSlot)) {
                await connection.rollback();
                connection.release();
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'Invalid time_slot'
                });
            }

            // Verify instructor exists
            const [instructors] = await connection.query(
                'SELECT id, name FROM instructors WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
                [instructor_id, req.user.academyId]
            );

            if (instructors.length === 0) {
                await connection.rollback();
                connection.release();
                return res.status(404).json({
                    error: 'Not Found',
                    message: `Instructor with ID ${instructor_id} not found`
                });
            }

            // UPSERT instructor attendance record
            await connection.query(
                `INSERT INTO instructor_attendance
                (instructor_id, work_date, time_slot, attendance_status, check_in_time, check_out_time, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                attendance_status = VALUES(attendance_status),
                check_in_time = VALUES(check_in_time),
                check_out_time = VALUES(check_out_time),
                notes = VALUES(notes),
                updated_at = CURRENT_TIMESTAMP`,
                [instructor_id, schedule.class_date, useTimeSlot, attendance_status, check_in_time || null, check_out_time || null, notes || null]
            );

            processedRecords.push({
                instructor_id,
                instructor_name: instructors[0].name,
                time_slot: useTimeSlot,
                attendance_status,
                check_in_time,
                check_out_time
            });

            // 급여 자동 계산/업데이트
            await updateSalaryFromAttendance(connection, instructor_id, req.user.academyId, schedule.class_date, attendance_status);
        }

        await connection.commit();
        connection.release();

        res.json({
            message: `Instructor attendance recorded for ${processedRecords.length} records`,
            schedule_id: scheduleId,
            class_date: schedule.class_date,
            attendance_records: processedRecords
        });
    } catch (error) {
        await connection.rollback();
        connection.release();
        console.error('Error recording instructor attendance:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to record instructor attendance'
        });
    }
});

/**
 * GET /paca/schedules/date/:date/instructor-attendance
 * Get instructor attendance for a specific date
 * 배정된 강사만 해당 타임슬롯에 표시
 * Access: owner, admin, teacher
 */
router.get('/date/:date/instructor-attendance', verifyToken, async (req, res) => {
    const workDate = req.params.date;

    try {
        // Validate date format
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(workDate)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Date must be in YYYY-MM-DD format'
            });
        }

        // Get ALL active instructors for this academy (참고용)
        const [allActiveInstructors] = await db.query(
            `SELECT id, name, salary_type
            FROM instructors
            WHERE academy_id = ?
            AND status = 'active'
            AND deleted_at IS NULL
            ORDER BY name`,
            [req.user.academyId]
        );

        // 해당 날짜에 배정된 강사 조회 (instructor_schedules 테이블)
        const [scheduledInstructors] = await db.query(
            `SELECT
                isched.instructor_id,
                isched.time_slot,
                isched.scheduled_start_time,
                isched.scheduled_end_time,
                i.name,
                i.salary_type,
                'scheduled' as source
            FROM instructor_schedules isched
            JOIN instructors i ON isched.instructor_id = i.id
            WHERE isched.academy_id = ?
            AND isched.work_date = ?
            AND i.deleted_at IS NULL
            ORDER BY isched.time_slot, i.name`,
            [req.user.academyId, workDate]
        );

        // 승인된 미배정 출근 강사 조회 (overtime_approvals 테이블)
        const [approvedExtraDays] = await db.query(
            `SELECT
                oa.instructor_id,
                oa.time_slot,
                oa.original_end_time as scheduled_start_time,
                oa.actual_end_time as scheduled_end_time,
                i.name,
                i.salary_type,
                'approved' as source
            FROM overtime_approvals oa
            JOIN instructors i ON oa.instructor_id = i.id
            WHERE oa.academy_id = ?
            AND oa.work_date = ?
            AND oa.request_type = 'extra_day'
            AND oa.status = 'approved'
            AND i.deleted_at IS NULL
            ORDER BY oa.time_slot, i.name`,
            [req.user.academyId, workDate]
        );

        // 타임슬롯별로 강사 그룹화 (배정 + 승인된 강사)
        const instructorsBySlot = {
            morning: [],
            afternoon: [],
            evening: []
        };

        // 배정된 강사 추가
        scheduledInstructors.forEach(s => {
            instructorsBySlot[s.time_slot].push({
                id: s.instructor_id,
                name: s.name,
                salary_type: s.salary_type,
                scheduled_start_time: s.scheduled_start_time,
                scheduled_end_time: s.scheduled_end_time,
                source: 'scheduled'
            });
        });

        // 승인된 미배정 출근 강사 추가 (중복 체크)
        approvedExtraDays.forEach(s => {
            if (s.time_slot) {
                const existing = instructorsBySlot[s.time_slot].find(i => i.id === s.instructor_id);
                if (!existing) {
                    instructorsBySlot[s.time_slot].push({
                        id: s.instructor_id,
                        name: s.name,
                        salary_type: s.salary_type,
                        scheduled_start_time: s.scheduled_start_time,
                        scheduled_end_time: s.scheduled_end_time,
                        source: 'approved'  // 승인된 미배정 출근
                    });
                }
            }
        });

        // Get existing attendance records for this date
        const [attendances] = await db.query(
            `SELECT
                ia.id,
                ia.instructor_id,
                i.name AS instructor_name,
                ia.time_slot,
                ia.attendance_status,
                ia.check_in_time,
                ia.check_out_time,
                ia.notes
            FROM instructor_attendance ia
            JOIN instructors i ON ia.instructor_id = i.id
            WHERE ia.work_date = ?
            AND i.academy_id = ?
            ORDER BY ia.time_slot, i.name`,
            [workDate, req.user.academyId]
        );

        res.json({
            message: 'Instructor attendance retrieved',
            date: workDate,
            attendances,
            instructors: allActiveInstructors,  // 전체 강사 목록 (참고용)
            instructors_by_slot: instructorsBySlot  // 배정된 강사만
        });
    } catch (error) {
        console.error('Error fetching instructor attendance by date:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch instructor attendance'
        });
    }
});

/**
 * POST /paca/schedules/date/:date/instructor-attendance
 * Record instructor attendance for a specific date (without schedule)
 * Access: owner, admin, staff (with schedules edit permission)
 */
router.post('/date/:date/instructor-attendance', verifyToken, checkPermission('schedules', 'edit'), async (req, res) => {
    const workDate = req.params.date;
    const connection = await db.getConnection();

    try {
        const { attendances } = req.body;

        // Validate date format
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(workDate)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Date must be in YYYY-MM-DD format'
            });
        }

        if (!Array.isArray(attendances) || attendances.length === 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'attendances must be a non-empty array'
            });
        }

        await connection.beginTransaction();

        const validStatuses = ['present', 'absent', 'late', 'half_day'];
        const processedRecords = [];

        for (const record of attendances) {
            const { instructor_id, time_slot, attendance_status, check_in_time, check_out_time, notes } = record;

            if (!validStatuses.includes(attendance_status)) {
                await connection.rollback();
                connection.release();
                return res.status(400).json({
                    error: 'Validation Error',
                    message: `Invalid attendance_status: ${attendance_status}`
                });
            }

            if (!['morning', 'afternoon', 'evening'].includes(time_slot)) {
                await connection.rollback();
                connection.release();
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'Invalid time_slot'
                });
            }

            const [instructors] = await connection.query(
                'SELECT id, name FROM instructors WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
                [instructor_id, req.user.academyId]
            );

            if (instructors.length === 0) {
                await connection.rollback();
                connection.release();
                return res.status(404).json({
                    error: 'Not Found',
                    message: `Instructor with ID ${instructor_id} not found`
                });
            }

            await connection.query(
                `INSERT INTO instructor_attendance
                (instructor_id, work_date, time_slot, attendance_status, check_in_time, check_out_time, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                attendance_status = VALUES(attendance_status),
                check_in_time = VALUES(check_in_time),
                check_out_time = VALUES(check_out_time),
                notes = VALUES(notes),
                updated_at = CURRENT_TIMESTAMP`,
                [instructor_id, workDate, time_slot, attendance_status, check_in_time || null, check_out_time || null, notes || null]
            );

            processedRecords.push({
                instructor_id,
                instructor_name: instructors[0].name,
                time_slot,
                attendance_status
            });

            // 급여 자동 계산/업데이트
            await updateSalaryFromAttendance(connection, instructor_id, req.user.academyId, workDate, attendance_status);
        }

        await connection.commit();
        connection.release();

        res.json({
            message: `Instructor attendance recorded for ${processedRecords.length} records`,
            date: workDate,
            attendance_records: processedRecords
        });
    } catch (error) {
        await connection.rollback();
        connection.release();
        console.error('Error recording instructor attendance:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to record instructor attendance'
        });
    }
});

// ==========================================
// 강사 근무 일정 배정 API
// ==========================================

/**
 * GET /paca/schedules/date/:date/instructor-schedules
 * 특정 날짜의 강사 근무 일정 조회
 * Access: owner, admin, staff (with schedules view permission)
 */
router.get('/date/:date/instructor-schedules', verifyToken, checkPermission('schedules', 'view'), async (req, res) => {
    const workDate = req.params.date;

    try {
        // Validate date format
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(workDate)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Date must be in YYYY-MM-DD format'
            });
        }

        // 모든 활성 강사 조회
        const [instructors] = await db.query(
            `SELECT id, name, salary_type, hourly_rate
             FROM instructors
             WHERE academy_id = ? AND status = 'active' AND deleted_at IS NULL
             ORDER BY name`,
            [req.user.academyId]
        );

        // 해당 날짜의 배정된 일정 조회
        const [schedules] = await db.query(
            `SELECT
                isched.id,
                isched.instructor_id,
                isched.time_slot,
                isched.scheduled_start_time,
                isched.scheduled_end_time,
                i.name as instructor_name,
                i.salary_type
             FROM instructor_schedules isched
             JOIN instructors i ON isched.instructor_id = i.id
             WHERE isched.academy_id = ?
             AND isched.work_date = ?
             ORDER BY isched.time_slot, i.name`,
            [req.user.academyId, workDate]
        );

        // 타임슬롯별로 그룹화
        const schedulesBySlot = {
            morning: [],
            afternoon: [],
            evening: []
        };

        schedules.forEach(s => {
            schedulesBySlot[s.time_slot].push({
                id: s.id,
                instructor_id: s.instructor_id,
                instructor_name: s.instructor_name,
                salary_type: s.salary_type,
                scheduled_start_time: s.scheduled_start_time,
                scheduled_end_time: s.scheduled_end_time
            });
        });

        res.json({
            message: 'Instructor schedules retrieved',
            date: workDate,
            instructors,
            schedules: schedulesBySlot
        });
    } catch (error) {
        console.error('Error fetching instructor schedules:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch instructor schedules'
        });
    }
});

/**
 * POST /paca/schedules/date/:date/instructor-schedules
 * 특정 날짜의 강사 근무 일정 저장 (전체 교체 방식)
 * Body: { schedules: [{ instructor_id, time_slot, scheduled_start_time?, scheduled_end_time? }] }
 * Access: owner, admin, staff (with schedules edit permission)
 */
router.post('/date/:date/instructor-schedules', verifyToken, checkPermission('schedules', 'edit'), async (req, res) => {
    const workDate = req.params.date;
    const connection = await db.getConnection();

    try {
        const { schedules } = req.body;

        // Validate date format
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(workDate)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Date must be in YYYY-MM-DD format'
            });
        }

        if (!Array.isArray(schedules)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'schedules must be an array'
            });
        }

        await connection.beginTransaction();

        // 해당 날짜의 기존 일정 삭제
        await connection.query(
            'DELETE FROM instructor_schedules WHERE academy_id = ? AND work_date = ?',
            [req.user.academyId, workDate]
        );

        // 새 일정 추가
        const validSlots = ['morning', 'afternoon', 'evening'];
        const insertedSchedules = [];

        for (const schedule of schedules) {
            const { instructor_id, time_slot, scheduled_start_time, scheduled_end_time } = schedule;

            if (!instructor_id || !time_slot) continue;

            if (!validSlots.includes(time_slot)) {
                await connection.rollback();
                connection.release();
                return res.status(400).json({
                    error: 'Validation Error',
                    message: `Invalid time_slot: ${time_slot}`
                });
            }

            // 강사 확인
            const [instructors] = await connection.query(
                'SELECT id, name FROM instructors WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
                [instructor_id, req.user.academyId]
            );

            if (instructors.length === 0) {
                await connection.rollback();
                connection.release();
                return res.status(404).json({
                    error: 'Not Found',
                    message: `Instructor with ID ${instructor_id} not found`
                });
            }

            await connection.query(
                `INSERT INTO instructor_schedules
                (academy_id, instructor_id, work_date, time_slot, scheduled_start_time, scheduled_end_time, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    req.user.academyId,
                    instructor_id,
                    workDate,
                    time_slot,
                    scheduled_start_time || null,
                    scheduled_end_time || null,
                    req.user.id
                ]
            );

            insertedSchedules.push({
                instructor_id,
                instructor_name: instructors[0].name,
                time_slot,
                scheduled_start_time,
                scheduled_end_time
            });
        }

        await connection.commit();
        connection.release();

        res.json({
            message: `Instructor schedules saved for ${workDate}`,
            date: workDate,
            schedules: insertedSchedules
        });
    } catch (error) {
        await connection.rollback();
        connection.release();
        console.error('Error saving instructor schedules:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to save instructor schedules'
        });
    }
});

/**
 * GET /paca/schedules/instructor-schedules/month
 * 특정 월의 모든 강사 일정 조회 (캘린더용)
 * Query: year, month
 * Returns: 날짜별 슬롯별 배정 인원 + 출근 인원 (1/5 형식으로 표시 가능)
 * Access: owner, admin, staff (with schedules view permission)
 */
router.get('/instructor-schedules/month', verifyToken, checkPermission('schedules', 'view'), async (req, res) => {
    const { year, month } = req.query;

    try {
        if (!year || !month) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'year and month are required'
            });
        }

        const yearMonth = `${year}-${String(month).padStart(2, '0')}`;

        // 배정된 강사 수 조회 (instructor_schedules)
        const [scheduledCounts] = await db.query(
            `SELECT
                isched.work_date,
                isched.time_slot,
                COUNT(DISTINCT isched.instructor_id) as scheduled_count
             FROM instructor_schedules isched
             WHERE isched.academy_id = ?
             AND DATE_FORMAT(isched.work_date, '%Y-%m') = ?
             GROUP BY isched.work_date, isched.time_slot
             ORDER BY isched.work_date, isched.time_slot`,
            [req.user.academyId, yearMonth]
        );

        // 출근한 강사 수 조회 (attendance_status가 present, late, half_day인 경우)
        const [attendedCounts] = await db.query(
            `SELECT
                ia.work_date,
                ia.time_slot,
                COUNT(DISTINCT ia.instructor_id) as attended_count
             FROM instructor_attendance ia
             JOIN instructors i ON ia.instructor_id = i.id
             WHERE i.academy_id = ?
             AND DATE_FORMAT(ia.work_date, '%Y-%m') = ?
             AND ia.attendance_status IN ('present', 'late', 'half_day')
             GROUP BY ia.work_date, ia.time_slot
             ORDER BY ia.work_date, ia.time_slot`,
            [req.user.academyId, yearMonth]
        );

        // 날짜별 → 슬롯별 데이터 매핑
        const scheduleMap = {};

        // 배정 인원 매핑
        scheduledCounts.forEach(s => {
            // dateStrings: true 설정으로 이미 문자열일 수 있음
            const dateStr = typeof s.work_date === 'string'
                ? s.work_date.split('T')[0]
                : s.work_date.toISOString().split('T')[0];
            if (!scheduleMap[dateStr]) {
                scheduleMap[dateStr] = {
                    morning: { scheduled: 0, attended: 0 },
                    afternoon: { scheduled: 0, attended: 0 },
                    evening: { scheduled: 0, attended: 0 }
                };
            }
            scheduleMap[dateStr][s.time_slot].scheduled = s.scheduled_count;
        });

        // 출근 인원 매핑
        attendedCounts.forEach(a => {
            const dateStr = typeof a.work_date === 'string'
                ? a.work_date.split('T')[0]
                : a.work_date.toISOString().split('T')[0];
            if (!scheduleMap[dateStr]) {
                scheduleMap[dateStr] = {
                    morning: { scheduled: 0, attended: 0 },
                    afternoon: { scheduled: 0, attended: 0 },
                    evening: { scheduled: 0, attended: 0 }
                };
            }
            scheduleMap[dateStr][a.time_slot].attended = a.attended_count;
        });

        res.json({
            message: 'Monthly instructor schedules retrieved',
            year_month: yearMonth,
            schedules: scheduleMap
        });
    } catch (error) {
        console.error('Error fetching monthly instructor schedules:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch monthly instructor schedules'
        });
    }
});

/**
 * POST /paca/schedules/fix-all
 * 잘못된 스케줄 일괄 정리 (owner 전용)
 * - morning/afternoon 시간대 스케줄 삭제 (시즌 학생 제외)
 * - 수업요일 불일치 스케줄 삭제
 * - evening 시간대로 재배정
 */
router.post('/fix-all', verifyToken, requireRole('owner'), async (req, res) => {
    const connection = await db.getConnection();

    try {
        const results = {
            deleted_attendance: 0,
            deleted_empty_schedules: 0,
            created_schedules: 0,
            assigned_attendance: 0,
            details: []
        };

        // 1. 잘못된 스케줄 조회 (일반 학생의 morning/afternoon 또는 요일 불일치)
        const [wrongSchedules] = await connection.query(`
            SELECT
                a.id as attendance_id,
                a.student_id,
                s.name as student_name,
                s.grade,
                s.class_days,
                cs.id as schedule_id,
                cs.class_date,
                cs.time_slot,
                DAYOFWEEK(cs.class_date) - 1 as day_of_week
            FROM attendance a
            JOIN class_schedules cs ON a.class_schedule_id = cs.id
            JOIN students s ON a.student_id = s.id
            LEFT JOIN student_seasons ss ON s.id = ss.student_id AND ss.is_cancelled = 0
            WHERE cs.academy_id = ?
            AND cs.class_date >= CURDATE()
            AND s.status = 'active'
            AND s.deleted_at IS NULL
            AND ss.id IS NULL
            AND a.attendance_status IS NULL
            AND (
                cs.time_slot IN ('morning', 'afternoon')
                OR NOT JSON_CONTAINS(COALESCE(s.class_days, '[]'), CAST(DAYOFWEEK(cs.class_date) - 1 AS CHAR))
            )
            ORDER BY s.name, cs.class_date
        `, [req.user.academyId]);

        results.details.push(`발견된 잘못된 스케줄: ${wrongSchedules.length}개`);

        // 2. 잘못된 출석 기록 삭제
        if (wrongSchedules.length > 0) {
            const attendanceIds = wrongSchedules.map(w => w.attendance_id);
            const [deleteResult] = await connection.query(
                `DELETE FROM attendance WHERE id IN (?)`,
                [attendanceIds]
            );
            results.deleted_attendance = deleteResult.affectedRows;
        }

        // 3. 빈 스케줄 삭제
        const [emptyScheduleResult] = await connection.query(`
            DELETE cs FROM class_schedules cs
            LEFT JOIN attendance a ON cs.id = a.class_schedule_id
            WHERE cs.academy_id = ?
            AND a.id IS NULL
            AND cs.class_date >= CURDATE()
        `, [req.user.academyId]);
        results.deleted_empty_schedules = emptyScheduleResult.affectedRows;

        // 4. 올바른 스케줄로 재배정
        const [activeStudents] = await connection.query(`
            SELECT s.id, s.name, s.academy_id, s.class_days
            FROM students s
            LEFT JOIN student_seasons ss ON s.id = ss.student_id AND ss.is_cancelled = 0
            WHERE s.academy_id = ?
            AND s.status = 'active'
            AND s.deleted_at IS NULL
            AND s.class_days IS NOT NULL
            AND s.class_days != '[]'
            AND ss.id IS NULL
        `, [req.user.academyId]);

        results.details.push(`재배정 대상 학생: ${activeStudents.length}명`);

        for (const student of activeStudents) {
            const classDays = typeof student.class_days === 'string'
                ? JSON.parse(student.class_days)
                : student.class_days;

            if (!Array.isArray(classDays) || classDays.length === 0) continue;

            const today = new Date();
            const year = today.getFullYear();
            const month = today.getMonth();
            const lastDay = new Date(year, month + 1, 0).getDate();

            for (let day = today.getDate(); day <= lastDay; day++) {
                const currentDate = new Date(year, month, day);
                const dayOfWeek = currentDate.getDay();

                if (classDays.includes(dayOfWeek)) {
                    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

                    // evening 스케줄 조회 또는 생성
                    let [schedules] = await connection.query(
                        `SELECT id FROM class_schedules
                         WHERE academy_id = ? AND class_date = ? AND time_slot = 'evening'`,
                        [student.academy_id, dateStr]
                    );

                    let scheduleId;
                    if (schedules.length === 0) {
                        const [result] = await connection.query(
                            `INSERT INTO class_schedules (academy_id, class_date, time_slot, attendance_taken)
                             VALUES (?, ?, 'evening', false)`,
                            [student.academy_id, dateStr]
                        );
                        scheduleId = result.insertId;
                        results.created_schedules++;
                    } else {
                        scheduleId = schedules[0].id;
                    }

                    // 이미 배정되어 있는지 확인
                    const [existing] = await connection.query(
                        `SELECT id FROM attendance WHERE class_schedule_id = ? AND student_id = ?`,
                        [scheduleId, student.id]
                    );

                    if (existing.length === 0) {
                        await connection.query(
                            `INSERT INTO attendance (class_schedule_id, student_id, attendance_status)
                             VALUES (?, ?, NULL)`,
                            [scheduleId, student.id]
                        );
                        results.assigned_attendance++;
                    }
                }
            }
        }

        connection.release();

        res.json({
            message: '스케줄 정리 완료',
            results
        });

    } catch (error) {
        connection.release();
        console.error('Error fixing schedules:', error);
        res.status(500).json({
            error: 'Server Error',
            message: error.message || 'Failed to fix schedules'
        });
    }
});

module.exports = router;
