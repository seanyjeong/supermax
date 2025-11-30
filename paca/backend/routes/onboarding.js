/**
 * 온보딩 API 라우트
 * - 온보딩 상태 확인
 * - 온보딩 완료 처리
 * - 샘플 데이터 생성
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken, requireRole } = require('../middleware/auth');

/**
 * GET /paca/onboarding/status
 * 온보딩 완료 여부 확인
 */
router.get('/status', verifyToken, async (req, res) => {
    try {
        const [settings] = await db.query(
            `SELECT onboarding_completed, onboarding_completed_at
             FROM academy_settings
             WHERE academy_id = ?`,
            [req.user.academyId]
        );

        if (settings.length === 0) {
            return res.json({
                onboarding_completed: false,
                onboarding_completed_at: null
            });
        }

        res.json({
            onboarding_completed: settings[0].onboarding_completed || false,
            onboarding_completed_at: settings[0].onboarding_completed_at
        });
    } catch (error) {
        console.error('Get onboarding status error:', error);
        res.status(500).json({ error: 'Server Error', message: '온보딩 상태 확인에 실패했습니다.' });
    }
});

/**
 * GET /paca/onboarding/data
 * 온보딩에 필요한 기존 데이터 조회 (학원 정보, 설정 등)
 */
router.get('/data', verifyToken, async (req, res) => {
    try {
        // 학원 기본 정보
        const [academy] = await db.query(
            `SELECT id, name, phone, address, business_number
             FROM academies
             WHERE id = ?`,
            [req.user.academyId]
        );

        // 학원 설정
        const [settings] = await db.query(
            `SELECT morning_class_time, afternoon_class_time, evening_class_time,
                    tuition_due_day, salary_payment_day, salary_month_type, settings
             FROM academy_settings
             WHERE academy_id = ?`,
            [req.user.academyId]
        );

        res.json({
            academy: academy[0] || {},
            settings: settings[0] || {}
        });
    } catch (error) {
        console.error('Get onboarding data error:', error);
        res.status(500).json({ error: 'Server Error', message: '온보딩 데이터 조회에 실패했습니다.' });
    }
});

/**
 * POST /paca/onboarding/complete
 * 온보딩 완료 처리 (모든 설정 저장)
 */
router.post('/complete', verifyToken, requireRole('owner'), async (req, res) => {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const {
            // Step 1: 학원 기본 정보
            academy_name,
            phone,
            address,
            business_number,
            // Step 2: 수업 시간대
            morning_class_time,
            afternoon_class_time,
            evening_class_time,
            // Step 3: 학원비
            tuition_settings,
            // Step 4: 급여
            salary_payment_day,
            salary_month_type,
            tuition_due_day
        } = req.body;

        // 학원 기본 정보 업데이트
        await connection.query(
            `UPDATE academies
             SET name = ?, phone = ?, address = ?, business_number = ?
             WHERE id = ?`,
            [academy_name, phone || null, address || null, business_number || null, req.user.academyId]
        );

        // 학원 설정 업데이트
        await connection.query(
            `UPDATE academy_settings
             SET morning_class_time = ?,
                 afternoon_class_time = ?,
                 evening_class_time = ?,
                 salary_payment_day = ?,
                 salary_month_type = ?,
                 tuition_due_day = ?,
                 settings = ?,
                 onboarding_completed = TRUE,
                 onboarding_completed_at = NOW()
             WHERE academy_id = ?`,
            [
                morning_class_time || '09:30-12:00',
                afternoon_class_time || '14:00-18:00',
                evening_class_time || '18:30-21:00',
                salary_payment_day || 10,
                salary_month_type || 'next',
                tuition_due_day || 5,
                tuition_settings ? JSON.stringify(tuition_settings) : null,
                req.user.academyId
            ]
        );

        await connection.commit();

        res.json({
            success: true,
            message: '온보딩이 완료되었습니다.'
        });
    } catch (error) {
        await connection.rollback();
        console.error('Complete onboarding error:', error);
        res.status(500).json({ error: 'Server Error', message: '온보딩 완료 처리에 실패했습니다.' });
    } finally {
        connection.release();
    }
});

