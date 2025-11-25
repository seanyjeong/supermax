const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken, requireRole } = require('../middleware/auth');
const { calculateInstructorSalary } = require('../utils/salaryCalculator');

/**
 * GET /paca/salaries
 * Get all salary records with filters
 * Access: owner, admin
 */
router.get('/', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
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
 * GET /paca/salaries/:id
 * Get salary record by ID
 * Access: owner, admin
 */
router.get('/:id', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const salaryId = parseInt(req.params.id);

    try {
        const [salaries] = await db.query(
            `SELECT
                s.*,
                i.name as instructor_name,
                i.salary_type,
                i.hourly_rate,
                i.base_salary
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

        res.json({
            salary: salaries[0]
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
router.post('/calculate', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
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
router.post('/', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
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
        // Verify exists and belongs to academy
        const [salaries] = await db.query(
            `SELECT s.id, i.academy_id
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
