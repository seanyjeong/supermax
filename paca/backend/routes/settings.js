const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken, requireRole, checkPermission } = require('../middleware/auth');

/**
 * GET /paca/settings
 * Get academy settings
 * Access: owner, admin, teacher
 */
router.get('/', verifyToken, async (req, res) => {
    try {
        const [settings] = await db.query(
            `SELECT
                s.*,
                a.name AS academy_name,
                a.business_number,
                a.address AS academy_address,
                a.phone AS academy_phone,
                a.email AS academy_email,
                a.operating_hours
            FROM academy_settings s
            JOIN academies a ON s.academy_id = a.id
            WHERE s.academy_id = ?`,
            [req.user.academyId]
        );

        if (settings.length === 0) {
            // If settings don't exist, return default values
            const [academy] = await db.query(
                'SELECT * FROM academies WHERE id = ?',
                [req.user.academyId]
            );

            if (academy.length === 0) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: 'Academy not found'
                });
            }

            return res.json({
                message: 'Settings not configured yet (using defaults)',
                settings: {
                    academy_id: req.user.academyId,
                    academy_name: academy[0].name,
                    academy_address: academy[0].address,
                    academy_phone: academy[0].phone,
                    academy_email: academy[0].email,
                    business_number: academy[0].business_number,
                    operating_hours: academy[0].operating_hours,
                    tuition_due_day: 5,
                    salary_payment_day: 10,
                    salary_month_type: 'next',  // 'current': 당월, 'next': 익월
                    morning_class_time: '09:30-12:00',
                    afternoon_class_time: '14:00-18:00',
                    evening_class_time: '18:30-21:00',
                    weekly_tuition_rates: null,
                    settings: null
                }
            });
        }

        res.json({
            message: 'Settings retrieved successfully',
            settings: settings[0]
        });
    } catch (error) {
        console.error('Error fetching settings:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch settings'
        });
    }
});

/**
 * PUT /paca/settings
 * Update academy settings
 * Access: owner, admin only
 */
