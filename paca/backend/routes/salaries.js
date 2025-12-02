const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken, requireRole, checkPermission } = require('../middleware/auth');
const { calculateInstructorSalary } = require('../utils/salaryCalculator');

/**
 * GET /paca/salaries
 * Get all salary records with filters
 * Access: owner, admin
 */
router.get('/', verifyToken, checkPermission('salaries', 'view'), async (req, res) => {
    try {
        const { instructor_id, year, month, payment_status } = req.query;

        let query = `
            SELECT
                s.id,
                s.instructor_id,
                i.name as instructor_name,
                s.\`year_month\`,
                s.base_amount,
                s.incentive_amount,
                s.total_deduction,
                s.tax_type,
                s.tax_amount,
                s.insurance_details,
                s.net_salary,
                s.payment_date,
                s.payment_status,
                s.created_at
            FROM salary_records s
            JOIN instructors i ON s.instructor_id = i.id
            WHERE i.academy_id = ?
        `;

        const params = [req.user.academyId];

        if (instructor_id) {
            query += ' AND s.instructor_id = ?';
            params.push(parseInt(instructor_id));
        }

        if (year && month) {
            query += ` AND s.\`year_month\` = ?`;
            params.push(`${year}-${String(month).padStart(2, '0')}`);
        }

        if (payment_status) {
            query += ' AND s.payment_status = ?';
            params.push(payment_status);
        }

        query += ' ORDER BY s.`year_month` DESC, i.name ASC';

        const [salaries] = await db.query(query, params);

        res.json({
            message: `Found ${salaries.length} salary records`,
            salaries
        });
    } catch (error) {
        console.error('Error fetching salaries:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch salary records'
        });
    }
});

/**
 * GET /paca/salaries/work-summary/:instructorId/:yearMonth
 * Get monthly work summary for salary calculation
 * Access: owner, admin
 */
router.get('/work-summary/:instructorId/:yearMonth', verifyToken, checkPermission('salaries', 'view'), async (req, res) => {
    const instructorId = parseInt(req.params.instructorId);
    const yearMonth = req.params.yearMonth; // YYYY-MM format

    try {
        // Validate yearMonth format
        const dateRegex = /^\d{4}-\d{2}$/;
        if (!dateRegex.test(yearMonth)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'yearMonth must be in YYYY-MM format'
            });
        }

        // Verify instructor exists and belongs to academy
        const [instructors] = await db.query(
            `SELECT id, name, salary_type, hourly_rate, base_salary, tax_type,
                    morning_class_rate, afternoon_class_rate, evening_class_rate
             FROM instructors
             WHERE id = ? AND academy_id = ? AND deleted_at IS NULL`,
            [instructorId, req.user.academyId]
        );

        if (instructors.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Instructor not found'
            });
        }

        const instructor = instructors[0];

        // Get attendance records for the month
        const [attendances] = await db.query(
            `SELECT
                ia.time_slot,
                ia.attendance_status,
                ia.check_in_time,
                ia.check_out_time,
                ia.work_date
             FROM instructor_attendance ia
             WHERE ia.instructor_id = ?
               AND DATE_FORMAT(ia.work_date, '%Y-%m') = ?
               AND ia.attendance_status IN ('present', 'late')
             ORDER BY ia.work_date, ia.time_slot`,
            [instructorId, yearMonth]
        );

        // Calculate work summary
        let morningClasses = 0;
        let afternoonClasses = 0;
        let eveningClasses = 0;
        let totalHours = 0;

        // Group by date for daily breakdown
        const dailyBreakdown = {};
        const timeSlotLabels = { morning: '오전', afternoon: '오후', evening: '저녁' };

        for (const att of attendances) {
            // Count classes by time slot
            if (att.time_slot === 'morning') morningClasses++;
            else if (att.time_slot === 'afternoon') afternoonClasses++;
            else if (att.time_slot === 'evening') eveningClasses++;

            // Calculate hours if check times are available
            if (att.check_in_time && att.check_out_time) {
                const checkIn = new Date(`2000-01-01 ${att.check_in_time}`);
                const checkOut = new Date(`2000-01-01 ${att.check_out_time}`);
                const hours = (checkOut - checkIn) / (1000 * 60 * 60);
                if (hours > 0) totalHours += hours;
            } else {
                // Default hours per time slot if no check times
                totalHours += 3; // Assume 3 hours per class slot
            }

            // Build daily breakdown
            const dateStr = att.work_date instanceof Date
                ? att.work_date.toISOString().split('T')[0]
                : att.work_date;

            if (!dailyBreakdown[dateStr]) {
                dailyBreakdown[dateStr] = [];
            }
            dailyBreakdown[dateStr].push(timeSlotLabels[att.time_slot] || att.time_slot);
        }

        const totalClasses = morningClasses + afternoonClasses + eveningClasses;

        res.json({
            message: 'Work summary retrieved',
            instructor: {
                id: instructor.id,
                name: instructor.name,
                salary_type: instructor.salary_type,
                hourly_rate: instructor.hourly_rate,
                base_salary: instructor.base_salary,
                tax_type: instructor.tax_type,
                morning_class_rate: instructor.morning_class_rate,
                afternoon_class_rate: instructor.afternoon_class_rate,
                evening_class_rate: instructor.evening_class_rate
            },
            work_summary: {
                year_month: yearMonth,
                morning_classes: morningClasses,
                afternoon_classes: afternoonClasses,
                evening_classes: eveningClasses,
                total_classes: totalClasses,
                total_hours: Math.round(totalHours * 100) / 100,
                attendance_days: Object.keys(dailyBreakdown).length,
                daily_breakdown: dailyBreakdown
            }
        });
    } catch (error) {
        console.error('Error fetching work summary:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch work summary'
        });
    }
});

