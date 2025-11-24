const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken, requireRole } = require('../middleware/auth');

/**
 * GET /paca/expenses
 * Get all expense records with filters
 * Access: owner, admin
 */
router.get('/', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { category, instructor_id, start_date, end_date, payment_method } = req.query;

        let query = `
            SELECT
                e.id,
                e.expense_date,
                e.category,
                e.amount,
                e.salary_id,
                e.instructor_id,
                i.name as instructor_name,
                e.description,
                e.payment_method,
                e.notes,
                e.recorded_by,
                u.name as recorded_by_name,
                e.created_at
            FROM expenses e
            LEFT JOIN instructors i ON e.instructor_id = i.id
            LEFT JOIN users u ON e.recorded_by = u.id
            WHERE e.academy_id = ?
        `;

        const params = [req.user.academyId];

        if (category) {
            query += ' AND e.category = ?';
            params.push(category);
        }

        if (instructor_id) {
            query += ' AND e.instructor_id = ?';
            params.push(parseInt(instructor_id));
        }

        if (start_date) {
            query += ' AND e.expense_date >= ?';
            params.push(start_date);
        }

        if (end_date) {
            query += ' AND e.expense_date <= ?';
            params.push(end_date);
        }

        if (payment_method) {
            query += ' AND e.payment_method = ?';
            params.push(payment_method);
        }

        query += ' ORDER BY e.expense_date DESC, e.created_at DESC';

        const [expenses] = await db.query(query, params);

        // Calculate total amount
        const totalAmount = expenses.reduce((sum, expense) => sum + parseFloat(expense.amount), 0);

        res.json({
            message: `Found ${expenses.length} expense records`,
            total_amount: totalAmount,
            expenses
        });
    } catch (error) {
        console.error('Error fetching expenses:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch expense records'
        });
    }
});

/**
 * GET /paca/expenses/:id
 * Get expense record by ID
 * Access: owner, admin
 */
router.get('/:id', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const expenseId = parseInt(req.params.id);

    try {
        const [expenses] = await db.query(
            `SELECT
                e.*,
                i.name as instructor_name,
                i.phone as instructor_phone,
                u.name as recorded_by_name
            FROM expenses e
            LEFT JOIN instructors i ON e.instructor_id = i.id
            LEFT JOIN users u ON e.recorded_by = u.id
            WHERE e.id = ?
            AND e.academy_id = ?`,
            [expenseId, req.user.academyId]
        );

        if (expenses.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Expense record not found'
            });
        }

        res.json({ expense: expenses[0] });
    } catch (error) {
        console.error('Error fetching expense:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch expense record'
        });
    }
});

/**
 * GET /paca/expenses/summary/monthly
 * Get monthly expense summary
 * Access: owner, admin
 */
router.get('/summary/monthly', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { year, month } = req.query;

        if (!year || !month) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'year and month are required'
            });
        }

        const yearMonth = `${year}-${String(month).padStart(2, '0')}`;

        const [summary] = await db.query(
            `SELECT
                category,
                COUNT(*) as count,
                SUM(amount) as total_amount
            FROM expenses
            WHERE academy_id = ?
            AND DATE_FORMAT(expense_date, '%Y-%m') = ?
            GROUP BY category
            ORDER BY total_amount DESC`,
            [req.user.academyId, yearMonth]
        );

        const [total] = await db.query(
            `SELECT
                COUNT(*) as total_count,
                SUM(amount) as total_amount
            FROM expenses
            WHERE academy_id = ?
            AND DATE_FORMAT(expense_date, '%Y-%m') = ?`,
            [req.user.academyId, yearMonth]
        );

        res.json({
            year_month: yearMonth,
            summary,
            total: total[0]
        });
    } catch (error) {
        console.error('Error fetching monthly expense summary:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch monthly expense summary'
        });
    }
});

/**
 * GET /paca/expenses/category/list
 * Get list of expense categories
 * Access: owner, admin
 */
router.get('/category/list', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const [categories] = await db.query(
            `SELECT DISTINCT category
            FROM expenses
            WHERE academy_id = ?
            ORDER BY category`,
            [req.user.academyId]
        );

        res.json({
            message: `Found ${categories.length} categories`,
            categories: categories.map(c => c.category)
        });
    } catch (error) {
        console.error('Error fetching expense categories:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch expense categories'
        });
    }
});

/**
 * POST /paca/expenses
 * Create new expense record
 * Access: owner, admin
 */
