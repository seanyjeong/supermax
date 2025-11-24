const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken, requireRole } = require('../middleware/auth');

/**
 * GET /paca/payments
 * Get all payment records with filters
 * Access: owner, admin
 */
router.get('/', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { student_id, payment_status, payment_type, year, month } = req.query;

        let query = `
            SELECT
                p.id,
                p.student_id,
                s.name as student_name,
                s.student_number,
                p.year_month,
                p.payment_type,
                p.base_amount,
                p.discount_amount,
                p.additional_amount,
                p.final_amount,
                p.paid_date,
                p.due_date,
                p.payment_status,
                p.payment_method,
                p.description,
                p.notes,
                p.created_at
            FROM student_payments p
            JOIN students s ON p.student_id = s.id
            WHERE p.academy_id = ?
        `;

        const params = [req.user.academyId];

        if (student_id) {
            query += ' AND p.student_id = ?';
            params.push(parseInt(student_id));
        }

        if (payment_status) {
            query += ' AND p.payment_status = ?';
            params.push(payment_status);
        }

        if (payment_type) {
            query += ' AND p.payment_type = ?';
            params.push(payment_type);
        }

        if (year && month) {
            query += ` AND DATE_FORMAT(p.due_date, '%Y-%m') = ?`;
            params.push(`${year}-${String(month).padStart(2, '0')}`);
        }

        query += ' ORDER BY p.due_date DESC';

        const [payments] = await db.query(query, params);

        res.json({
            message: `Found ${payments.length} payment records`,
            payments
        });
    } catch (error) {
        console.error('Error fetching payments:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch payment records'
        });
    }
});

/**
 * GET /paca/payments/unpaid
 * Get all unpaid/overdue payments
 * Access: owner, admin
 */
router.get('/unpaid', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const [payments] = await db.query(
            `SELECT
                p.id,
                p.student_id,
                s.name as student_name,
                s.student_number,
                s.phone,
                s.parent_phone,
                p.year_month,
                p.payment_type,
                p.base_amount,
                p.discount_amount,
                p.additional_amount,
                p.final_amount,
                p.due_date,
                p.payment_status,
                DATEDIFF(CURDATE(), p.due_date) as days_overdue
            FROM student_payments p
            JOIN students s ON p.student_id = s.id
            WHERE p.academy_id = ?
            AND p.payment_status IN ('pending', 'partial')
            ORDER BY p.due_date ASC`,
            [req.user.academyId]
        );

        res.json({
            message: `Found ${payments.length} unpaid payments`,
            payments
        });
    } catch (error) {
        console.error('Error fetching unpaid payments:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch unpaid payments'
        });
    }
});

/**
 * GET /paca/payments/:id
 * Get payment by ID
 * Access: owner, admin
 */
router.get('/:id', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const paymentId = parseInt(req.params.id);

    try {
        const [payments] = await db.query(
            `SELECT
                p.*,
                s.name as student_name,
                s.student_number,
                s.phone,
                s.parent_phone
            FROM student_payments p
            JOIN students s ON p.student_id = s.id
            WHERE p.id = ?
            AND s.academy_id = ?`,
            [paymentId, req.user.academyId]
        );

        if (payments.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Payment record not found'
            });
        }

        res.json({
            payment: payments[0]
        });
    } catch (error) {
        console.error('Error fetching payment:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch payment record'
        });
    }
});

/**
 * POST /paca/payments
 * Create new payment record (charge)
 * Access: owner, admin
 */