/**
 * GET /paca/salaries/:id
 * Get salary record by ID with attendance details
 * Access: owner, admin
 */
router.get('/:id', verifyToken, checkPermission('salaries', 'view'), async (req, res) => {
    const salaryId = parseInt(req.params.id);

    try {
        const [salaries] = await db.query(
            `SELECT
                s.*,
                i.name as instructor_name,
                i.salary_type,
                i.hourly_rate,
                i.base_salary,
                i.tax_type as instructor_tax_type,
                i.morning_class_rate,
                i.afternoon_class_rate,
                i.evening_class_rate
            FROM salary_records s
            JOIN instructors i ON s.instructor_id = i.id
            WHERE s.id = ?
            AND i.academy_id = ?`,
            [salaryId, req.user.academyId]
        );

        if (salaries.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Salary record not found'
            });
        }

        const salary = salaries[0];

        // year_month = 근무월이므로 출근 기록 조회도 같은 월
        const attendanceYearMonth = salary.year_month;

        // 해당 월의 출근 기록 조회
        const [attendances] = await db.query(
            `SELECT
                work_date,
                time_slot,
                check_in_time,
                check_out_time,
                attendance_status,
                notes
            FROM instructor_attendance
            WHERE instructor_id = ?
            AND DATE_FORMAT(work_date, '%Y-%m') = ?
            AND attendance_status IN ('present', 'late', 'half_day')
            ORDER BY work_date, time_slot`,
            [salary.instructor_id, attendanceYearMonth]
        );

        // 일별로 그룹화
        const dailyBreakdown = {};
        const timeSlotLabels = { morning: '오전', afternoon: '오후', evening: '저녁' };

        for (const att of attendances) {
            const dateStr = att.work_date instanceof Date
                ? att.work_date.toISOString().split('T')[0]
                : att.work_date;

            if (!dailyBreakdown[dateStr]) {
                dailyBreakdown[dateStr] = {
                    slots: [],
                    details: []
                };
            }

            dailyBreakdown[dateStr].slots.push(timeSlotLabels[att.time_slot] || att.time_slot);
            dailyBreakdown[dateStr].details.push({
                time_slot: att.time_slot,
                time_slot_label: timeSlotLabels[att.time_slot] || att.time_slot,
                check_in_time: att.check_in_time,
                check_out_time: att.check_out_time,
                attendance_status: att.attendance_status
            });
        }

        // 요약 정보 계산
        let morningClasses = 0, afternoonClasses = 0, eveningClasses = 0, totalMinutes = 0;
        for (const att of attendances) {
            if (att.time_slot === 'morning') morningClasses++;
            else if (att.time_slot === 'afternoon') afternoonClasses++;
            else if (att.time_slot === 'evening') eveningClasses++;

            if (att.check_in_time && att.check_out_time) {
                const [inH, inM] = att.check_in_time.split(':').map(Number);
                const [outH, outM] = att.check_out_time.split(':').map(Number);
                const inMins = inH * 60 + inM;
                const outMins = outH * 60 + outM;
                if (outMins > inMins) {
                    totalMinutes += (outMins - inMins);
                }
            }
        }

        res.json({
            salary: salary,
            attendance_summary: {
                work_year_month: attendanceYearMonth,
                attendance_days: Object.keys(dailyBreakdown).length,
                total_classes: morningClasses + afternoonClasses + eveningClasses,
                morning_classes: morningClasses,
                afternoon_classes: afternoonClasses,
                evening_classes: eveningClasses,
                total_hours: Math.round((totalMinutes / 60) * 100) / 100,
                daily_breakdown: dailyBreakdown
            }
        });
    } catch (error) {
        console.error('Error fetching salary:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch salary record'
        });
    }
});