router.put('/', verifyToken, checkPermission('settings', 'edit'), async (req, res) => {
    try {
        const {
            tuition_due_day,
            salary_payment_day,
            salary_month_type,
            morning_class_time,
            afternoon_class_time,
            evening_class_time,
            weekly_tuition_rates,
            settings
        } = req.body;

        // Validation
        if (tuition_due_day !== undefined) {
            const day = parseInt(tuition_due_day);
            if (isNaN(day) || day < 1 || day > 31) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'tuition_due_day must be between 1 and 31'
                });
            }
        }

        if (salary_payment_day !== undefined) {
            const day = parseInt(salary_payment_day);
            // 0 = 말일, 1~31 = 해당 일자
            if (isNaN(day) || day < 0 || day > 31) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'salary_payment_day must be 0 (last day) or between 1 and 31'
                });
            }
        }

        // salary_month_type validation
        if (salary_month_type !== undefined && !['current', 'next'].includes(salary_month_type)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'salary_month_type must be either "current" or "next"'
            });
        }

        // Time format validation (HH:MM-HH:MM)
        const timeRegex = /^\d{2}:\d{2}-\d{2}:\d{2}$/;
        if (morning_class_time && !timeRegex.test(morning_class_time)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'morning_class_time must be in HH:MM-HH:MM format'
            });
        }
        if (afternoon_class_time && !timeRegex.test(afternoon_class_time)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'afternoon_class_time must be in HH:MM-HH:MM format'
            });
        }
        if (evening_class_time && !timeRegex.test(evening_class_time)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'evening_class_time must be in HH:MM-HH:MM format'
            });
        }

        // Check if settings exist
        const [existing] = await db.query(
            'SELECT id FROM academy_settings WHERE academy_id = ?',
            [req.user.academyId]
        );

        if (existing.length === 0) {
            // Create new settings
            const [result] = await db.query(
                `INSERT INTO academy_settings
                (academy_id, tuition_due_day, salary_payment_day, salary_month_type,
                 morning_class_time, afternoon_class_time, evening_class_time,
                 weekly_tuition_rates, settings)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    req.user.academyId,
                    tuition_due_day || 5,
                    salary_payment_day || 10,
                    salary_month_type || 'next',
                    morning_class_time || '09:30-12:00',
                    afternoon_class_time || '14:00-18:00',
                    evening_class_time || '18:30-21:00',
                    weekly_tuition_rates ? JSON.stringify(weekly_tuition_rates) : null,
                    settings ? JSON.stringify(settings) : null
                ]
            );

            const [newSettings] = await db.query(
                `SELECT s.*, a.name AS academy_name
                FROM academy_settings s
                JOIN academies a ON s.academy_id = a.id
                WHERE s.id = ?`,
                [result.insertId]
            );

            return res.status(201).json({
                message: 'Settings created successfully',
                settings: newSettings[0]
            });
        }

        // Update existing settings
        const updates = [];
        const params = [];

        if (tuition_due_day !== undefined) {
            updates.push('tuition_due_day = ?');
            params.push(tuition_due_day);
        }
        if (salary_payment_day !== undefined) {
            updates.push('salary_payment_day = ?');
            params.push(salary_payment_day);
        }
        if (salary_month_type !== undefined) {
            updates.push('salary_month_type = ?');
            params.push(salary_month_type);
        }
        if (morning_class_time !== undefined) {
            updates.push('morning_class_time = ?');
            params.push(morning_class_time);
        }
        if (afternoon_class_time !== undefined) {
            updates.push('afternoon_class_time = ?');
            params.push(afternoon_class_time);
        }
        if (evening_class_time !== undefined) {
            updates.push('evening_class_time = ?');
            params.push(evening_class_time);
        }
        if (weekly_tuition_rates !== undefined) {
            updates.push('weekly_tuition_rates = ?');
            params.push(JSON.stringify(weekly_tuition_rates));
        }
        if (settings !== undefined) {
            updates.push('settings = ?');
            params.push(JSON.stringify(settings));
        }

        if (updates.length === 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'No fields to update'
            });
        }

        params.push(req.user.academyId);

        await db.query(
            `UPDATE academy_settings SET ${updates.join(', ')} WHERE academy_id = ?`,
            params
        );

        // Fetch updated settings
        const [updated] = await db.query(
            `SELECT s.*, a.name AS academy_name
            FROM academy_settings s
            JOIN academies a ON s.academy_id = a.id
            WHERE s.academy_id = ?`,
            [req.user.academyId]
        );

        res.json({
            message: 'Settings updated successfully',
            settings: updated[0]
        });
    } catch (error) {
        console.error('Error updating settings:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to update settings'
        });
    }
});

/**
 * GET /paca/settings/academy
 * Get academy settings (학원 기본정보 + 학원비 설정)
 * Access: owner, admin, teacher
 */
router.get('/academy', verifyToken, async (req, res) => {
    try {
        // 학원 기본 정보
        const [academyRows] = await db.query(
            'SELECT * FROM academies WHERE id = ?',
            [req.user.academyId]
        );

        if (academyRows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Academy not found'
            });
        }

        const academy = academyRows[0];

        // 학원 설정 (학원비 등)
        const [settingsRows] = await db.query(
            'SELECT * FROM academy_settings WHERE academy_id = ?',
            [req.user.academyId]
        );

        // 기본값
        const defaultTuition = {
            weekly_1: 0,
            weekly_2: 0,
            weekly_3: 0,
            weekly_4: 0,
            weekly_5: 0,
            weekly_6: 0,
            weekly_7: 0,
        };

        const defaultSeasonFees = {
            exam_early: 0,
            exam_regular: 0,
            civil_service: 0,
        };

        let settings = {
            academy_name: academy.name || '',
            phone: academy.phone || '',
            address: academy.address || '',
            business_number: academy.business_number || '',
            tuition_due_day: 5,  // 기본값
            morning_class_time: '09:30-12:00',  // 기본값
            afternoon_class_time: '14:00-18:00',  // 기본값
            evening_class_time: '18:30-21:00',  // 기본값
            exam_tuition: { ...defaultTuition },
            adult_tuition: { ...defaultTuition },
            season_fees: { ...defaultSeasonFees },
        };

        // 기존 설정이 있으면 병합
        if (settingsRows.length > 0) {
            const dbSettings = settingsRows[0];

            // tuition_due_day
            if (dbSettings.tuition_due_day) {
                settings.tuition_due_day = dbSettings.tuition_due_day;
            }

            // 시간대 설정
            if (dbSettings.morning_class_time) {
                settings.morning_class_time = dbSettings.morning_class_time;
            }
            if (dbSettings.afternoon_class_time) {
                settings.afternoon_class_time = dbSettings.afternoon_class_time;
            }
            if (dbSettings.evening_class_time) {
                settings.evening_class_time = dbSettings.evening_class_time;
            }

            // JSON 필드 파싱
            let tuitionSettings = null;
            if (dbSettings.settings) {
                try {
                    tuitionSettings = typeof dbSettings.settings === 'string'
                        ? JSON.parse(dbSettings.settings)
                        : dbSettings.settings;
                } catch (e) {
                    console.error('Failed to parse settings JSON:', e);
                }
            }

            if (tuitionSettings) {
                settings = {
                    ...settings,
                    exam_tuition: tuitionSettings.exam_tuition || { ...defaultTuition },
                    adult_tuition: tuitionSettings.adult_tuition || { ...defaultTuition },
                    season_fees: tuitionSettings.season_fees || { ...defaultSeasonFees },
                };
            }
        }

        res.json({
            message: 'Academy settings retrieved successfully',
            settings
        });
    } catch (error) {
        console.error('Error fetching academy settings:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch academy settings'
        });
    }
});

/**
 * PUT /paca/settings/academy
 * Update academy settings (학원 기본정보 + 학원비 설정)
 * Access: owner, admin only
 */
router.put('/academy', verifyToken, checkPermission('settings', 'edit'), async (req, res) => {
    try {
        const {
            academy_name,
            phone,
            address,
            business_number,
            tuition_due_day,
            exam_tuition,
            adult_tuition,
            season_fees
        } = req.body;

        // 1. 학원 기본 정보 업데이트
        const academyUpdates = [];
        const academyParams = [];

        if (academy_name !== undefined) {
            academyUpdates.push('name = ?');
            academyParams.push(academy_name);
        }
        if (phone !== undefined) {
            academyUpdates.push('phone = ?');
            academyParams.push(phone);
        }
        if (address !== undefined) {
            academyUpdates.push('address = ?');
            academyParams.push(address);
        }
        if (business_number !== undefined) {
            academyUpdates.push('business_number = ?');
            academyParams.push(business_number);
        }

        if (academyUpdates.length > 0) {
            academyParams.push(req.user.academyId);
            await db.query(
                `UPDATE academies SET ${academyUpdates.join(', ')} WHERE id = ?`,
                academyParams
            );
        }

        // 2. 학원비 설정 업데이트 (academy_settings.settings JSON 필드)
        const tuitionSettings = {
            exam_tuition: exam_tuition || null,
            adult_tuition: adult_tuition || null,
            season_fees: season_fees || null,
        };

        // 기존 설정 확인
        const [existing] = await db.query(
            'SELECT id, settings FROM academy_settings WHERE academy_id = ?',
            [req.user.academyId]
        );

        if (existing.length === 0) {
            // 새로 생성
            await db.query(
                `INSERT INTO academy_settings (academy_id, tuition_due_day, settings) VALUES (?, ?, ?)`,
                [req.user.academyId, tuition_due_day || 5, JSON.stringify(tuitionSettings)]
            );
        } else {
            // tuition_due_day 업데이트
            if (tuition_due_day !== undefined) {
                await db.query(
                    'UPDATE academy_settings SET tuition_due_day = ? WHERE academy_id = ?',
                    [tuition_due_day, req.user.academyId]
                );
            }
            // 기존 settings와 병합
            let existingSettings = {};
            if (existing[0].settings) {
                try {
                    existingSettings = typeof existing[0].settings === 'string'
                        ? JSON.parse(existing[0].settings)
                        : existing[0].settings;
                } catch (e) {
                    existingSettings = {};
                }
            }

            const mergedSettings = {
                ...existingSettings,
                ...tuitionSettings,
            };

            // null이 아닌 값만 병합
            if (exam_tuition) mergedSettings.exam_tuition = exam_tuition;
            if (adult_tuition) mergedSettings.adult_tuition = adult_tuition;
            if (season_fees) mergedSettings.season_fees = season_fees;

            await db.query(
                'UPDATE academy_settings SET settings = ? WHERE academy_id = ?',
                [JSON.stringify(mergedSettings), req.user.academyId]
            );
        }

        // 업데이트된 설정 반환
        const [academyRows] = await db.query(
            'SELECT * FROM academies WHERE id = ?',
            [req.user.academyId]
        );

        const [settingsRows] = await db.query(
            'SELECT * FROM academy_settings WHERE academy_id = ?',
            [req.user.academyId]
        );

        const academy = academyRows[0];
        let finalSettings = {
            academy_name: academy.name || '',
            phone: academy.phone || '',
            address: academy.address || '',
            business_number: academy.business_number || '',
            tuition_due_day: settingsRows.length > 0 ? settingsRows[0].tuition_due_day : 5,
            exam_tuition: exam_tuition || { weekly_1: 0, weekly_2: 0, weekly_3: 0, weekly_4: 0, weekly_5: 0, weekly_6: 0, weekly_7: 0 },
            adult_tuition: adult_tuition || { weekly_1: 0, weekly_2: 0, weekly_3: 0, weekly_4: 0, weekly_5: 0, weekly_6: 0, weekly_7: 0 },
            season_fees: season_fees || { exam_early: 0, exam_regular: 0, civil_service: 0 },
        };

        if (settingsRows.length > 0 && settingsRows[0].settings) {
            try {
                const parsed = typeof settingsRows[0].settings === 'string'
                    ? JSON.parse(settingsRows[0].settings)
                    : settingsRows[0].settings;
                finalSettings = {
                    ...finalSettings,
                    exam_tuition: parsed.exam_tuition || finalSettings.exam_tuition,
                    adult_tuition: parsed.adult_tuition || finalSettings.adult_tuition,
                    season_fees: parsed.season_fees || finalSettings.season_fees,
                };
            } catch (e) {
                console.error('Failed to parse saved settings:', e);
            }
        }

        res.json({
            message: 'Academy settings saved successfully',
            settings: finalSettings
        });
    } catch (error) {
        console.error('Error updating academy settings:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to update academy settings'
        });
    }
});

/**
 * GET /paca/settings/tuition-rates
 * Get weekly tuition rates configuration
 * Access: owner, admin, teacher
 */
router.get('/tuition-rates', verifyToken, async (req, res) => {
    try {
        const [settings] = await db.query(
            'SELECT weekly_tuition_rates FROM academy_settings WHERE academy_id = ?',
            [req.user.academyId]
        );

        if (settings.length === 0 || !settings[0].weekly_tuition_rates) {
            // Return default structure
            return res.json({
                message: 'Tuition rates not configured (using defaults)',
                tuition_rates: {
                    weekly_1: 200000,
                    weekly_2: 300000,
                    weekly_3: 400000,
                    weekly_4: 450000,
                    weekly_5: 500000,
                    weekly_6: 550000,
                    weekly_7: 600000
                }
            });
        }

        res.json({
            message: 'Tuition rates retrieved successfully',
            tuition_rates: settings[0].weekly_tuition_rates
        });
    } catch (error) {
        console.error('Error fetching tuition rates:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch tuition rates'
        });
    }
});

/**
 * PUT /paca/settings/tuition-rates
 * Update weekly tuition rates
 * Access: owner, admin only
 */
router.put('/tuition-rates', verifyToken, checkPermission('settings', 'edit'), async (req, res) => {
    try {
        const { tuition_rates } = req.body;

        if (!tuition_rates || typeof tuition_rates !== 'object') {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'tuition_rates object is required'
            });
        }

        // Check if settings exist
        const [existing] = await db.query(
            'SELECT id FROM academy_settings WHERE academy_id = ?',
            [req.user.academyId]
        );

        if (existing.length === 0) {
            // Create new settings with tuition rates
            await db.query(
                `INSERT INTO academy_settings (academy_id, weekly_tuition_rates)
                VALUES (?, ?)`,
                [req.user.academyId, JSON.stringify(tuition_rates)]
            );
        } else {
            // Update existing settings
            await db.query(
                'UPDATE academy_settings SET weekly_tuition_rates = ? WHERE academy_id = ?',
                [JSON.stringify(tuition_rates), req.user.academyId]
            );
        }

        res.json({
            message: 'Tuition rates updated successfully',
            tuition_rates
        });
    } catch (error) {
        console.error('Error updating tuition rates:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to update tuition rates'
        });
    }
});

/**
 * POST /paca/settings/reset-database
 * Reset all data except users, academies, academy_settings
 * Access: owner only
 */
router.post('/reset-database', verifyToken, requireRole('owner'), async (req, res) => {
    const connection = await db.getConnection();

    try {
        const { confirmation } = req.body;

        // 확인 문자열 검증
        if (confirmation !== '초기화') {
            return res.status(400).json({
                error: 'Validation Error',
                message: '확인 문자열이 일치하지 않습니다. "초기화"를 입력해주세요.'
            });
        }

        await connection.beginTransaction();

        // FK 체크 비활성화
        await connection.query('SET FOREIGN_KEY_CHECKS = 0');

        // 삭제 대상 테이블 (FK 의존성 순서)
        const tablesToTruncate = [
            'student_payments',
            'student_seasons',
            'salary_records',
            'instructor_attendance',
            'overtime_approvals',
            'instructor_schedules',
            'schedules',
            'expenses',
            'other_incomes',
            'revenues',
            'student_performances',
            'seasons',
            'students',
            'instructors'
        ];

        const results = [];

        for (const table of tablesToTruncate) {
            try {
                await connection.query(`TRUNCATE TABLE ${table}`);
                results.push({ table, status: 'success' });
            } catch (err) {
                // 테이블이 없을 수도 있음
                results.push({ table, status: 'skipped', reason: err.message });
            }
        }

        // FK 체크 다시 활성화
        await connection.query('SET FOREIGN_KEY_CHECKS = 1');

        await connection.commit();

        console.log(`[DB Reset] Academy ${req.user.academyId} by user ${req.user.id}`);

        res.json({
            message: '데이터베이스가 초기화되었습니다.',
            results
        });
    } catch (error) {
        await connection.rollback();
        console.error('Error resetting database:', error);
        res.status(500).json({
            error: 'Server Error',
            message: '데이터베이스 초기화에 실패했습니다.'
        });
    } finally {
        connection.release();
    }
});

module.exports = router;