router.post('/', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const {
            student_id,
            payment_type,
            base_amount,
            discount_amount,
            additional_amount,
            due_date,
            year_month,
            notes,
            description
        } = req.body;

        // Validation
        if (!student_id || !payment_type || !base_amount || !due_date || !year_month) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Required fields: student_id, payment_type, base_amount, due_date, year_month'
            });
        }

        // Verify student exists and belongs to this academy
        const [students] = await db.query(
            'SELECT id, academy_id FROM students WHERE id = ? AND academy_id = ? AND deleted_at IS NULL',
            [student_id, req.user.academyId]
        );

        if (students.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Student not found'
            });
        }

        // Calculate final_amount
        const finalAmount = parseFloat(base_amount) - parseFloat(discount_amount || 0) + parseFloat(additional_amount || 0);

        // Insert payment record
        const [result] = await db.query(
            `INSERT INTO student_payments (
                student_id,
                academy_id,
                \`year_month\`,
                payment_type,
                base_amount,
                discount_amount,
                additional_amount,
                final_amount,
                due_date,
                payment_status,
                description,
                notes,
                recorded_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
            [
                student_id,
                students[0].academy_id,
                year_month,
                payment_type,
                base_amount,
                discount_amount || 0,
                additional_amount || 0,
                finalAmount,
                due_date,
                description || null,
                notes || null,
                req.user.userId
            ]
        );

        // Fetch created payment
        const [payments] = await db.query(
            `SELECT
                p.*,
                s.name as student_name,
                s.student_number
            FROM student_payments p
            JOIN students s ON p.student_id = s.id
            WHERE p.id = ?`,
            [result.insertId]
        );

        res.status(201).json({
            message: 'Payment record created successfully',
            payment: payments[0]
        });
    } catch (error) {
        console.error('Error creating payment:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to create payment record'
        });
    }
});

/**
 * POST /paca/payments/bulk-monthly
 * Create monthly tuition charges for all active students
 * Access: owner, admin
 */
router.post('/bulk-monthly', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { year, month, due_date } = req.body;

        if (!year || !month || !due_date) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Required fields: year, month, due_date'
            });
        }

        // Get all active students
        const [students] = await db.query(
            `SELECT
                id,
                name,
                student_number,
                monthly_tuition,
                discount_rate
            FROM students
            WHERE academy_id = ?
            AND status = 'active'
            AND deleted_at IS NULL`,
            [req.user.academyId]
        );

        if (students.length === 0) {
            return res.json({
                message: 'No active students found',
                created: 0
            });
        }

        // Check if charges already exist for this month
        const [existing] = await db.query(
            `SELECT COUNT(*) as count
            FROM student_payments p
            JOIN students s ON p.student_id = s.id
            WHERE s.academy_id = ?
            AND p.payment_type = 'monthly'
            AND DATE_FORMAT(p.due_date, '%Y-%m') = ?`,
            [req.user.academyId, `${year}-${String(month).padStart(2, '0')}`]
        );

        if (existing[0].count > 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: `Monthly charges for ${year}-${month} already exist`
            });
        }

        // Create payment records for all students
        let created = 0;
        const yearMonth = `${year}-${String(month).padStart(2, '0')}`;

        for (const student of students) {
            const baseAmount = student.monthly_tuition;
            const discount = baseAmount * (student.discount_rate / 100);
            const finalAmount = baseAmount - discount;

            await db.query(
                `INSERT INTO student_payments (
                    student_id,
                    academy_id,
                    \`year_month\`,
                    payment_type,
                    base_amount,
                    discount_amount,
                    additional_amount,
                    final_amount,
                    due_date,
                    payment_status,
                    description,
                    notes,
                    recorded_by
                ) VALUES (?, ?, ?, 'monthly', ?, ?, 0, ?, ?, 'pending', ?, ?, ?)`,
                [
                    student.id,
                    req.user.academyId,
                    yearMonth,
                    baseAmount,
                    discount,
                    finalAmount,
                    due_date,
                    `${year}년 ${month}월 수강료`,
                    null,
                    req.user.userId
                ]
            );
            created++;
        }

        res.json({
            message: `Successfully created ${created} monthly payment charges`,
            created,
            year,
            month,
            due_date
        });
    } catch (error) {
        console.error('Error creating bulk monthly charges:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to create bulk monthly charges'
        });
    }
});

/**
 * POST /paca/payments/:id/pay
 * Record payment (full or partial)
 * Access: owner, admin
 */