/**
 * POST /paca/salaries/calculate
 * Calculate salary for instructor
 * Access: owner, admin
 */
router.post('/calculate', verifyToken, checkPermission('salaries', 'edit'), async (req, res) => {
    try {
        const { instructor_id, year, month, incentive_amount, total_deduction, work_data } = req.body;

        if (!instructor_id || !year || !month) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Required fields: instructor_id, year, month'
            });
        }

        // Get instructor info
        const [instructors] = await db.query(
            'SELECT * FROM instructors WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
            [instructor_id, req.user.academyId]
        );

        if (instructors.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Instructor not found'
            });
        }

        const instructor = instructors[0];

        // Calculate salary
        const salaryData = calculateInstructorSalary(
            instructor,
            work_data || {},
            incentive_amount || 0,
            total_deduction || 0
        );

        res.json({
            message: 'Salary calculated successfully',
            instructor: {
                id: instructor.id,
                name: instructor.name,
                salary_type: instructor.salary_type
            },
            salary: salaryData
        });
    } catch (error) {
        console.error('Error calculating salary:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to calculate salary'
        });
    }
});

/**
 * POST /paca/salaries
 * Create salary record
 * Access: owner, admin
 */
router.post('/', verifyToken, checkPermission('salaries', 'edit'), async (req, res) => {
    try {
        const {
            instructor_id,
            year_month,
            base_amount,
            incentive_amount,
            total_deduction,
            tax_type,
            tax_amount,
            insurance_details,
            net_salary
        } = req.body;

        if (!instructor_id || !year_month || !base_amount || !tax_type || !net_salary) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Required fields: instructor_id, year_month, base_amount, tax_type, net_salary'
            });
        }

        // Verify instructor exists
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

        // Check if salary record already exists for this month
        const [existing] = await db.query(
            'SELECT id FROM salary_records WHERE instructor_id = ? AND `year_month` = ?',
            [instructor_id, year_month]
        );

        if (existing.length > 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: `Salary record for ${year_month} already exists`
            });
        }

        // Insert salary record
        const [result] = await db.query(
            `INSERT INTO salary_records (
                instructor_id,
                \`year_month\`,
                base_amount,
                incentive_amount,
                total_deduction,
                tax_type,
                tax_amount,
                insurance_details,
                net_salary,
                payment_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [
                instructor_id,
                year_month,
                base_amount,
                incentive_amount || 0,
                total_deduction || 0,
                tax_type,
                tax_amount || 0,
                insurance_details ? JSON.stringify(insurance_details) : null,
                net_salary
            ]
        );

        // Fetch created record
        const [created] = await db.query(
            `SELECT
                s.*,
                i.name as instructor_name
            FROM salary_records s
            JOIN instructors i ON s.instructor_id = i.id
            WHERE s.id = ?`,
            [result.insertId]
        );

        res.status(201).json({
            message: 'Salary record created successfully',
            salary: created[0]
        });
    } catch (error) {
        console.error('Error creating salary:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to create salary record'
        });
    }
});

/**
 * POST /paca/salaries/:id/pay
 * Record salary payment
 * Access: owner
 */
router.post('/:id/pay', verifyToken, requireRole('owner'), async (req, res) => {
    const salaryId = parseInt(req.params.id);

    try {
        const { payment_date } = req.body;

        // Get salary record
        const [salaries] = await db.query(
            `SELECT s.*, i.academy_id, i.name as instructor_name
            FROM salary_records s
            JOIN instructors i ON s.instructor_id = i.id
            WHERE s.id = ?`,
            [salaryId]
        );

        if (salaries.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Salary record not found'
            });
        }

        const salary = salaries[0];

        if (salary.academy_id !== req.user.academyId) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Access denied'
            });
        }

        // Update payment status
        await db.query(
            `UPDATE salary_records
            SET payment_status = 'paid', payment_date = ?, updated_at = NOW()
            WHERE id = ?`,
            [payment_date || new Date().toISOString().split('T')[0], salaryId]
        );

        // Record in expenses table
        await db.query(
            `INSERT INTO expenses (
                academy_id,
                expense_date,
                category,
                amount,
                salary_id,
                instructor_id,
                description,
                recorded_by
            ) VALUES (?, ?, 'salary', ?, ?, ?, ?, ?)`,
            [
                salary.academy_id,
                payment_date || new Date().toISOString().split('T')[0],
                salary.net_salary,
                salaryId,
                salary.instructor_id,
                `급여 지급 (${salary.year_month})`,
                req.user.userId
            ]
        );

        // Fetch updated record
        const [updated] = await db.query(
            `SELECT
                s.*,
                i.name as instructor_name
            FROM salary_records s
            JOIN instructors i ON s.instructor_id = i.id
            WHERE s.id = ?`,
            [salaryId]
        );

        res.json({
            message: 'Salary payment recorded successfully',
            salary: updated[0]
        });
    } catch (error) {
        console.error('Error recording salary payment:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to record salary payment'
        });
    }
});

/**
 * PUT /paca/salaries/:id
 * Update salary record
 * Access: owner
 */
router.put('/:id', verifyToken, requireRole('owner'), async (req, res) => {
    const salaryId = parseInt(req.params.id);

    try {
        // Verify exists and belongs to academy (급여 정보도 함께 가져옴)
        const [salaries] = await db.query(
            `SELECT s.id, s.base_amount, s.incentive_amount, s.total_deduction, s.tax_amount, i.academy_id
            FROM salary_records s
            JOIN instructors i ON s.instructor_id = i.id
            WHERE s.id = ?`,
            [salaryId]
        );

        if (salaries.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Salary record not found'
            });
        }

        if (salaries[0].academy_id !== req.user.academyId) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Access denied'
            });
        }

        const { incentive_amount, total_deduction, payment_status, payment_date } = req.body;

        const updates = [];
        const params = [];

        if (incentive_amount !== undefined) {
            updates.push('incentive_amount = ?');
            params.push(incentive_amount);
        }
        if (total_deduction !== undefined) {
            updates.push('total_deduction = ?');
            params.push(total_deduction);
        }
        if (payment_status !== undefined) {
            updates.push('payment_status = ?');
            params.push(payment_status);
        }
        if (payment_date !== undefined) {
            updates.push('payment_date = ?');
            params.push(payment_date);
        }

        if (updates.length === 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'No fields to update'
            });
        }

        // 인센티브나 공제액이 변경되면 실수령액 재계산
        if (incentive_amount !== undefined || total_deduction !== undefined) {
            // 기존 급여 정보 가져오기
            const currentSalary = salaries[0];
            const newIncentive = incentive_amount !== undefined ? parseFloat(incentive_amount) : parseFloat(currentSalary.incentive_amount) || 0;
            const newDeduction = total_deduction !== undefined ? parseFloat(total_deduction) : parseFloat(currentSalary.total_deduction) || 0;
            const baseAmount = parseFloat(currentSalary.base_amount) || 0;
            const taxAmount = parseFloat(currentSalary.tax_amount) || 0;

            // 실수령액 = 기본급 + 인센티브 - 공제액 - 세금
            const netSalary = baseAmount + newIncentive - newDeduction - taxAmount;
            updates.push('net_salary = ?');
            params.push(netSalary);
        }

        updates.push('updated_at = NOW()');
        params.push(salaryId);

        await db.query(
            `UPDATE salary_records SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        // Fetch updated record
        const [updated] = await db.query(
            `SELECT
                s.*,
                i.name as instructor_name
            FROM salary_records s
            JOIN instructors i ON s.instructor_id = i.id
            WHERE s.id = ?`,
            [salaryId]
        );

        res.json({
            message: 'Salary record updated successfully',
            salary: updated[0]
        });
    } catch (error) {
        console.error('Error updating salary:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to update salary record'
        });
    }
});

/**
 * DELETE /paca/salaries/:id
 * Delete salary record
 * Access: owner
 */
router.delete('/:id', verifyToken, requireRole('owner'), async (req, res) => {
    const salaryId = parseInt(req.params.id);

    try {
        const [salaries] = await db.query(
            `SELECT s.id, i.academy_id, i.name as instructor_name, s.year_month
            FROM salary_records s
            JOIN instructors i ON s.instructor_id = i.id
            WHERE s.id = ?`,
            [salaryId]
        );

        if (salaries.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Salary record not found'
            });
        }

        if (salaries[0].academy_id !== req.user.academyId) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Access denied'
            });
        }

        await db.query('DELETE FROM salary_records WHERE id = ?', [salaryId]);

        res.json({
            message: 'Salary record deleted successfully',
            salary: {
                id: salaryId,
                instructor_name: salaries[0].instructor_name,
                year_month: salaries[0].year_month
            }
        });
    } catch (error) {
        console.error('Error deleting salary:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to delete salary record'
        });
    }
});

module.exports = router;
