const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verifyToken, requireRole, checkPermission } = require('../middleware/auth');

// 카테고리 한글 매핑
const CATEGORY_LABELS = {
    clothing: '의류',
    shoes: '신발',
    equipment: '용품',
    beverage: '음료',
    snack: '간식',
    other: '기타'
};

/**
 * GET /paca/incomes
 * Get all other income records with filters
 * Access: owner, admin
 */
router.get('/', verifyToken, checkPermission('incomes', 'view'), async (req, res) => {
    try {
        const { category, student_id, start_date, end_date, payment_method } = req.query;

        let query = `
            SELECT
                i.id,
                i.income_date,
                i.category,
                i.amount,
                i.description,
                i.student_id,
                s.name as student_name,
                i.payment_method,
                i.notes,
                i.recorded_by,
                u.name as recorded_by_name,
                i.created_at
            FROM other_incomes i
            LEFT JOIN students s ON i.student_id = s.id
            LEFT JOIN users u ON i.recorded_by = u.id
            WHERE i.academy_id = ?
        `;

        const params = [req.user.academyId];

        if (category) {
            query += ' AND i.category = ?';
            params.push(category);
        }

        if (student_id) {
            query += ' AND i.student_id = ?';
            params.push(parseInt(student_id));
        }

        if (start_date) {
            query += ' AND i.income_date >= ?';
            params.push(start_date);
        }

        if (end_date) {
            query += ' AND i.income_date <= ?';
            params.push(end_date);
        }

        if (payment_method) {
            query += ' AND i.payment_method = ?';
            params.push(payment_method);
        }

        query += ' ORDER BY i.income_date DESC, i.created_at DESC';

        const [incomes] = await db.query(query, params);

        // Calculate total amount
        const totalAmount = incomes.reduce((sum, income) => sum + parseFloat(income.amount), 0);

        res.json({
            message: `Found ${incomes.length} income records`,
            total_amount: totalAmount,
            incomes
        });
    } catch (error) {
        console.error('Error fetching incomes:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch income records'
        });
    }
});

/**
 * GET /paca/incomes/categories
 * Get category labels
 * Access: owner, admin
 */
router.get('/categories', verifyToken, checkPermission('incomes', 'view'), async (req, res) => {
    res.json({
        categories: CATEGORY_LABELS
    });
});

/**
 * GET /paca/incomes/:id
 * Get income record by ID
 * Access: owner, admin
 */
router.get('/:id', verifyToken, checkPermission('incomes', 'view'), async (req, res) => {
    const incomeId = parseInt(req.params.id);

    try {
        const [incomes] = await db.query(
            `SELECT
                i.*,
                s.name as student_name,
                u.name as recorded_by_name
            FROM other_incomes i
            LEFT JOIN students s ON i.student_id = s.id
            LEFT JOIN users u ON i.recorded_by = u.id
            WHERE i.id = ? AND i.academy_id = ?`,
            [incomeId, req.user.academyId]
        );

        if (incomes.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Income record not found'
            });
        }

        res.json({
            message: 'Income record retrieved successfully',
            income: incomes[0]
        });
    } catch (error) {
        console.error('Error fetching income:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to fetch income record'
        });
    }
});

/**
 * POST /paca/incomes
 * Create new income record
 * Access: owner, admin
 */
router.post('/', verifyToken, checkPermission('incomes', 'edit'), async (req, res) => {
    try {
        const {
            income_date,
            category,
            amount,
            description,
            student_id,
            payment_method,
            notes
        } = req.body;

        // Validation
        if (!income_date || !amount) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'income_date and amount are required'
            });
        }

        if (parseFloat(amount) <= 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Amount must be greater than 0'
            });
        }

        // Validate category
        const validCategories = ['clothing', 'shoes', 'equipment', 'beverage', 'snack', 'other'];
        if (category && !validCategories.includes(category)) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Invalid category'
            });
        }

        // Validate student if provided
        if (student_id) {
            const [students] = await db.query(
                'SELECT id FROM students WHERE id = ? AND academy_id = ?',
                [student_id, req.user.academyId]
            );
            if (students.length === 0) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'Student not found'
                });
            }
        }

        const [result] = await db.query(
            `INSERT INTO other_incomes
            (academy_id, income_date, category, amount, description, student_id, payment_method, notes, recorded_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.user.academyId,
                income_date,
                category || 'other',
                amount,
                description || null,
                student_id || null,
                payment_method || 'cash',
                notes || null,
                req.user.id
            ]
        );

        const [newIncome] = await db.query(
            `SELECT i.*, s.name as student_name, u.name as recorded_by_name
            FROM other_incomes i
            LEFT JOIN students s ON i.student_id = s.id
            LEFT JOIN users u ON i.recorded_by = u.id
            WHERE i.id = ?`,
            [result.insertId]
        );

        res.status(201).json({
            message: 'Income record created successfully',
            income: newIncome[0]
        });
    } catch (error) {
        console.error('Error creating income:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to create income record'
        });
    }
});

/**
 * PUT /paca/incomes/:id
 * Update income record
 * Access: owner, admin
 */
router.put('/:id', verifyToken, checkPermission('incomes', 'edit'), async (req, res) => {
    const incomeId = parseInt(req.params.id);

    try {
        // Check if income exists
        const [existing] = await db.query(
            'SELECT id FROM other_incomes WHERE id = ? AND academy_id = ?',
            [incomeId, req.user.academyId]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Income record not found'
            });
        }

        const {
            income_date,
            category,
            amount,
            description,
            student_id,
            payment_method,
            notes
        } = req.body;

        // Build update query
        const updates = [];
        const params = [];

        if (income_date !== undefined) {
            updates.push('income_date = ?');
            params.push(income_date);
        }
        if (category !== undefined) {
            updates.push('category = ?');
            params.push(category);
        }
        if (amount !== undefined) {
            if (parseFloat(amount) <= 0) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'Amount must be greater than 0'
                });
            }
            updates.push('amount = ?');
            params.push(amount);
        }
        if (description !== undefined) {
            updates.push('description = ?');
            params.push(description);
        }
        if (student_id !== undefined) {
            updates.push('student_id = ?');
            params.push(student_id || null);
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

        params.push(incomeId);

        await db.query(
            `UPDATE other_incomes SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        const [updated] = await db.query(
            `SELECT i.*, s.name as student_name, u.name as recorded_by_name
            FROM other_incomes i
            LEFT JOIN students s ON i.student_id = s.id
            LEFT JOIN users u ON i.recorded_by = u.id
            WHERE i.id = ?`,
            [incomeId]
        );

        res.json({
            message: 'Income record updated successfully',
            income: updated[0]
        });
    } catch (error) {
        console.error('Error updating income:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to update income record'
        });
    }
});

/**
 * DELETE /paca/incomes/:id
 * Delete income record
 * Access: owner, admin
 */
router.delete('/:id', verifyToken, checkPermission('incomes', 'edit'), async (req, res) => {
    const incomeId = parseInt(req.params.id);

    try {
        // Check if income exists
        const [existing] = await db.query(
            'SELECT id FROM other_incomes WHERE id = ? AND academy_id = ?',
            [incomeId, req.user.academyId]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Income record not found'
            });
        }

        await db.query('DELETE FROM other_incomes WHERE id = ?', [incomeId]);

        res.json({
            message: 'Income record deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting income:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to delete income record'
        });
    }
});

module.exports = router;