router.post('/:id/pay', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const paymentId = parseInt(req.params.id);

    try {
        const { paid_amount, payment_method, payment_date, notes } = req.body;

        if (!paid_amount || !payment_method) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Required fields: paid_amount, payment_method'
            });
        }

        // Get payment record
        const [payments] = await db.query(
            `SELECT p.*
            FROM student_payments p
            WHERE p.id = ? AND p.academy_id = ?`,
            [paymentId, req.user.academyId]
        );

        if (payments.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Payment record not found'
            });
        }

        const payment = payments[0];

        // Check if payment already completed
        if (payment.payment_status === 'paid') {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Payment already completed'
            });
        }

        // Calculate total due amount
        const totalDue = parseFloat(payment.final_amount);

        // Determine payment status based on paid_amount
        let paymentStatus;
        if (parseFloat(paid_amount) >= totalDue) {
            paymentStatus = 'paid';
        } else if (parseFloat(paid_amount) > 0) {
            paymentStatus = 'partial';
        } else {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'paid_amount must be greater than 0'
            });
        }

        // Update payment record
        await db.query(
            `UPDATE student_payments
            SET
                payment_status = ?,
                payment_method = ?,
                paid_date = ?,
                notes = CONCAT(IFNULL(notes, ''), '\n', ?),
                updated_at = NOW()
            WHERE id = ?`,
            [
                paymentStatus,
                payment_method,
                payment_date || new Date().toISOString().split('T')[0],
                notes || `납부: ${paid_amount}원`,
                paymentId
            ]
        );

        // Record in revenues table
        await db.query(
            `INSERT INTO revenues (
                academy_id,
                revenue_type,
                amount,
                revenue_date,
                payment_method,
                student_id,
                description
            ) VALUES (?, 'tuition', ?, ?, ?, ?, ?)`,
            [
                payment.academy_id,
                paid_amount,
                payment_date || new Date().toISOString().split('T')[0],
                payment_method,
                payment.student_id,
                `수강료 납부 (결제ID: ${paymentId})`
            ]
        );

        // Fetch updated payment
        const [updated] = await db.query(
            `SELECT
                p.*,
                s.name as student_name,
                s.student_number
            FROM student_payments p
            JOIN students s ON p.student_id = s.id
            WHERE p.id = ?`,
            [paymentId]
        );

        res.json({
            message: 'Payment recorded successfully',
            payment: updated[0]
        });
    } catch (error) {
        console.error('Error recording payment:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to record payment'
        });
    }
});

/**
 * PUT /paca/payments/:id
 * Update payment record
 * Access: owner, admin
 */