router.post('/', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    try {
        const {
            expense_date,
            category,
            amount,
            salary_id,
            instructor_id,
            description,
            payment_method,
            notes
        } = req.body;

        // Validation
        if (!expense_date || !category || !amount) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Required fields: expense_date, category, amount'
            });
        }

        if (amount <= 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Amount must be greater than 0'
            });
        }

        // Validate payment_method if provided
        if (payment_method) {
            const validMethods = ['account', 'card', 'cash', 'other'];
            if (!validMethods.includes(payment_method)) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: `Invalid payment_method. Must be one of: ${validMethods.join(', ')}`
                });
            }
        }

        // Verify instructor exists if instructor_id is provided
        if (instructor_id) {
            const [instructors] = await db.query(
                'SELECT id FROM instructors WHERE id = ? AND academy_id = ?',
                [instructor_id, req.user.academyId]
            );

            if (instructors.length === 0) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: 'Instructor not found'
                });
            }
        }

        // Insert expense record
        const [result] = await db.query(
            `INSERT INTO expenses (
                academy_id,
                expense_date,
                category,
                amount,
                salary_id,
                instructor_id,
                description,
                payment_method,
                notes,
                recorded_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.user.academyId,
                expense_date,
                category,
                amount,
                salary_id || null,
                instructor_id || null,
                description || null,
                payment_method || null,
                notes || null,
                req.user.userId
            ]
        );

        // Fetch created record
        const [expenses] = await db.query(
            `SELECT
                e.*,
                i.name as instructor_name,
                u.name as recorded_by_name
            FROM expenses e
            LEFT JOIN instructors i ON e.instructor_id = i.id
            LEFT JOIN users u ON e.recorded_by = u.id
            WHERE e.id = ?`,
            [result.insertId]
        );

        res.status(201).json({
            message: 'Expense record created successfully',
            expense: expenses[0]
        });
    } catch (error) {
        console.error('Error creating expense:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to create expense record'
        });
    }
});

/**
 * PUT /paca/expenses/:id
 * Update expense record
 * Access: owner, admin
 */
router.put('/:id', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const expenseId = parseInt(req.params.id);

    try {
        // Verify expense record exists
        const [existing] = await db.query(
            'SELECT id FROM expenses WHERE id = ? AND academy_id = ?',
            [expenseId, req.user.academyId]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Expense record not found'
            });
        }

        const {
            expense_date,
            category,
            amount,
            salary_id,
            instructor_id,
            description,
            payment_method,
            notes
        } = req.body;

        // Validate amount if provided
        if (amount !== undefined && amount <= 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Amount must be greater than 0'
            });
        }

        // Validate payment_method if provided
        if (payment_method) {
            const validMethods = ['account', 'card', 'cash', 'other'];
            if (!validMethods.includes(payment_method)) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: `Invalid payment_method. Must be one of: ${validMethods.join(', ')}`
                });
            }
        }

        // Verify instructor exists if instructor_id is provided
        if (instructor_id) {
            const [instructors] = await db.query(
                'SELECT id FROM instructors WHERE id = ? AND academy_id = ?',
                [instructor_id, req.user.academyId]
            );

            if (instructors.length === 0) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: 'Instructor not found'
                });
            }
        }

        // Build update query
        const updates = [];
        const params = [];

        if (expense_date !== undefined) {
            updates.push('expense_date = ?');
            params.push(expense_date);
        }
        if (category !== undefined) {
            updates.push('category = ?');
            params.push(category);
        }
        if (amount !== undefined) {
            updates.push('amount = ?');
            params.push(amount);
        }
        if (salary_id !== undefined) {
            updates.push('salary_id = ?');
            params.push(salary_id);
        }
        if (instructor_id !== undefined) {
            updates.push('instructor_id = ?');
            params.push(instructor_id);
        }
        if (description !== undefined) {
            updates.push('description = ?');
            params.push(description);
        }
        if (payment_method !== undefined) {
            updates.push('payment_method = ?');
            params.push(payment_method);
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
        params.push(expenseId);

        await db.query(
            `UPDATE expenses SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        // Fetch updated record
        const [expenses] = await db.query(
            `SELECT
                e.*,
                i.name as instructor_name,
                u.name as recorded_by_name
            FROM expenses e
            LEFT JOIN instructors i ON e.instructor_id = i.id
            LEFT JOIN users u ON e.recorded_by = u.id
            WHERE e.id = ?`,
            [expenseId]
        );

        res.json({
            message: 'Expense record updated successfully',
            expense: expenses[0]
        });
    } catch (error) {
        console.error('Error updating expense:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to update expense record'
        });
    }
});

/**
 * DELETE /paca/expenses/:id
 * Delete expense record
 * Access: owner, admin
 */
router.delete('/:id', verifyToken, requireRole('owner', 'admin'), async (req, res) => {
    const expenseId = parseInt(req.params.id);

    try {
        // Verify expense record exists
        const [existing] = await db.query(
            `SELECT e.id, e.category, e.amount
            FROM expenses e
            WHERE e.id = ? AND e.academy_id = ?`,
            [expenseId, req.user.academyId]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Expense record not found'
            });
        }

        // Delete record
        await db.query('DELETE FROM expenses WHERE id = ?', [expenseId]);

        res.json({
            message: 'Expense record deleted successfully',
            expense: {
                id: expenseId,
                category: existing[0].category,
                amount: existing[0].amount
            }
        });
    } catch (error) {
        console.error('Error deleting expense:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to delete expense record'
        });
    }
});

module.exports = router;