/**
 * POST /paca/onboarding/sample-data
 * 샘플 데이터 생성
 */
router.post('/sample-data', verifyToken, requireRole('owner'), async (req, res) => {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();
        const academyId = req.user.academyId;
        const createdData = {
            students: [],
            instructors: [],
            seasons: []
        };

        // 샘플 강사 생성
        const instructors = [
            { name: '박코치', phone: '010-1234-5678', employment_type: 'full_time', base_salary: 3000000, hourly_rate: null },
            { name: '최트레이너', phone: '010-8765-4321', employment_type: 'part_time', base_salary: null, hourly_rate: 30000 }
        ];

        for (const instructor of instructors) {
            const [result] = await connection.query(
                `INSERT INTO instructors (academy_id, name, phone, employment_type, base_salary, hourly_rate, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
                [academyId, instructor.name, instructor.phone, instructor.employment_type, instructor.base_salary, instructor.hourly_rate]
            );
            createdData.instructors.push({ id: result.insertId, name: instructor.name });
        }

        // 샘플 학생 생성
        const students = [
            { name: '홍길동', phone: '010-1111-2222', school: '서울고등학교', grade: '고3', student_type: 'exam', weekly_sessions: 5 },
            { name: '김영희', phone: '010-3333-4444', school: '한국고등학교', grade: '고2', student_type: 'exam', weekly_sessions: 3 },
            { name: '이철수', phone: '010-5555-6666', school: null, grade: '성인', student_type: 'adult', weekly_sessions: 2 }
        ];

        for (const student of students) {
            const [result] = await connection.query(
                `INSERT INTO students (academy_id, name, phone, school, grade, student_type, weekly_sessions, status, enrollment_date)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'active', CURDATE())`,
                [academyId, student.name, student.phone, student.school, student.grade, student.student_type, student.weekly_sessions]
            );
            createdData.students.push({ id: result.insertId, name: student.name });
        }

        // 샘플 시즌 생성
        const currentYear = new Date().getFullYear();
        const [seasonResult] = await connection.query(
            `INSERT INTO seasons (academy_id, name, season_type, season_start_date, season_end_date, is_active, time_slots)
             VALUES (?, ?, 'regular', ?, ?, FALSE, ?)`,
            [
                academyId,
                `${currentYear} 겨울 시즌`,
                `${currentYear}-12-01`,
                `${currentYear + 1}-02-28`,
                JSON.stringify(['morning', 'afternoon', 'evening'])
            ]
        );
        createdData.seasons.push({ id: seasonResult.insertId, name: `${currentYear} 겨울 시즌` });

        await connection.commit();

        res.json({
            success: true,
            message: '샘플 데이터가 생성되었습니다.',
            data: createdData
        });
    } catch (error) {
        await connection.rollback();
        console.error('Create sample data error:', error);
        res.status(500).json({ error: 'Server Error', message: '샘플 데이터 생성에 실패했습니다.' });
    } finally {
        connection.release();
    }
});

/**
 * POST /paca/onboarding/skip
 * 온보딩 건너뛰기 (기존 사용자용)
 */
router.post('/skip', verifyToken, requireRole('owner'), async (req, res) => {
    try {
        await db.query(
            `UPDATE academy_settings
             SET onboarding_completed = TRUE, onboarding_completed_at = NOW()
             WHERE academy_id = ?`,
            [req.user.academyId]
        );

        res.json({
            success: true,
            message: '온보딩을 건너뛰었습니다.'
        });
    } catch (error) {
        console.error('Skip onboarding error:', error);
        res.status(500).json({ error: 'Server Error', message: '온보딩 건너뛰기에 실패했습니다.' });
    }
});

module.exports = router;