router.put('/:id', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const paymentId = parseInt(req.params.id);

    try {
        // Verify payment exists and belongs to this academy
        const [payments] = await db.query(
            `SELECT p.id, s.academy_id
            FROM student_payments p
            JOIN students s ON p.student_id = s.id
            WHERE p.id = ?`,
            [paymentId]
        );

        if (payments.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Payment record not found'
            });
        }

        if (payments[0].academy_id !== req.user.academyId) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Access denied'
            });
        }

        const {
            payment_type,
            base_amount,
            discount_amount,
            additional_amount,
            due_date,
            payment_status,
            description,
            notes
        } = req.body;

        // Build update query dynamically
        const updates = [];
        const params = [];

        if (payment_type !== undefined) {
            updates.push('payment_type = ?');
            params.push(payment_type);
        }
        if (base_amount !== undefined) {
            updates.push('base_amount = ?');
            params.push(base_amount);
        }
        if (discount_amount !== undefined) {
            updates.push('discount_amount = ?');
            params.push(discount_amount);
        }
        if (additional_amount !== undefined) {
            updates.push('additional_amount = ?');
            params.push(additional_amount);
        }

        // Recalculate final_amount if any amount fields changed
        if (base_amount !== undefined || discount_amount !== undefined || additional_amount !== undefined) {
            const [current] = await db.query('SELECT base_amount, discount_amount, additional_amount FROM student_payments WHERE id = ?', [paymentId]);
            const currentData = current[0];

            const newBase = base_amount !== undefined ? base_amount : currentData.base_amount;
            const newDiscount = discount_amount !== undefined ? discount_amount : currentData.discount_amount;
            const newAdditional = additional_amount !== undefined ? additional_amount : currentData.additional_amount;

            const finalAmount = parseFloat(newBase) - parseFloat(newDiscount) + parseFloat(newAdditional);
            updates.push('final_amount = ?');
            params.push(finalAmount);
        }

        if (due_date !== undefined) {
            updates.push('due_date = ?');
            params.push(due_date);
        }
        if (payment_status !== undefined) {
            updates.push('payment_status = ?');
            params.push(payment_status);
        }
        if (description !== undefined) {
            updates.push('description = ?');
            params.push(description);
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

        updates.push('updated_at = NOW()');
        params.push(paymentId);

        await db.query(
            `UPDATE student_payments SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        // Fetch updated payment
        const [updated] = await db.query(
            `SELECT
                p.*,
                s.name as student_name,
                s.student_number
            FROM student_payments p
            JOIN students s ON p.student_id = s.id
            WHERE p.id = ?`,
            [paymentId]
        );

        res.json({
            message: 'Payment record updated successfully',
            payment: updated[0]
        });
    } catch (error) {
        console.error('Error updating payment:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to update payment record'
        });
    }
});

/**
 * DELETE /paca/payments/:id
 * Delete payment record
 * Access: owner only
 */
router.delete('/:id', verifyToken, requireRole('owner'), async (req, res) => {
    const paymentId = parseInt(req.params.id);

    try {
        // Verify payment exists and belongs to this academy
        const [payments] = await db.query(
            `SELECT p.id, p.student_id, s.name as student_name
            FROM student_payments p
            JOIN students s ON p.student_id = s.id
            WHERE p.id = ? AND p.academy_id = ?`,
            [paymentId, req.user.academyId]
        );

        if (payments.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Payment record not found'
            });
        }

        // Delete payment record
        await db.query('DELETE FROM student_payments WHERE id = ?', [paymentId]);

        res.json({
            message: 'Payment record deleted successfully',
            payment: {
                id: paymentId,
                student_name: payments[0].student_name
            }
        });
    } catch (error) {
        console.error('Error deleting payment:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to delete payment record'
        });
    }
});

/**
 * GET /paca/payments/stats/summary
 * Get payment statistics summary
 * Access: owner, admin
 */
router.get('/stats/summary', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { year, month } = req.query;

        let dateFilter = '';
        const params = [req.user.academyId];

        if (year && month) {
            dateFilter = ` AND DATE_FORMAT(p.due_date, '%Y-%m') = ?`;
            params.push(`${year}-${String(month).padStart(2, '0')}`);
        }

        // Get payment statistics
        const [stats] = await db.query(
            `SELECT
                COUNT(*) as total_count,
                SUM(CASE WHEN p.payment_status = 'paid' THEN 1 ELSE 0 END) as paid_count,
                SUM(CASE WHEN p.payment_status = 'partial' THEN 1 ELSE 0 END) as partial_count,
                SUM(CASE WHEN p.payment_status = 'pending' THEN 1 ELSE 0 END) as unpaid_count,
                SUM(p.final_amount) as total_expected,
                SUM(CASE WHEN p.payment_status = 'paid' THEN p.final_amount ELSE 0 END) as total_collected,
                SUM(CASE WHEN p.payment_status IN ('pending', 'partial') THEN p.final_amount ELSE 0 END) as total_outstanding
            FROM student_payments p
            WHERE p.academy_id = ?${dateFilter}`,
            params
        );

        res.json({
            message: 'Payment statistics retrieved successfully',
            stats: stats[0]
        });
    } catch (error) {
        console.error('Error fetching payment stats:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch payment statistics'
        });
    }
});

module.exports = router;
